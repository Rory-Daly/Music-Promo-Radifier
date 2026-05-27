import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { analyseLocalAudio, findTopHooks } from '@/lib/audio'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { findAvailableTrackSlug } from '@/lib/tracks/slug'
import { parseSoundCloudUrl } from '@/lib/tracks/soundcloud'
import { downloadAudio, YtDlpFailedError, YtDlpMissingError } from '@/lib/tracks/yt-dlp'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  artistId: z.string().uuid(),
  trackId: z.string().uuid(),
  url: z.string().min(1).max(2048),
  title: z.string().trim().min(1).max(200),
})

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('Not authenticated', 401, 'unauthenticated')

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return err('Invalid JSON body', 400, 'invalid_json')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'Invalid body', 400, 'invalid_body')
  }
  const { artistId, trackId, url, title } = parsed.data

  const urlResult = parseSoundCloudUrl(url)
  if (!urlResult.ok) {
    return err(urlResult.reason, 400, 'invalid_url')
  }

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  // Fetch audio via yt-dlp → run hook detection → upload to Supabase Storage
  // → insert track + hooks. Same downstream flow as a direct upload so the
  // track is fully usable by compose/render.
  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-soundcloud-'))
  let durationSeconds: number | undefined
  let hookCount = 0
  let storagePath: string | undefined

  try {
    let download
    try {
      download = await downloadAudio(urlResult.canonicalUrl, workDir)
    } catch (e) {
      if (e instanceof YtDlpMissingError) return err(e.message, 500, 'ytdlp_missing')
      if (e instanceof YtDlpFailedError) return err(e.message, 502, 'ytdlp_failed')
      throw e
    }

    const curve = await analyseLocalAudio(download.filePath)
    durationSeconds = curve.durationSeconds

    const ext = download.extension || '.mp3'
    storagePath = `${artistId}/${trackId}${ext}`
    const audioBuffer = readFileSync(download.filePath)

    const admin = createSupabaseAdminClient()
    const { error: uploadError } = await admin.storage
      .from('tracks')
      .upload(storagePath, audioBuffer, {
        contentType: contentTypeForExt(ext),
        upsert: false,
      })
    if (uploadError) {
      return err(`Storage upload failed: ${uploadError.message}`, 500, 'upload_failed')
    }

    const slug = await findAvailableTrackSlug(supabase, artistId, title)

    const { error: insertError } = await supabase.from('tracks').insert({
      id: trackId,
      artist_id: artistId,
      title,
      slug,
      source: 'soundcloud',
      external_url: urlResult.canonicalUrl,
      audio_url: `tracks/${storagePath}`,
      duration_seconds: durationSeconds,
    })
    if (insertError) {
      // Roll back the storage upload so we don't leak orphan audio.
      await admin.storage.from('tracks').remove([storagePath]).catch(() => {})
      return err(`Insert track failed: ${insertError.message}`, 500, 'insert_failed')
    }

    const hooks = findTopHooks(curve, { count: 5 })
    if (hooks.length > 0) {
      const { error: hookError } = await supabase.from('hooks').insert(
        hooks.map((h) => ({
          track_id: trackId,
          start_seconds: h.startSeconds,
          end_seconds: h.endSeconds,
          score: h.score,
          label: h.label,
        })),
      )
      if (!hookError) hookCount = hooks.length
    }

    return NextResponse.json(
      { trackId, title, slug, durationSeconds, hookCount },
      { status: 201 },
    )
  } catch (e) {
    if (storagePath) {
      const admin = createSupabaseAdminClient()
      await admin.storage.from('tracks').remove([storagePath]).catch(() => {})
    }
    const message = e instanceof Error ? e.message : String(e)
    return err(`SoundCloud ingestion failed: ${message}`, 500, 'ingestion_failed')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function contentTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
    case '.mp4':
      return 'audio/mp4'
    case '.ogg':
    case '.opus':
      return 'audio/ogg'
    case '.wav':
      return 'audio/wav'
    case '.flac':
      return 'audio/flac'
    default:
      return 'application/octet-stream'
  }
}
