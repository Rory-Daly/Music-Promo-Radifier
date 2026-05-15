'use client'

import type { ClipRow } from '@/lib/supabase/queries'

/**
 * Renders a 9:16 preview for a clip row.
 *
 * Source-aware:
 * - Uploaded clips: a muted <video preload="metadata"> using the signed
 *   URL. Browsers fetch only the first frame as a poster.
 * - Drive clips: an <img> pointing at Drive's PUBLIC thumbnail endpoint
 *   (drive.google.com/thumbnail?id=…). The DB also stores Drive's
 *   thumbnailLink, but that URL is auth-gated and expires after a few
 *   hours — the file-ID-based URL works for any "Anyone with the link"
 *   file indefinitely. Falls back to the stored thumbnail_url for old
 *   data without gdrive_file_id, then to a "no preview" placeholder.
 */
export function ClipPreview({ clip }: { clip: ClipRow & { signedUrl?: string | null } }) {
  if (clip.signedUrl) {
    return (
      <video
        src={clip.signedUrl}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    )
  }
  const driveThumbnail =
    clip.source === 'gdrive' && clip.gdrive_file_id
      ? `https://drive.google.com/thumbnail?id=${clip.gdrive_file_id}&sz=w320`
      : null
  const src = driveThumbnail ?? clip.thumbnail_url
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-neutral-600">
      no preview
    </div>
  )
}
