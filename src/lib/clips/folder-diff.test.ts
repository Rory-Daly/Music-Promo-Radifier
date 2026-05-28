import { describe, expect, it } from 'vitest'
import { findOrphans, type FolderClipRow } from './folder-diff'

const clip = (overrides: Partial<FolderClipRow> & { id: string }): FolderClipRow => ({
  name: null,
  gdrive_file_id: null,
  thumbnail_url: null,
  ...overrides,
})

describe('findOrphans', () => {
  it('returns clips whose drive file is no longer in the folder', () => {
    const clips: FolderClipRow[] = [
      clip({ id: 'a', name: 'kept', gdrive_file_id: 'file-1' }),
      clip({ id: 'b', name: 'gone', gdrive_file_id: 'file-2' }),
      clip({ id: 'c', name: 'also kept', gdrive_file_id: 'file-3' }),
    ]
    const orphans = findOrphans(clips, ['file-1', 'file-3'])
    expect(orphans).toEqual([
      { id: 'b', name: 'gone', gdrive_file_id: 'file-2', thumbnail_url: null },
    ])
  })

  it('returns empty when every clip is still present', () => {
    const clips: FolderClipRow[] = [
      clip({ id: 'a', gdrive_file_id: 'f1' }),
      clip({ id: 'b', gdrive_file_id: 'f2' }),
    ]
    expect(findOrphans(clips, ['f1', 'f2'])).toEqual([])
  })

  it('treats every clip as orphan when the folder returned empty', () => {
    const clips: FolderClipRow[] = [
      clip({ id: 'a', name: 'x', gdrive_file_id: 'f1' }),
      clip({ id: 'b', name: 'y', gdrive_file_id: 'f2' }),
    ]
    const orphans = findOrphans(clips, [])
    expect(orphans.map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('skips rows without a gdrive_file_id', () => {
    const clips: FolderClipRow[] = [
      clip({ id: 'a', gdrive_file_id: null }),
      clip({ id: 'b', gdrive_file_id: 'f2' }),
    ]
    const orphans = findOrphans(clips, ['f2'])
    expect(orphans).toEqual([])
  })

  it('returns empty when no clips are tracked for the folder', () => {
    expect(findOrphans([], ['f1', 'f2', 'f3'])).toEqual([])
  })

  it('preserves the thumbnail_url on orphan rows for cleanup callers', () => {
    const clips: FolderClipRow[] = [
      clip({ id: 'a', gdrive_file_id: 'f1', thumbnail_url: 'https://example/a.jpg' }),
    ]
    const orphans = findOrphans(clips, [])
    expect(orphans[0]?.thumbnail_url).toBe('https://example/a.jpg')
  })
})
