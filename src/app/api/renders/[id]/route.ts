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
