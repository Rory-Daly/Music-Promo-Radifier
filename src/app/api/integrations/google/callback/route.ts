import { NextResponse, type NextRequest } from 'next/server'
import { OAUTH_COOKIE_NAME, type OAuthCookiePayload } from '@/lib/oauth/cookie'
import { exchangeCodeForTokens, readOAuthClientFromEnv } from '@/lib/oauth/google'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function back(
  origin: string,
  returnTo: string,
  status: 'success' | 'error',
  provider: 'google_drive' | 'youtube',
  message?: string,
) {
  const url = new URL(returnTo, origin)
  // Older flows query for `drive=success|error`; keep that param name so
  // existing UI listeners on the vault page don't break. Add a generic
  // `oauth` param too so the YouTube banner can react to the same flow.
  if (provider === 'google_drive') url.searchParams.set('drive', status)
  url.searchParams.set('oauth', status)
  url.searchParams.set('oauth_provider', provider)
  if (message) url.searchParams.set('msg', message)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const errorParam = searchParams.get('error')

  const rawCookie = request.cookies.get(OAUTH_COOKIE_NAME)?.value
  if (!rawCookie) {
    return back(origin, '/vault', 'error', 'google_drive', 'OAuth session expired. Try connecting again.')
  }
  let payload: OAuthCookiePayload
  try {
    payload = JSON.parse(rawCookie) as OAuthCookiePayload
  } catch {
    return back(origin, '/vault', 'error', 'google_drive', 'Invalid OAuth cookie.')
  }
  const returnTo = payload.returnTo || '/vault'
  // Cookies written before the YouTube integration shipped omit `provider`;
  // default to drive so legacy in-flight flows keep working.
  const provider = payload.provider ?? 'google_drive'

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
    return clearCookie(back(origin, returnTo, 'error', provider, errorParam))
  }
  if (!code || !stateParam) {
    return clearCookie(back(origin, returnTo, 'error', provider, 'Missing code or state.'))
  }
  if (stateParam !== payload.state) {
    return clearCookie(back(origin, returnTo, 'error', provider, 'State mismatch.'))
  }

  const oauth = readOAuthClientFromEnv()
  if (!oauth) {
    return clearCookie(back(origin, returnTo, 'error', provider, 'OAuth client not configured on server.'))
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
    return clearCookie(back(origin, returnTo, 'error', provider, 'Not a member of this artist.'))
  }

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
    return clearCookie(back(origin, returnTo, 'error', provider, message.slice(0, 200)))
  }
  if (!tokens.refreshToken) {
    return clearCookie(
      back(
        origin,
        returnTo,
        'error',
        provider,
        'Google did not return a refresh token. Revoke the app on your Google Account → Security → "Apps with access" and reconnect.',
      ),
    )
  }

  const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000)
  const admin = createSupabaseAdminClient()
  const { error: upsertError } = await admin.from('artist_integrations').upsert(
    {
      artist_id: payload.artistId,
      provider,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: expiresAt.toISOString(),
      scope: tokens.scope,
      connected_by: user.id,
    },
    { onConflict: 'artist_id,provider' },
  )
  if (upsertError) {
    return clearCookie(back(origin, returnTo, 'error', provider, `Storing tokens failed: ${upsertError.message}`))
  }

  return clearCookie(back(origin, returnTo, 'success', provider))
}
