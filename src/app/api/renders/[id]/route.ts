import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })

type Params = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Params) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated', code: 'unauthenticated' },
      { status: 401 },
    )
  }

  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid render id', code: 'invalid_id' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('renders')
    .select(
      'id, artist_id, track_id, hook_id, status, output_url, aspect_ratio, template_id, error, created_at, updated_at',
    )
    .eq('id', parsed.data.id)
    .maybeSingle()
  if (error) {
    return NextResponse.json(
      { error: 'Failed to load render', code: 'load_failed' },
      { status: 500 },
    )
  }
  if (!data) {
    return NextResponse.json({ error: 'Render not found', code: 'not_found' }, { status: 404 })
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated', code: 'unauthenticated' },
      { status: 401 },
    )
  }

  const parsed = paramsSchema.safeParse(await params)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid render id', code: 'invalid_id' }, { status: 400 })
  }
  const { id } = parsed.data

  const { data: existing, error: lookupError } = await supabase
    .from('renders')
    .select('id, artist_id')
    .eq('id', id)
    .maybeSingle<{ id: string; artist_id: string }>()
  if (lookupError) {
    return NextResponse.json(
      { error: 'Failed to load render', code: 'load_failed' },
      { status: 500 },
    )
  }
  if (!existing) {
    return NextResponse.json({ error: 'Render not found', code: 'not_found' }, { status: 404 })
  }

  // Storage object key follows the `<artistId>/<renderId>.mp4` convention
  // (see uploadRenderOutput + cleanup-renders cron). Remove it best-effort
  // before deleting the row — storage RLS allows members to delete their own
  // artist's objects. Missing object isn't an error in Supabase Storage.
  await supabase.storage
    .from('renders')
    .remove([`${existing.artist_id}/${id}.mp4`])
    .catch(() => {})

  // `posts.render_id` is FK with `on delete set null`, so existing post rows
  // detach cleanly when the underlying render is removed.
  const { error: deleteError } = await supabase.from('renders').delete().eq('id', id)
  if (deleteError) {
    return NextResponse.json(
      { error: `Delete failed: ${deleteError.message}`, code: 'delete_failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
