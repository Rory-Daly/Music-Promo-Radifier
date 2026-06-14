import { NextResponse, type NextRequest } from 'next/server'
import {
  exchangePostPulseCodeForTokens,
  readPostPulseOAuthClientFromEnv,
} from '@/lib/post-pulse/oauth'
import {
  POST_PULSE_OAUTH_COOKIE,
  type PostPulseOAuthCookiePayload,
} from '@/lib/post-pulse/oauth-cookie'
import { setPostPulseTokens } from '@/lib/post-pulse/tokens'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function back(origin: string, returnTo: string, status: 'success' | 'error', message?: string) {
  const url = new URL(returnTo, origin)
  url.searchParams.set('post_pulse', status)
  if (message) url.searchParams.set('msg', message)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const stateParam = searchParams.get('state')
  const errorParam = searchParams.get('error')

  const rawCookie = request.cookies.get(POST_PULSE_OAUTH_COOKIE)?.value
  if (!rawCookie) {
    return back(origin, '/settings', 'error', 'OAuth session expired. Try connecting again.')
  }
  let payload: PostPulseOAuthCookiePayload
  try {
    payload = JSON.parse(rawCookie) as PostPulseOAuthCookiePayload
  } catch {
    return back(origin, '/settings', 'error', 'Invalid OAuth cookie.')
  }
  const returnTo = payload.returnTo || '/settings'

  const clearCookie = (res: NextResponse): NextResponse => {
    res.cookies.set(POST_PULSE_OAUTH_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })
    return res
  }

  if (errorParam) {
    return clearCookie(back(origin, returnTo, 'error', errorParam))
  }
  if (!code || !stateParam) {
    return clearCookie(back(origin, returnTo, 'error', 'Missing code or state.'))
  }
  if (stateParam !== payload.state) {
    return clearCookie(back(origin, returnTo, 'error', 'State mismatch.'))
  }

  const oauth = readPostPulseOAuthClientFromEnv()
  if (!oauth) {
    return clearCookie(back(origin, returnTo, 'error', 'OAuth client not configured on server.'))
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return clearCookie(NextResponse.redirect(new URL('/sign-in?next=/settings', request.url)))
  }

  const redirectUri = `${origin}/api/post-pulse/oauth-callback`
  let tokens
  try {
    tokens = await exchangePostPulseCodeForTokens({
      code,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      redirectUri,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return clearCookie(back(origin, returnTo, 'error', message.slice(0, 200)))
  }
  if (!tokens.refreshToken) {
    return clearCookie(
      back(
        origin,
        returnTo,
        'error',
        'Post-Pulse did not return a refresh token. Make sure the `offline_access` scope is enabled for this application in the Post-Pulse dashboard, then disconnect and reconnect.',
      ),
    )
  }

  try {
    await setPostPulseTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: tokens.expiresInSeconds,
      scope: tokens.scope,
      connectedBy: user.id,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return clearCookie(back(origin, returnTo, 'error', `Storing tokens failed: ${message}`))
  }

  return clearCookie(back(origin, returnTo, 'success'))
}
