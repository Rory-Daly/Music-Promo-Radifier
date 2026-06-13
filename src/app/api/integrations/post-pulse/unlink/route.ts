import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { deleteSocialConnection } from '@/lib/post-pulse/connections'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const bodySchema = z.object({
  artistId: z.string().uuid(),
  platform: z.enum(['ig_reel', 'ig_story', 'ig_feed', 'tiktok', 'x', 'threads', 'fb']),
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
    return err('Invalid JSON', 400, 'invalid_json')
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return err(parsed.error.issues[0]?.message ?? 'Invalid body', 400, 'invalid_body')
  }
  const { artistId, platform } = parsed.data

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  await deleteSocialConnection(artistId, platform)
  return NextResponse.json({ ok: true })
}
