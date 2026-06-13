import { NextResponse, type NextRequest } from 'next/server'
import {
  devBypassEnabled,
  parseWebhookPayload,
  SIGNATURE_HEADER,
  verifyWebhookSignature,
} from '@/lib/post-pulse/webhook'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

/**
 * Post-Pulse calls this endpoint when a scheduled post lands (or fails).
 *
 * We verify the signature, look up the matching `posts` row by
 * `post_pulse_post_id`, then flip status + permalink + error. The
 * signature scheme is documented as ASSUMED in docs/post-pulse.md — if
 * real deliveries don't verify, inspect the actual headers Post-Pulse
 * sends and adjust src/lib/post-pulse/webhook.ts in one place.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signatureHeader = request.headers.get(SIGNATURE_HEADER)
  const bypass = devBypassEnabled()

  if (!bypass) {
    const verified = verifyWebhookSignature(rawBody, signatureHeader)
    if (!verified.ok) {
      return NextResponse.json(
        { error: 'Signature verification failed', code: verified.reason },
        { status: 401 },
      )
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'invalid_json' }, { status: 400 })
  }

  const parsed = parseWebhookPayload(payload)
  if (!parsed.postPulsePostId) {
    return NextResponse.json(
      { error: 'Payload missing post id', code: 'no_post_id' },
      { status: 400 },
    )
  }

  const admin = createSupabaseAdminClient()
  const { data: post } = await admin
    .from('posts')
    .select('id, status')
    .eq('post_pulse_post_id', parsed.postPulsePostId)
    .maybeSingle<{ id: string; status: string }>()
  if (!post) {
    // Unknown id — return 200 so Post-Pulse stops retrying. This isn't
    // an error on our side; could be a stale webhook from a since-deleted
    // post. Log for visibility.
    console.warn(
      `Post-Pulse webhook for unknown post id ${parsed.postPulsePostId} (status=${parsed.overallStatus})`,
    )
    return NextResponse.json({ ok: true, ignored: 'unknown_post_id' })
  }

  const nextStatus = mapOverallStatus(parsed.overallStatus, post.status)
  const update: Record<string, unknown> = {
    status: nextStatus,
    updated_at: new Date().toISOString(),
  }
  if (parsed.permalink) update.permalink = parsed.permalink
  if (nextStatus === 'failed' && parsed.errorMessage) {
    update.error = parsed.errorMessage.slice(0, 500)
  }
  if (nextStatus === 'published') update.error = null

  const { error: updateError } = await admin.from('posts').update(update).eq('id', post.id)
  if (updateError) {
    return NextResponse.json(
      { error: `Update failed: ${updateError.message}`, code: 'update_failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, status: nextStatus })
}

function mapOverallStatus(
  overall: string | null,
  current: string,
): 'draft' | 'scheduled' | 'published' | 'failed' {
  switch (overall) {
    case 'COMPLETED':
      return 'published'
    case 'PARTIALLY_COMPLETED':
      // At least one publication landed. We only fan out one platform
      // per post, so partial == failed for our purposes.
      return 'failed'
    case 'FAILED':
      return 'failed'
    case 'SCHEDULED':
    case 'IN_PROGRESS':
    case 'DRAFT':
      return 'scheduled'
    default:
      // Unknown status — preserve current row state.
      if (current === 'published' || current === 'failed') return current
      return 'scheduled'
  }
}
