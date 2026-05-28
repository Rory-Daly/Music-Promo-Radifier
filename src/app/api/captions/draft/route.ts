import Anthropic from '@anthropic-ai/sdk'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { loadBrandKit } from '@/lib/brand-kit/load'
import {
  ALL_CAPTION_PLATFORMS,
  buildSystemPrompt,
  buildUserMessage,
  pickPresetForPlatform,
  type CaptionPlatform,
  type CaptionRequestBlock,
} from '@/lib/captions/prompt'
import { formatReleaseDate, substituteCaptionTokens } from '@/lib/captions/tokens'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const bodySchema = z.object({
  artistId: z.string().uuid(),
  trackId: z.string().uuid(),
  platforms: z
    .array(z.enum(ALL_CAPTION_PLATFORMS as [CaptionPlatform, ...CaptionPlatform[]]))
    .min(1)
    .max(8),
  presetId: z.string().min(1).max(64).optional(),
  contextHint: z.string().trim().max(280).optional(),
})

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return err('ANTHROPIC_API_KEY not configured on the server', 500, 'no_anthropic_key')
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('Not authenticated', 401, 'unauthenticated')

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return err('Invalid JSON body', 400, 'invalid_json')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'Invalid body', 400, 'invalid_body')
  }
  const { artistId, trackId, platforms, presetId, contextHint } = parsed.data

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id, artists(slug)')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle<{ artist_id: string; artists: { slug: string } | null }>()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  const { data: track } = await supabase
    .from('tracks')
    .select('title, slug, release_date')
    .eq('id', trackId)
    .eq('artist_id', artistId)
    .maybeSingle<{ title: string; slug: string; release_date: string | null }>()
  if (!track) return err('Track not found', 404, 'track_not_found')

  const brandKit = await loadBrandKit(artistId)
  const artistSlug = membership.artists?.slug ?? artistId
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3030'
  const smartLink = `${appUrl}/r/${artistSlug}/${track.slug}`
  const releaseDate = formatReleaseDate(track.release_date)

  // Build per-platform request blocks with tokens pre-substituted into the
  // preset template, so the model sees a concrete starting point rather than
  // having to do placeholder math itself.
  const blocks: CaptionRequestBlock[] = platforms.map((platform) => {
    const preset = pickPresetForPlatform(brandKit.caption_presets, platform, presetId ?? null)
    const hashtags =
      brandKit.hashtag_presets.by_platform?.[platform] ?? brandKit.hashtag_presets.default ?? []
    const hashtagsString = hashtags.join(' ')
    const baseTemplate = preset
      ? substituteCaptionTokens(preset.template, {
          track_title: track.title,
          smart_link: smartLink,
          release_date: releaseDate,
          hashtags: hashtagsString,
          location_or_mood: contextHint,
        })
      : `${track.title}\n\n${smartLink}\n\n${hashtagsString}`.trim()
    return {
      platform,
      presetLabel: preset?.label ?? 'no preset',
      baseTemplate,
      smartLink,
      hashtags,
      hashtagsString,
    }
  })

  const systemPrompt = buildSystemPrompt(brandKit, platforms)
  const userMessage = buildUserMessage(blocks, {
    trackTitle: track.title,
    releaseDate,
    tagline: brandKit.tagline,
    locationOrMood: contextHint ?? null,
  })

  const client = new Anthropic()

  // Structured output schema — the model must return one caption per requested
  // platform. additionalProperties: false on every object is required for
  // strict-mode validation.
  const schema = {
    type: 'object',
    properties: {
      captions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            platform: {
              type: 'string',
              enum: platforms,
            },
            caption: { type: 'string' },
            hashtags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['platform', 'caption', 'hashtags'],
          additionalProperties: false,
        },
      },
    },
    required: ['captions'],
    additionalProperties: false,
  }

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      // Adaptive thinking with low effort: caption generation is short and
      // structured, not an open-ended reasoning task. Higher effort burns
      // tokens for diminishing returns here.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema },
      },
      system: [
        {
          type: 'text',
          text: systemPrompt,
          // Cache the system prompt — it's stable per (artist, platform-set)
          // so the second+ request for the same artist hits cache at ~0.1×.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    // Pull the JSON output. With output_config.format set, the model returns
    // a single text block whose content is the JSON object.
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return err('Model returned no text content', 502, 'no_text_block')
    }

    let parsedOutput: { captions: Array<{ platform: string; caption: string; hashtags: string[] }> }
    try {
      parsedOutput = JSON.parse(textBlock.text)
    } catch {
      return err('Model returned malformed JSON', 502, 'malformed_json')
    }

    return NextResponse.json(
      {
        captions: parsedOutput.captions,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        },
      },
      { status: 200 },
    )
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return err('Rate limited by Anthropic API — try again shortly', 429, 'rate_limit')
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return err('Anthropic API key is invalid', 500, 'anthropic_auth')
    }
    if (e instanceof Anthropic.APIError) {
      return err(`Anthropic API error: ${e.message}`, 502, 'anthropic_api')
    }
    const message = e instanceof Error ? e.message : String(e)
    return err(`Caption generation failed: ${message}`, 500, 'unknown')
  }
}
