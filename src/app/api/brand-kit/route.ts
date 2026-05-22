import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { brandKitSchema } from '@/lib/brand-kit/schema'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const bodySchema = z.object({
  artistId: z.string().uuid(),
  brandKit: brandKitSchema,
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
  const { artistId, brandKit } = parsed.data

  // Membership check: RLS would block the update anyway, but failing fast
  // here gives a clean 403 instead of a silent zero-row update.
  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return err('Not a member of this artist', 403, 'forbidden')

  const { error: updateError } = await supabase
    .from('artists')
    .update({ brand_kit: brandKit, updated_at: new Date().toISOString() })
    .eq('id', artistId)
  if (updateError) {
    return err(`Update failed: ${updateError.message}`, 500, 'update_failed')
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
