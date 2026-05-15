import { NextResponse, type NextRequest } from 'next/server'
import { OAUTH_COOKIE_NAME, type OAuthCookiePayload } from '@/lib/oauth/cookie'
import { exchangeCodeForTokens, readOAuthClientFromEnv } from '@/lib/oauth/google'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function back(returnTo: string, status: 'success' | 'error', message?: string) {
  const url = new URL(returnTo, 'http://placeholder')
  url.searchParams.set('drive', status)
  if (message) url.searchParams.set('msg', message)
  return NextResponse.redirect(url.pathname + url.search)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const errorParam = searchParams.get('error')

  const rawCookie = request.cookies.get(OAUTH_COOKIE_NAME)?.value
  if (!rawCookie) {
    return back('/vault', 'error', 'OAuth session expired. Try connecting again.')
  }
  let payload: OAuthCookiePayload
  try {
    payload = JSON.parse(rawCookie) as OAuthCookiePayload
  } catch {
    return back('/vault', 'error', 'Invalid OAuth cookie.')
  }
  const returnTo = payload.returnTo || '/vault'

  // Clear the cookie regardless of outcome so it can't be replayed.
  const clearCookie = (res: NextResponse): NextResponse => {
    res.cookies.set(OAUTH_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })
    return res
  }

  if (errorParam) {
    return clearCookie(back(returnTo, 'error', errorParam))
  }
  if (!code || !stateParam) {
    return clearCookie(back(returnTo, 'error', 'Missing code or state.'))
  }
  if (stateParam !== payload.state) {
    return clearCookie(back(returnTo, 'error', 'State mismatch.'))
  }

  const oauth = readOAuthClientFromEnv()
  if (!oauth) {
    return clearCookie(back(returnTo, 'error', 'OAuth client not configured on server.'))
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return clearCookie(NextResponse.redirect(new URL('/sign-in?next=/vault', request.url)))
  }

  const { data: membership } = await supabase
    .from('artist_memberships')
    .select('artist_id')
    .eq('artist_id', payload.artistId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return clearCookie(back(returnTo, 'error', 'Not a member of this artist.'))
  }

  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/integrations/google/callback`
  let tokens
  try {
    tokens = await exchangeCodeForTokens({
      code,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      redirectUri,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return clearCookie(back(returnTo, 'error', message.slice(0, 200)))
  }
  if (!tokens.refreshToken) {
    return clearCookie(
      back(
        returnTo,
        'error',
        'Google did not return a refresh token. Revoke the app on your Google Account → Security → "Apps with access" and reconnect.',
      ),
    )
  }

  const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000)
  const admin = createSupabaseAdminClient()
  const { error: upsertError } = await admin.from('artist_integrations').upsert(
    {
      artist_id: payload.artistId,
      provider: 'google_drive',
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: expiresAt.toISOString(),
      scope: tokens.scope,
      connected_by: user.id,
    },
    { onConflict: 'artist_id,provider' },
  )
  if (upsertError) {
    return clearCookie(back(returnTo, 'error', `Storing tokens failed: ${upsertError.message}`))
  }

  return clearCookie(back(returnTo, 'success'))
}
