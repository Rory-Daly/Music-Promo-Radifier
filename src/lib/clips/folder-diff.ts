export type FolderClipRow = {
  id: string
  name: string | null
  gdrive_file_id: string | null
  thumbnail_url: string | null
}

export type Orphan = {
  id: string
  name: string | null
  gdrive_file_id: string
  thumbnail_url: string | null
}

/**
 * Given the clips this artist has imported from a folder and the file IDs
 * currently in that folder on Drive, return the clips whose Drive file is
 * gone (deleted, trashed, or moved out of the folder). Rows without a
 * gdrive_file_id are skipped — they shouldn't exist for a folder-scoped
 * row, but we defend anyway.
 */
export function findOrphans(clips: FolderClipRow[], driveFileIds: Iterable<string>): Orphan[] {
  const present = new Set(driveFileIds)
  const out: Orphan[] = []
  for (const c of clips) {
    if (!c.gdrive_file_id) continue
    if (!present.has(c.gdrive_file_id)) {
      out.push({
        id: c.id,
        name: c.name,
        gdrive_file_id: c.gdrive_file_id,
        thumbnail_url: c.thumbnail_url,
      })
    }
  }
  return out
}
