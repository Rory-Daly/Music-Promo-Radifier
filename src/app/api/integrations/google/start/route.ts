import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { OAUTH_COOKIE_NAME, OAUTH_COOKIE_MAX_AGE_SECONDS } from '@/lib/oauth/cookie'
import { buildAuthUrl, readOAuthClientFromEnv } from '@/lib/oauth/google'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const querySchema = z.object({
  artistId: z.string().uuid(),
  returnTo: z.string().max(200).optional(),
})

export async function GET(request: NextRequest) {
  const oauth = readOAuthClientFromEnv()
  if (!oauth) {
    return NextResponse.json(
      {
        error:
          'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are not set on the server. See docs/gdrive.md.',
        code: 'missing_env',
      },
      { status: 500 },
    )
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/sign-in?next=/vault', request.url))
  }

  const params = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!params.success) {
    return NextResponse.json(
      { error: 'Missing or invalid artistId', code: 'invalid_query' },
      { status: 400 },
    )
  }
  const { artistId, returnTo } = params.data

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

  const state = randomBytes(24).toString('base64url')
  const cookieValue = JSON.stringify({ state, artistId, returnTo: returnTo ?? '/vault' })
  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/integrations/google/callback`

  const authorizeUrl = buildAuthUrl({
    clientId: oauth.clientId,
    redirectUri,
    state,
  })

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set(OAUTH_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  })
  return response
}
