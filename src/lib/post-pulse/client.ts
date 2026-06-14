import 'server-only'
import {
  forceRefreshPostPulseAccessToken,
  getPostPulseAccessToken,
} from './tokens'
import type { PostPulsePlatformSettings } from './platform-map'

const BASE_URL = 'https://api.post-pulse.com'

export class PostPulseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message)
    this.name = 'PostPulseError'
  }
}

export class PostPulseNotConnectedError extends PostPulseError {
  constructor() {
    super(
      'Post-Pulse is not connected. Visit /settings and click "Connect Post-Pulse" to authorise.',
      412,
      null,
    )
    this.name = 'PostPulseNotConnectedError'
  }
}

async function doFetch(path: string, init: RequestInit, accessToken: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

/**
 * Calls the Post-Pulse REST API with a refreshed access token, retrying
 * once on 401 in case the stored token was revoked or rotated by
 * another caller. Throws PostPulseNotConnectedError when the workspace
 * hasn't been connected yet, so callers can surface a clear "connect
 * first" message rather than a generic 401.
 */
async function ppFetch(path: string, init: RequestInit): Promise<unknown> {
  let accessToken = await getPostPulseAccessToken()
  if (!accessToken) throw new PostPulseNotConnectedError()

  let res = await doFetch(path, init, accessToken)
  if (res.status === 401) {
    const refreshed = await forceRefreshPostPulseAccessToken()
    if (!refreshed) throw new PostPulseNotConnectedError()
    accessToken = refreshed
    res = await doFetch(path, init, accessToken)
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) {
    const message =
      (typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : null) ?? `Post-Pulse ${path} returned HTTP ${res.status}`
    throw new PostPulseError(message, res.status, body)
  }
  return body
}

export type ImportMediaResult = { path: string }

/**
 * POST /v1/media/upload/import — imports a publicly-reachable URL into
 * Post-Pulse's media library so we can attach it to a post.
 *
 * Returns the opaque media `path` to use in `attachmentPaths`.
 */
export async function importMediaByUrl(url: string): Promise<ImportMediaResult> {
  const body = (await ppFetch('/v1/media/upload/import', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })) as { path?: unknown }
  if (typeof body?.path !== 'string') {
    throw new PostPulseError(
      'Post-Pulse /v1/media/upload/import did not return a string `path`',
      502,
      body,
    )
  }
  return { path: body.path }
}

export type CreatePostInput = {
  socialMediaAccountId: number
  platformSettings: PostPulsePlatformSettings
  content: string
  attachmentPath: string
  /** ISO 8601 string. Omit for immediate publish. */
  scheduledTime?: string | null
  isDraft?: boolean
}

export type CreatePostResult = {
  id: number
  overallStatus:
    | 'SCHEDULED'
    | 'DRAFT'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'PARTIALLY_COMPLETED'
    | 'FAILED'
    | string
  scheduledTime: string | null
}

/**
 * POST /v1/posts — schedules or immediately publishes one post to one
 * platform. Multi-platform fan-out happens at our layer (one row in
 * `posts` per platform), so we always send exactly one entry in
 * `publications`. Keeps the failure model simple: one Post-Pulse
 * external id per `posts` row.
 */
export async function createPost(input: CreatePostInput): Promise<CreatePostResult> {
  const payload: Record<string, unknown> = {
    isDraft: input.isDraft ?? false,
    publications: [
      {
        socialMediaAccountId: input.socialMediaAccountId,
        platformSettings: input.platformSettings,
        posts: [
          {
            content: input.content,
            attachmentPaths: [input.attachmentPath],
          },
        ],
      },
    ],
  }
  if (input.scheduledTime) payload.scheduledTime = input.scheduledTime

  const body = (await ppFetch('/v1/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })) as { id?: unknown; overallStatus?: unknown; scheduledTime?: unknown }

  if (typeof body?.id !== 'number') {
    throw new PostPulseError(
      'Post-Pulse /v1/posts did not return a numeric `id`',
      502,
      body,
    )
  }
  return {
    id: body.id,
    overallStatus: typeof body.overallStatus === 'string' ? body.overallStatus : 'UNKNOWN',
    scheduledTime:
      typeof body.scheduledTime === 'string' ? body.scheduledTime : null,
  }
}

export type PostPulseAccount = {
  id: number
  platform: string
  displayHandle: string | null
}

/**
 * GET /v1/accounts — list connected social accounts in the Post-Pulse
 * workspace. Endpoint exists (returns 401 to unauthed) but response
 * shape isn't publicly documented; the parser is permissive and falls
 * back to "no accounts known" so the Settings page can still degrade
 * to manual ID entry.
 */
export async function listAccounts(): Promise<PostPulseAccount[]> {
  let body: unknown
  try {
    body = await ppFetch('/v1/accounts', { method: 'GET' })
  } catch {
    return []
  }
  const arr = Array.isArray(body)
    ? body
    : (body as { accounts?: unknown })?.accounts
  if (!Array.isArray(arr)) return []
  return arr.flatMap((entry): PostPulseAccount[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const e = entry as Record<string, unknown>
    const id = typeof e.id === 'number' ? e.id : null
    const platform =
      typeof e.platform === 'string'
        ? e.platform
        : typeof e.type === 'string'
          ? e.type
          : null
    if (id === null || platform === null) return []
    const displayHandle =
      typeof e.displayHandle === 'string'
        ? e.displayHandle
        : typeof e.handle === 'string'
          ? e.handle
          : typeof e.username === 'string'
            ? e.username
            : null
    return [{ id, platform, displayHandle }]
  })
}
