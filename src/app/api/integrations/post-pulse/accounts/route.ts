import { NextResponse } from 'next/server'
import { listAccounts } from '@/lib/post-pulse/client'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Lists Post-Pulse social accounts available in the workspace, used by
 * the Settings page to populate a picker. Falls back to an empty list if
 * Post-Pulse isn't configured or the endpoint shape is unexpected — the
 * UI degrades to manual `socialMediaAccountId` entry.
 */
export async function GET() {
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

  if (!process.env.POST_PULSE_API_KEY) {
    return NextResponse.json({ accounts: [], configured: false })
  }

  try {
    const accounts = await listAccounts()
    return NextResponse.json({ accounts, configured: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error listing accounts'
    return NextResponse.json({ accounts: [], configured: true, error: message })
  }
}
