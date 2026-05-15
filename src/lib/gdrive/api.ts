/**
 * Minimal Drive v3 API client. Supports two auth modes:
 *
 * - apiKey: unauthenticated access to publicly-shared files. Subject to
 *   Drive's per-file per-day anonymous download quotas.
 * - oauth:  user-authorised access via Bearer token. Higher quotas, can
 *   read private files the user has access to. Tokens come from the
 *   artist_integrations table via getDriveAccessToken().
 *
 * Server-side only — never expose either credential to the browser.
 */

const ENDPOINT = 'https://www.googleapis.com/drive/v3'

export type DriveAuth =
  | { kind: 'apiKey'; apiKey: string }
  | { kind: 'oauth'; accessToken: string }

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  size: number
  thumbnailLink: string | null
  durationSeconds: number | null
  width: number | null
  height: number | null
}

type RawDriveFile = {
  id?: string
  name?: string
  mimeType?: string
  size?: string
  thumbnailLink?: string
  videoMediaMetadata?: {
    width?: number
    height?: number
    durationMillis?: string
  }
}

type DriveListResponse = {
  files?: RawDriveFile[]
  nextPageToken?: string
}

function applyAuth(
  url: string,
  headers: Record<string, string>,
  auth: DriveAuth,
): { url: string; headers: Record<string, string> } {
  if (auth.kind === 'apiKey') {
    const sep = url.includes('?') ? '&' : '?'
    return { url: `${url}${sep}key=${encodeURIComponent(auth.apiKey)}`, headers }
  }
  return {
    url,
    headers: { ...headers, Authorization: `Bearer ${auth.accessToken}` },
  }
}

function normalize(f: RawDriveFile): DriveFile | null {
  if (!f.id || !f.name || !f.mimeType) return null
  const durationMs = f.videoMediaMetadata?.durationMillis
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? Number(f.size) : 0,
    thumbnailLink: f.thumbnailLink ?? null,
    durationSeconds: durationMs ? Number(durationMs) / 1000 : null,
    width: f.videoMediaMetadata?.width ?? null,
    height: f.videoMediaMetadata?.height ?? null,
  }
}

/**
 * Lists every video file in the given folder. Folder must be either
 * publicly shared (for apiKey auth) or accessible to the user whose
 * OAuth token is in play (for oauth auth).
 */
export async function listFolderVideos(folderId: string, auth: DriveAuth): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
      fields:
        'nextPageToken,files(id,name,mimeType,size,thumbnailLink,videoMediaMetadata(width,height,durationMillis))',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const baseUrl = `${ENDPOINT}/files?${params}`
    const { url, headers } = applyAuth(baseUrl, {}, auth)
    const res = await fetch(url, { headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Drive list failed: HTTP ${res.status} ${body.slice(0, 200)}`)
    }
    const data = (await res.json()) as DriveListResponse
    for (const f of data.files ?? []) {
      const norm = normalize(f)
      if (norm) out.push(norm)
    }
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

/**
 * Fetches a Drive file's raw bytes. Returns a stream so callers can pipe
 * to disk without buffering. Supports Range via extra headers.
 */
export async function downloadDriveFile(
  fileId: string,
  auth: DriveAuth,
  extraHeaders?: Record<string, string>,
): Promise<{
  body: ReadableStream<Uint8Array>
  contentType: string
  contentLength: number | null
  status: number
}> {
  const baseUrl = `${ENDPOINT}/files/${fileId}?alt=media`
  const { url, headers } = applyAuth(baseUrl, extraHeaders ?? {}, auth)
  const res = await fetch(url, { headers })
  if (!res.ok && res.status !== 206) {
    const body = await res.text().catch(() => '')
    throw new Error(`Drive download ${fileId} failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  if (!res.body) throw new Error(`Drive download ${fileId} returned no body`)
  const contentLengthRaw = res.headers.get('content-length')
  return {
    body: res.body,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    contentLength: contentLengthRaw ? Number(contentLengthRaw) : null,
    status: res.status,
  }
}

/**
 * Returns the URL + headers callers can use to make their own fetch().
 * Useful when the caller needs Range support and wants to handle
 * everything (HTTP retries, partial-body streams) themselves.
 */
export function buildDriveDownloadRequest(
  fileId: string,
  auth: DriveAuth,
): { url: string; headers: Record<string, string> } {
  const baseUrl = `${ENDPOINT}/files/${fileId}?alt=media`
  return applyAuth(baseUrl, {}, auth)
}

export async function getFileMetadata(
  fileId: string,
  auth: DriveAuth,
): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,size,thumbnailLink,videoMediaMetadata(width,height,durationMillis)',
    supportsAllDrives: 'true',
  })
  const baseUrl = `${ENDPOINT}/files/${fileId}?${params}`
  const { url, headers } = applyAuth(baseUrl, {}, auth)
  const res = await fetch(url, { headers })
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Drive metadata ${fileId} failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return normalize((await res.json()) as RawDriveFile)
}
