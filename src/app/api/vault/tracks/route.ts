import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { analyseLocalAudio, findTopHooks } from '@/lib/audio'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  artistId: z.string().uuid(),
  trackId: z.string().uuid(),
  path: z.string().min(1).max(512),
  title: z.string().trim().min(1).max(200),
})

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  try {
    return await handle(request)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err(`Unhandled: ${message}`, 500, 'unhandled')
  }
}

async function handle(request: NextRequest) {
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
  const { artistId, trackId, path, title } = parsed.data

  const expectedPrefix = `${artistId}/`
  if (!path.startsWith(expectedPrefix)) {
    return err('Storage path must start with the artist id', 400, 'bad_path')
  }

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  // Download the audio via the admin client so we can run ffmpeg on it.
  const admin = createSupabaseAdminClient()
  const { data: blob, error: downloadError } = await admin.storage
    .from('tracks')
    .download(path)
  if (downloadError || !blob) {
    return err(`Could not fetch uploaded audio: ${downloadError?.message ?? 'no data'}`, 404, 'object_missing')
  }

  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-upload-'))
  const ext = extname(path) || '.wav'
  const localPath = join(workDir, `audio${ext}`)
  let durationSeconds: number | undefined
  let hookCount = 0
  try {
    writeFileSync(localPath, Buffer.from(await blob.arrayBuffer()))
    const curve = await analyseLocalAudio(localPath)
    durationSeconds = curve.durationSeconds

    const { data: track, error: insertError } = await supabase
      .from('tracks')
      .insert({
        id: trackId,
        artist_id: artistId,
        title,
        audio_url: `tracks/${path}`,
        duration_seconds: durationSeconds,
      })
      .select('id')
      .single<{ id: string }>()
    if (insertError || !track) {
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
      if (!hookError) hookCount = hooks.length
    }

    return NextResponse.json(
      { trackId, title, durationSeconds, hookCount },
      { status: 201 },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return err(`Hook detection failed: ${message}`, 500, 'analysis_failed')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
