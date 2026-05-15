/**
 * Minimal Drive v3 API client. Uses an API key for unauthenticated access
 * to publicly-shared files ("anyone with the link can view"). Server-side
 * only — never expose GOOGLE_API_KEY to the browser.
 */

const ENDPOINT = 'https://www.googleapis.com/drive/v3'

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
 * Lists every video file in the given folder. Folder must be shared as
 * "anyone with the link can view" for the API key to access it.
 */
export async function listFolderVideos(folderId: string, apiKey: string): Promise<DriveFile[]> {
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
      key: apiKey,
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(`${ENDPOINT}/files?${params}`)
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
 * Fetches a Drive file's raw bytes. The folder/file must be shared
 * "anyone with the link can view" or the request will 403.
 *
 * Returns the body as a ReadableStream so the caller can pipe it to disk
 * without buffering the whole file in memory (drone clips can be GBs).
 */
export async function downloadDriveFile(
  fileId: string,
  apiKey: string,
): Promise<{
  body: ReadableStream<Uint8Array>
  contentType: string
  contentLength: number | null
}> {
  const url = `${ENDPOINT}/files/${fileId}?alt=media&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Drive download ${fileId} failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  if (!res.body) throw new Error(`Drive download ${fileId} returned no body`)
  const contentLengthRaw = res.headers.get('content-length')
  return {
    body: res.body,
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    contentLength: contentLengthRaw ? Number(contentLengthRaw) : null,
  }
}

/**
 * Fetches a single file's metadata. Useful for resolving a one-off file ID
 * (e.g. when the user pastes a single file URL).
 */
export async function getFileMetadata(fileId: string, apiKey: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,size,thumbnailLink,videoMediaMetadata(width,height,durationMillis)',
    supportsAllDrives: 'true',
    key: apiKey,
  })
  const res = await fetch(`${ENDPOINT}/files/${fileId}?${params}`)
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Drive metadata ${fileId} failed: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return normalize((await res.json()) as RawDriveFile)
}
