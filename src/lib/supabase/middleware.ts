import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// `/r` is the public smart-link namespace at /r/<artist>/<track>; fans need
// to land there without an auth wall. `/api/cron` is invoked by Vercel Cron
// (and any future scheduler) which authenticates via the CRON_SECRET bearer
// token inside the route, not via Supabase Auth — so it has to bypass the
// session redirect or the request gets 307'd to /sign-in before the route
// handler runs.
const PUBLIC_PATHS = [
  '/sign-in',
  '/auth/callback',
  '/auth/sign-out',
  '/r',
  '/api/cron',
]

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone()
    redirect.pathname = '/sign-in'
    redirect.searchParams.set('next', pathname)
    return NextResponse.redirect(redirect)
  }
  if (user && pathname === '/sign-in') {
    const redirect = request.nextUrl.clone()
    redirect.pathname = '/'
    redirect.search = ''
    return NextResponse.redirect(redirect)
  }

  return response
}
