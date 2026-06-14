import { NextResponse } from 'next/server'
import { deletePostPulseTokens } from '@/lib/post-pulse/tokens'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST() {
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
  await deletePostPulseTokens()
  return NextResponse.json({ ok: true })
}
