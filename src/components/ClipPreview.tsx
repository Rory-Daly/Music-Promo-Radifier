'use client'

import { useState } from 'react'
import type { ClipRow } from '@/lib/supabase/queries'

/**
 * Renders a 9:16 preview for a clip row.
 *
 * Source-aware:
 * - Uploaded clips: muted <video preload="metadata"> using the signed URL.
 *   Browsers fetch only the first frame as a poster.
 * - Drive clips: <img> pointing at lh3.googleusercontent.com/d/<id>=w320.
 *   This is the underlying URL Drive's web client uses for thumbnails;
 *   the public drive.google.com/thumbnail?id=… endpoint has become
 *   unreliable, but lh3 has been stable for years. Falls back to the
 *   stored thumbnail_url if no gdrive_file_id is present, then to a
 *   "no preview" placeholder.
 *
 * If the <img> errors out (Drive hasn't generated a thumbnail for that
 * file — common for unusual codecs or files Drive is still processing),
 * we surface "thumbnail unavailable" rather than the browser's broken
 * image icon, so the failure is legible.
 */
export function ClipPreview({ clip }: { clip: ClipRow & { signedUrl?: string | null } }) {
  const [imgFailed, setImgFailed] = useState(false)

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

  const driveSrc =
    clip.source === 'gdrive' && clip.gdrive_file_id
      ? `https://lh3.googleusercontent.com/d/${clip.gdrive_file_id}=w320`
      : null
  const src = driveSrc ?? clip.thumbnail_url

  if (src && !imgFailed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
      />
    )
  }

  const label = clip.source === 'gdrive' ? 'thumbnail unavailable' : 'no preview'
  return (
    <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] uppercase tracking-[0.2em] text-neutral-600">
      {label}
    </div>
  )
}
