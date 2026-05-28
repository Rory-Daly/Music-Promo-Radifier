import 'server-only'

/**
 * Minimal YouTube Data API v3 video uploader.
 *
 * Uses the documented resumable upload protocol in one shot — we send
 * the full video body in the second request rather than chunking. For
 * the file sizes Legatograph produces (CRF 23, ~30s reels) this stays
 * comfortably under any practical request-size ceiling, and keeping it
 * single-shot avoids state-tracking we don't otherwise need.
 *
 * Docs:
 *   https://developers.google.com/youtube/v3/docs/videos/insert
 *   https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 *
 * Quota: each upload costs ~1,600 units against the default 10,000
 * units/day cap. That's ~6 uploads/day before a quota increase
 * application is needed — enough for illutible's ~10 releases/year
 * release cadence but tight if we ever bulk-publish a back catalogue.
 */

const SESSION_ENDPOINT =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'

const CHANNEL_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true'

export type PrivacyStatus = 'public' | 'unlisted' | 'private'

export type UploadVideoInput = {
  accessToken: string
  videoBytes: Buffer
  contentType: string // 'video/mp4' for our renders
  title: string
  description: string
  tags?: string[]
  /** Numeric YouTube category. '10' = Music. */
  categoryId?: string
  privacyStatus?: PrivacyStatus
  /** Notify subscribers on publish. Default true; set false for backfills. */
  notifySubscribers?: boolean
}

export type UploadVideoResult = {
  videoId: string
  watchUrl: string
}

export class YouTubeUploadError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string) {
    super(`YouTube upload failed (HTTP ${status}): ${body.slice(0, 400)}`)
    this.name = 'YouTubeUploadError'
    this.status = status
    this.body = body
  }
}

/**
 * Upload a video. Two-step resumable protocol:
 *
 *   1. POST metadata → response Location header carries the upload URL
 *   2. PUT the binary at the upload URL → response carries the new video
 *
 * On a quota or auth error the first call typically fails fast (no large
 * body sent), which is the main reason we use resumable at all even
 * without chunking.
 */
export async function uploadVideo(input: UploadVideoInput): Promise<UploadVideoResult> {
  const metadata = {
    snippet: {
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 5000),
      tags: input.tags?.slice(0, 30),
      categoryId: input.categoryId ?? '10',
    },
    status: {
      privacyStatus: input.privacyStatus ?? 'public',
      selfDeclaredMadeForKids: false,
      embeddable: true,
    },
  }

  const initRes = await fetch(SESSION_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': input.contentType,
      'X-Upload-Content-Length': String(input.videoBytes.byteLength),
    },
    body: JSON.stringify(metadata),
  })
  if (!initRes.ok) {
    const body = await initRes.text().catch(() => '')
    throw new YouTubeUploadError(initRes.status, body)
  }
  const sessionUrl = initRes.headers.get('location')
  if (!sessionUrl) {
    throw new YouTubeUploadError(initRes.status, 'Init response missing Location header')
  }

  // Node 22's global fetch types don't include Buffer in the BodyInit
  // union, but Blob does — wrap so we don't have to weaken the type.
  const uploadBody = new Blob([new Uint8Array(input.videoBytes)], { type: input.contentType })
  const uploadRes = await fetch(sessionUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': input.contentType,
      'Content-Length': String(input.videoBytes.byteLength),
    },
    body: uploadBody,
  })
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '')
    throw new YouTubeUploadError(uploadRes.status, body)
  }

  const body = (await uploadRes.json().catch(() => null)) as { id?: string } | null
  if (!body?.id) {
    throw new YouTubeUploadError(uploadRes.status, 'Upload response missing video id')
  }
  return {
    videoId: body.id,
    watchUrl: `https://www.youtube.com/watch?v=${body.id}`,
  }
}

/**
 * Look up the authenticated channel — used to render "Connected to
 * <channel>" in the UI after the OAuth handshake completes. Costs 1
 * quota unit, called sparingly.
 */
export async function getChannelInfo(accessToken: string): Promise<{
  id: string
  title: string
  customUrl: string | null
} | null> {
  const res = await fetch(CHANNEL_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as
    | { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> }
    | null
  const item = body?.items?.[0]
  if (!item) return null
  return {
    id: item.id,
    title: item.snippet?.title ?? 'Unknown channel',
    customUrl: item.snippet?.customUrl ?? null,
  }
}

/**
 * Compose a YouTube Shorts-friendly title/description from a post.
 *
 * The Shorts format requires:
 *  - Vertical 9:16 (Remotion already produces this for `9x16`)
 *  - Duration ≤ 60s (our hooks default to 30-60s)
 *  - "#Shorts" anywhere in the title or description gives the algorithm
 *    a stronger signal — we append it to the description if it's
 *    missing rather than forcing it into the title where it'd be ugly.
 */
export function composeShortsMetadata(args: {
  caption: string
  hashtags: string[]
  trackTitle: string | null
  artistName: string
}): { title: string; description: string; tags: string[] } {
  const captionLines = args.caption.split('\n').map((l) => l.trim())
  const firstNonEmpty = captionLines.find((l) => l.length > 0) ?? args.trackTitle ?? 'New release'
  const rawTitle = firstNonEmpty.length > 80 ? firstNonEmpty.slice(0, 77) + '…' : firstNonEmpty
  const title = rawTitle.includes('#Shorts') ? rawTitle : rawTitle

  const captionHashtagSet = new Set(
    args.caption.match(/#\w+/g)?.map((h) => h.toLowerCase()) ?? [],
  )
  const description = [
    args.caption,
    args.hashtags.filter((h) => !captionHashtagSet.has(h.toLowerCase())).join(' '),
    captionHashtagSet.has('#shorts') ? '' : '#Shorts',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 5000)

  // YouTube tags max ~500 chars total across all tags. Bare-word tags
  // (no `#`) work better than hashtag-prefixed ones in this field.
  const tags = args.hashtags.map((h) => h.replace(/^#/, '')).filter((t) => t.length > 0).slice(0, 15)

  return { title, description, tags }
}
