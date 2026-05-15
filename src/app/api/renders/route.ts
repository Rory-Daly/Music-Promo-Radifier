import { after, NextResponse, type NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { runRender } from '@/lib/render/engine'
import { parseStoragePath, renderRequestSchema } from '@/lib/render/request'

export const runtime = 'nodejs'
export const maxDuration = 300

function err(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err('Not authenticated', 401, 'unauthenticated')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON body', 400, 'invalid_json')
  }

  const parsed = renderRequestSchema.safeParse(body)
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'Invalid request', 400, 'invalid_request')
  }
  const input = parsed.data

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', input.artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  const { data: track, error: trackError } = await supabase
    .from('tracks')
    .select('id, artist_id, audio_url, title')
    .eq('id', input.trackId)
    .single()
  if (trackError || !track) return err('Track not found', 404, 'track_not_found')
  if (track.artist_id !== input.artistId) return err('Track belongs to another artist', 403, 'forbidden')

  const audioRef = parseStoragePath(track.audio_url)
  if (!audioRef) return err('Track has no playable audio_url', 422, 'no_audio')

  let hookStartSeconds = input.hookStartSeconds
  let hookEndSeconds = input.hookEndSeconds
  if (input.hookId) {
    const { data: hook, error: hookError } = await supabase
      .from('hooks')
      .select('id, track_id, start_seconds, end_seconds')
      .eq('id', input.hookId)
      .single()
    if (hookError || !hook) return err('Hook not found', 404, 'hook_not_found')
    if (hook.track_id !== input.trackId) {
      return err('Hook does not belong to this track', 400, 'hook_mismatch')
    }
    hookStartSeconds = Number(hook.start_seconds)
    hookEndSeconds = Number(hook.end_seconds)
  }
  if (hookStartSeconds === undefined || hookEndSeconds === undefined) {
    return err('Hook range could not be resolved', 400, 'hook_unresolved')
  }
  const resolvedHookStart = hookStartSeconds
  const resolvedHookEnd = hookEndSeconds

  const { data: clipRows, error: clipsError } = await supabase
    .from('clips')
    .select('id, artist_id, storage_url')
    .in('id', input.clipIds)
  if (clipsError) return err('Failed to load clips', 500, 'clips_query_failed')
  if (!clipRows || clipRows.length !== input.clipIds.length) {
    return err('One or more clips not found', 404, 'clip_not_found')
  }
  const clipRefs: Array<{ bucket: string; path: string }> = []
  for (const clip of clipRows) {
    if (clip.artist_id !== input.artistId) {
      return err('Clip belongs to another artist', 403, 'forbidden')
    }
    const ref = parseStoragePath(clip.storage_url)
    if (!ref) return err(`Clip ${clip.id} has no storage_url`, 422, 'no_clip_storage')
    clipRefs.push(ref)
  }

  const { data: created, error: insertError } = await supabase
    .from('renders')
    .insert({
      artist_id: input.artistId,
      track_id: input.trackId,
      hook_id: input.hookId ?? null,
      template_id: 'basic-reel',
      aspect_ratio: '9x16',
      clip_ids: input.clipIds,
      status: 'queued',
    })
    .select('id')
    .single<{ id: string }>()
  if (insertError || !created) {
    return err('Failed to queue render', 500, 'insert_failed')
  }

  const adminClient = createSupabaseAdminClient()
  after(async () => {
    try {
      await runRender(adminClient, {
        renderId: created.id,
        artistId: input.artistId,
        audioBucket: audioRef.bucket,
        audioPath: audioRef.path,
        hookStartSeconds: resolvedHookStart,
        hookEndSeconds: resolvedHookEnd,
        clips: clipRefs,
        title: input.title ?? track.title,
        cta: input.cta,
        artistName: input.artistName,
        slowmo: input.slowmo,
        noOverlays: input.noOverlays,
      })
    } catch (e) {
      console.error('render failed:', e instanceof Error ? e.message : String(e))
    }
  })

  return NextResponse.json({ renderId: created.id, status: 'queued' }, { status: 202 })
}
