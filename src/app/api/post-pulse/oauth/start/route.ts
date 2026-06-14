import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { buildPostPulseAuthUrl, readPostPulseOAuthClientFromEnv } from '@/lib/post-pulse/oauth'
import {
  POST_PULSE_OAUTH_COOKIE,
  POST_PULSE_OAUTH_COOKIE_MAX_AGE,
} from '@/lib/post-pulse/oauth-cookie'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const querySchema = z.object({
  returnTo: z.string().max(200).optional(),
})

export async function GET(request: NextRequest) {
  const oauth = readPostPulseOAuthClientFromEnv()
  if (!oauth) {
    return NextResponse.json(
      {
        error:
          'POST_PULSE_CLIENT_ID and POST_PULSE_CLIENT_SECRET are not set on the server. See docs/post-pulse.md.',
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
    return NextResponse.redirect(new URL('/sign-in?next=/settings', request.url))
  }

  const params = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  const returnTo = params.success ? (params.data.returnTo ?? '/settings') : '/settings'

  const state = randomBytes(24).toString('base64url')
  const cookieValue = JSON.stringify({ state, returnTo })
  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/post-pulse/oauth-callback`

  const authorizeUrl = buildPostPulseAuthUrl({
    clientId: oauth.clientId,
    redirectUri,
    state,
  })

  const response = NextResponse.redirect(authorizeUrl)
  response.cookies.set(POST_PULSE_OAUTH_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: POST_PULSE_OAUTH_COOKIE_MAX_AGE,
  })
  return response
}
