import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhook signature verification.
 *
 * Post-Pulse's docs confirm webhooks fire on success/failure but don't
 * publicly document the signing scheme. We implement the standard
 * pattern — HMAC-SHA256(raw_body, secret) compared against the
 * `X-PostPulse-Signature` header — and document this as ASSUMED in
 * docs/post-pulse.md. If real deliveries fail verification, inspect
 * the actual headers and adjust this one function.
 *
 * For local development without Post-Pulse hitting your machine, set
 * POST_PULSE_WEBHOOK_DEV_BYPASS=1. Never set it in deployed envs —
 * the route refuses bypass in production by checking NODE_ENV.
 */

export const SIGNATURE_HEADER = 'x-postpulse-signature'

export type SignatureVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing_secret' | 'missing_header' | 'mismatch' }

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): SignatureVerifyResult {
  const secret = process.env.POST_PULSE_WEBHOOK_SECRET
  if (!secret) return { ok: false, reason: 'missing_secret' }
  if (!signatureHeader) return { ok: false, reason: 'missing_header' }

  // Support either raw hex/base64 or a "sha256=..." prefixed form, since
  // we haven't seen which Post-Pulse actually sends.
  const provided = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader

  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expectedHex, 'hex')

  // Try hex then base64. Lengths must match before timingSafeEqual.
  for (const encoding of ['hex', 'base64'] as const) {
    let providedBuf: Buffer
    try {
      providedBuf = Buffer.from(provided, encoding)
    } catch {
      continue
    }
    if (providedBuf.length !== expectedBuf.length) continue
    if (timingSafeEqual(providedBuf, expectedBuf)) return { ok: true }
  }
  return { ok: false, reason: 'mismatch' }
}

export function devBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.POST_PULSE_WEBHOOK_DEV_BYPASS === '1'
  )
}

/**
 * Permissive parser for the webhook payload — Post-Pulse hasn't
 * published the schema. We extract everything the publish endpoint
 * needs to update a `posts` row and tolerate unknown extra fields.
 */
export type ParsedWebhookEvent = {
  /** Post-Pulse's external post id (matches `posts.post_pulse_post_id`). */
  postPulsePostId: string | null
  overallStatus: string | null
  /** Permalink of the resulting native post, if Post-Pulse returned one. */
  permalink: string | null
  /** Error message from Post-Pulse, if any publication failed. */
  errorMessage: string | null
}

export function parseWebhookPayload(body: unknown): ParsedWebhookEvent {
  if (typeof body !== 'object' || body === null) {
    return {
      postPulsePostId: null,
      overallStatus: null,
      permalink: null,
      errorMessage: null,
    }
  }
  const root = body as Record<string, unknown>
  const idRaw = root.id ?? root.postId
  const postPulsePostId =
    typeof idRaw === 'string'
      ? idRaw
      : typeof idRaw === 'number'
        ? String(idRaw)
        : null
  const overallStatus =
    typeof root.overallStatus === 'string'
      ? root.overallStatus
      : typeof root.status === 'string'
        ? root.status
        : null

  // permalink might appear at root level or nested under publications[0]
  let permalink: string | null = null
  let errorMessage: string | null = null
  if (typeof root.permalink === 'string') permalink = root.permalink
  if (typeof root.error === 'string') errorMessage = root.error
  if (Array.isArray(root.publications) && root.publications.length > 0) {
    const first = root.publications[0]
    if (typeof first === 'object' && first !== null) {
      const f = first as Record<string, unknown>
      if (permalink === null) {
        const fpl =
          f.permalink ??
          (typeof f.platformResponse === 'object' && f.platformResponse !== null
            ? (f.platformResponse as Record<string, unknown>).permalink
            : null)
        if (typeof fpl === 'string') permalink = fpl
      }
      if (errorMessage === null && typeof f.error === 'string') {
        errorMessage = f.error
      }
    }
  }
  return { postPulsePostId, overallStatus, permalink, errorMessage }
}
