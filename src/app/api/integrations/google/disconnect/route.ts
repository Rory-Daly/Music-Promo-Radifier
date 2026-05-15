import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { deleteDriveIntegration } from '@/lib/oauth/drive-tokens'
import { revokeToken } from '@/lib/oauth/google'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const bodySchema = z.object({ artistId: z.string().uuid() })

export async function POST(request: NextRequest) {
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

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'invalid_json' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body', code: 'invalid_body' },
      { status: 400 },
    )
  }
  const { artistId } = parsed.data

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json(
      { error: 'Not a member of this artist', code: 'forbidden' },
      { status: 403 },
    )
  }

  const token = await deleteDriveIntegration(artistId)
  if (token) await revokeToken(token)
  return NextResponse.json({ disconnected: true })
}
