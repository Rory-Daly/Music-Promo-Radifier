import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { analyseLocalAudio, findTopHooks } from '@/lib/audio'

export const runtime = 'nodejs'
export const maxDuration = 300

const ALLOWED_AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.aiff', '.aif', '.m4a', '.ogg'])
const MAX_AUDIO_BYTES = 256 * 1024 * 1024 // 256 MB

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  try {
    return await handle(request)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (/body size|413|payload/i.test(message)) {
      return err(`Upload exceeded server body limit. ${message}`, 413, 'body_too_large')
    }
    return err(`Upload failed: ${message}`, 500, 'unhandled')
  }
}

async function handle(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('Not authenticated', 401, 'unauthenticated')

  const form = await request.formData()
  const file = form.get('file')
  const artistId = String(form.get('artistId') ?? '')
  const titleRaw = String(form.get('title') ?? '').trim()

  if (!(file instanceof File)) return err('Missing file', 400, 'missing_file')
  if (!artistId) return err('Missing artistId', 400, 'missing_artist')
  if (file.size === 0) return err('Empty file', 400, 'empty_file')
  if (file.size > MAX_AUDIO_BYTES) return err('File exceeds 256 MB', 413, 'file_too_large')
  const ext = extname(file.name).toLowerCase()
  if (!ALLOWED_AUDIO_EXT.has(ext)) {
    return err(`Unsupported audio format: ${ext}`, 415, 'unsupported_format')
  }
  const title = titleRaw.length > 0 ? titleRaw : file.name.replace(/\.[^.]+$/, '')

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  const trackId = randomUUID()
  const objectKey = `${artistId}/${trackId}${ext}`

  const bytes = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage
    .from('tracks')
    .upload(objectKey, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (uploadError) return err(`Upload failed: ${uploadError.message}`, 500, 'upload_failed')

  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-upload-'))
  const localPath = join(workDir, `audio${ext}`)
  let durationSeconds: number | undefined
  let hookCount = 0
  try {
    writeFileSync(localPath, bytes)
    const curve = await analyseLocalAudio(localPath)
    durationSeconds = curve.durationSeconds

    const { data: track, error: insertError } = await supabase
      .from('tracks')
      .insert({
        id: trackId,
        artist_id: artistId,
        title,
        audio_url: `tracks/${objectKey}`,
        duration_seconds: durationSeconds,
      })
      .select('id')
      .single<{ id: string }>()
    if (insertError || !track) {
      await supabase.storage.from('tracks').remove([objectKey]).catch(() => {})
      return err(`Insert track failed: ${insertError?.message ?? 'unknown'}`, 500, 'insert_failed')
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
      if (hookError) {
        console.error('hook insert failed:', hookError.message)
      } else {
        hookCount = hooks.length
      }
    }

    return NextResponse.json(
      {
        trackId,
        title,
        durationSeconds,
        hookCount,
      },
      { status: 201 },
    )
  } catch (e) {
    await supabase.storage.from('tracks').remove([objectKey]).catch(() => {})
    try {
      await supabase.from('tracks').delete().eq('id', trackId)
    } catch {
      // best-effort cleanup
    }
    const message = e instanceof Error ? e.message : String(e)
    return err(`Hook detection failed: ${message}`, 500, 'analysis_failed')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
