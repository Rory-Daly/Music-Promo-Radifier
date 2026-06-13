import { NextResponse, type NextRequest } from 'next/server'
import { createPost, importMediaByUrl, PostPulseError } from '@/lib/post-pulse/client'
import { getSocialConnection } from '@/lib/post-pulse/connections'
import {
  type AppPlatform,
  getPostPulseMapping,
  isPostPulseSupported,
} from '@/lib/post-pulse/platform-map'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Safety net for scheduled posts that didn't reach Post-Pulse the first
 * time. Normally the user clicks Publish/Schedule from the UI, we send
 * the post to Post-Pulse with a `scheduledTime`, and Post-Pulse fires
 * the publication at that time. This cron sweeps up the corner cases:
 *
 *   - Posts marked `scheduled` whose `scheduled_for` is in the past
 *     but `post_pulse_post_id IS NULL` (publish call failed earlier
 *     and was never retried). We retry now.
 *
 * Posts that have a `post_pulse_post_id` are owned by Post-Pulse — they
 * fire the webhook on completion/failure; we don't touch them here.
 *
 * Auth: same Bearer CRON_SECRET scheme as cleanup-renders.
 */

const BATCH_SIZE = 25

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on the server', code: 'no_cron_secret' },
      { status: 500 },
    )
  }
  const header = request.headers.get('authorization') ?? ''
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  }

  if (!process.env.POST_PULSE_API_KEY) {
    return NextResponse.json(
      { ok: true, skipped: 'POST_PULSE_API_KEY not set' },
      { status: 200 },
    )
  }

  const admin = createSupabaseAdminClient()
  const nowIso = new Date().toISOString()

  type Row = {
    id: string
    artist_id: string
    platform: AppPlatform
    caption: string | null
    hashtags: string[] | null
    scheduled_for: string | null
    render_id: string | null
    renders: { output_url: string | null } | null
  }

  const { data: rows, error: selectError } = await admin
    .from('posts')
    .select('id, artist_id, platform, caption, hashtags, scheduled_for, render_id, renders(output_url)')
    .eq('status', 'scheduled')
    .is('post_pulse_post_id', null)
    .lte('scheduled_for', nowIso)
    .limit(BATCH_SIZE)
    .returns<Row[]>()

  if (selectError) {
    return NextResponse.json(
      { error: `Select failed: ${selectError.message}`, code: 'select_failed' },
      { status: 500 },
    )
  }

  const results: Array<{ id: string; ok: boolean; reason?: string }> = []

  for (const row of rows ?? []) {
    if (row.platform === 'yt_short') {
      // YouTube doesn't fan out through this path; skip and let the
      // dedicated UI publish flow handle it.
      results.push({ id: row.id, ok: false, reason: 'yt_short_not_supported_here' })
      continue
    }
    if (!isPostPulseSupported(row.platform)) {
      results.push({ id: row.id, ok: false, reason: 'platform_not_supported' })
      continue
    }
    if (!row.render_id || !row.renders?.output_url) {
      await markFailed(row.id, 'No rendered video attached')
      results.push({ id: row.id, ok: false, reason: 'no_render' })
      continue
    }
    const connection = await getSocialConnection(row.artist_id, row.platform)
    if (!connection) {
      await markFailed(row.id, `No Post-Pulse connection for ${row.platform}`)
      results.push({ id: row.id, ok: false, reason: 'not_connected' })
      continue
    }

    try {
      const imported = await importMediaByUrl(row.renders.output_url)
      const mapping = getPostPulseMapping(row.platform)
      const content = composeContent({
        caption: row.caption ?? '',
        hashtags: row.hashtags ?? [],
        captionMaxChars: mapping.captionMaxChars,
      })
      const result = await createPost({
        socialMediaAccountId: connection.social_media_account_id,
        platformSettings: mapping.buildPlatformSettings(),
        content,
        attachmentPath: imported.path,
        scheduledTime: null,
      })
      await admin
        .from('posts')
        .update({
          post_pulse_post_id: String(result.id),
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      results.push({ id: row.id, ok: true })
    } catch (e) {
      const message =
        e instanceof PostPulseError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Unknown error'
      await markFailed(row.id, message)
      results.push({ id: row.id, ok: false, reason: message.slice(0, 120) })
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}

async function markFailed(postId: string, message: string) {
  const admin = createSupabaseAdminClient()
  await admin
    .from('posts')
    .update({
      status: 'failed',
      error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId)
}

function composeContent(input: {
  caption: string
  hashtags: string[]
  captionMaxChars: number
}): string {
  const captionTrimmed = input.caption.trim()
  const tags = input.hashtags
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .filter((t) => !captionTrimmed.toLowerCase().includes(t.toLowerCase()))
  const composed = [captionTrimmed, tags.join(' ')].filter(Boolean).join('\n\n')
  if (composed.length <= input.captionMaxChars) return composed
  return composed.slice(0, input.captionMaxChars - 1) + '…'
}
