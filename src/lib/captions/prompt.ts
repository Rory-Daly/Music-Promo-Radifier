import type { BrandKit, CaptionPreset } from '@/lib/brand-kit/schema'

export type CaptionPlatform =
  | 'ig_reel'
  | 'ig_story'
  | 'ig_feed'
  | 'tiktok'
  | 'yt_short'
  | 'x'
  | 'threads'
  | 'fb'

const PLATFORM_GUIDANCE: Record<CaptionPlatform, string> = {
  ig_reel:
    'Instagram Reel — vibe-led, evocative, 2-4 short lines is plenty. Links in captions are not clickable here, so keep the smart link line minimal and assume fans will tap link-in-bio instead.',
  ig_story:
    'Instagram Story — extremely terse, one fragment is fine. No hashtags.',
  ig_feed:
    'Instagram feed — like Reel, slightly more room for a second beat. Links not clickable.',
  tiktok:
    'TikTok — punchy first line is the hook, fans only see the top before tapping more. Slang fine, no over-formality. Hashtags work for discovery.',
  yt_short:
    'YouTube Short — keep the first sentence keyword-rich for search. Plain prose, link goes in the description anyway but include the smart link verbatim for fans who copy.',
  x: 'X (Twitter) — single tight thought. Hard limit is short, so prioritise the smart link + the most evocative fragment of the voice. Skip hashtags.',
  threads:
    'Threads — conversational, slightly longer than X. One short paragraph + smart link.',
  fb: 'Facebook — moderate length, slightly warmer tone. Smart link is clickable here so put it at the end on its own line.',
}

export const ALL_CAPTION_PLATFORMS: CaptionPlatform[] = [
  'ig_reel',
  'ig_story',
  'ig_feed',
  'tiktok',
  'yt_short',
  'x',
  'threads',
  'fb',
]

/**
 * The system prompt is the stable part of every caption request for a given
 * artist — it carries voice, exemplars, avoid list, and the platform style
 * guide. Stable across requests → cache-friendly (we set cache_control on
 * this block in the route handler so the second+ request for the same artist
 * pays ~0.1× input cost on this prefix).
 */
export function buildSystemPrompt(brand: BrandKit, platforms: CaptionPlatform[]): string {
  const exemplars =
    brand.voice.exemplars.length > 0
      ? brand.voice.exemplars.map((e) => `- "${e}"`).join('\n')
      : '- (no exemplars set — use your judgement to match the register)'
  const avoid =
    brand.voice.avoid.length > 0
      ? brand.voice.avoid.map((a) => `- ${a}`).join('\n')
      : '- Generic hype-bro voice, excessive emoji, AI-generation language.'
  const limits = Object.entries(brand.voice.max_chars_per_platform)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')

  const guidance = platforms
    .map((p) => `- ${p}: ${PLATFORM_GUIDANCE[p]}`)
    .join('\n')

  return [
    `You write social-media captions for the music artist "${brand.logo.text_fallback}". This is the only artist you write for in this conversation.`,
    brand.tagline ? `Artist tagline: ${brand.tagline}.` : '',
    brand.location ? `Based in ${brand.location}.` : '',
    '',
    `Voice register: ${brand.voice.register}.`,
    '',
    'Voice exemplars (the artist actually writes like this — match the cadence, sparseness, and tone):',
    exemplars,
    '',
    'Avoid:',
    avoid,
    '',
    `Per-platform character limits (do not exceed): ${limits}.`,
    '',
    'Platforms you will write for in this batch:',
    guidance,
    '',
    'Hard rules:',
    '- Use the smart-link URL provided in the user message verbatim — do not shorten, alter, or omit it.',
    '- Use the hashtag list provided in the user message verbatim where appropriate per platform (no hashtags on x or ig_story).',
    '- Never invent facts about the track or artist that were not provided.',
    '- Never refer to yourself as AI or to the workflow tool. The artist writes their own captions.',
    '- Captions should feel hand-written by the artist, not auto-generated. Slight imperfections (sentence fragments, em dashes, mid-thought) are fine and on-brand.',
    '',
    'Return one caption per requested platform via the structured output schema. Each caption must include the smart link where natural for the platform and the hashtags array provided.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Picks the closest preset for a platform. Preference order:
 *   1. Preset explicitly chosen by the caller (presetId)
 *   2. First preset whose platforms list includes this platform
 *   3. The first preset overall (last-resort fallback so the model still
 *      gets a template to anchor on)
 */
export function pickPresetForPlatform(
  presets: CaptionPreset[],
  platform: CaptionPlatform,
  presetId: string | null,
): CaptionPreset | null {
  if (presets.length === 0) return null
  if (presetId) {
    const explicit = presets.find((p) => p.id === presetId)
    if (explicit) return explicit
  }
  const matching = presets.find((p) => p.platforms.includes(platform))
  if (matching) return matching
  return presets[0] ?? null
}

/**
 * Build the per-platform user-message block. Includes the template (with
 * tokens already substituted) so the model has a concrete starting point,
 * plus the raw context fields it can draw on. Keeping the smart link and
 * hashtags out of the template-fill step and re-listing them explicitly
 * makes it harder for the model to drift away from them.
 */
export type CaptionRequestBlock = {
  platform: CaptionPlatform
  presetLabel: string
  baseTemplate: string
  smartLink: string
  hashtags: string[]
  hashtagsString: string
}

export function buildUserMessage(
  blocks: CaptionRequestBlock[],
  context: {
    trackTitle: string
    releaseDate: string
    tagline: string | null
    locationOrMood: string | null
  },
): string {
  const lines = [
    `Track title: ${context.trackTitle}`,
    `Release context: ${context.releaseDate}`,
    context.tagline ? `Artist tagline: ${context.tagline}` : '',
    context.locationOrMood ? `Extra context from the artist: ${context.locationOrMood}` : '',
    '',
    'Draft a caption for each of the following platforms. Use the preset template only as a starting frame — feel free to rewrite into the artist voice, but keep the smart link and the hashtag list intact.',
    '',
  ]

  for (const b of blocks) {
    lines.push(`### ${b.platform} (${b.presetLabel})`)
    lines.push('Preset template (already token-filled):')
    lines.push(b.baseTemplate)
    lines.push(`Smart link to include verbatim: ${b.smartLink}`)
    lines.push(
      b.hashtags.length > 0
        ? `Hashtags to include (where appropriate per platform): ${b.hashtagsString}`
        : 'Hashtags: (none — skip the hashtags line)',
    )
    lines.push('')
  }

  return lines.filter((l) => l !== null).join('\n')
}
