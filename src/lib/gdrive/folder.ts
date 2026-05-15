/**
 * Parses a Drive folder ID out of a URL or accepts a bare ID.
 *
 * Accepts:
 *   https://drive.google.com/drive/folders/1ABC...
 *   https://drive.google.com/drive/u/0/folders/1ABC...?usp=sharing
 *   1ABC...  (bare ID)
 *
 * Returns null if it can't find a plausible ID. Drive IDs are 25–44
 * characters of [A-Za-z0-9_-], but the only places we accept them are
 * trusted server-side, so a loose length check is fine.
 */
export function extractFolderId(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const urlMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]+)/)
  if (urlMatch) return urlMatch[1]

  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed

  return null
}

/**
 * Parses a Drive *file* ID out of a URL or accepts a bare ID.
 *
 * Accepts:
 *   https://drive.google.com/file/d/1ABC.../view
 *   https://drive.google.com/file/d/1ABC.../preview
 *   https://drive.google.com/open?id=1ABC...
 *   1ABC...  (bare ID)
 */
export function extractFileId(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const fileMatch = trimmed.match(/\/file\/d\/([A-Za-z0-9_-]+)/)
  if (fileMatch) return fileMatch[1]

  const openMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/)
  if (openMatch) return openMatch[1]

  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed

  return null
}
