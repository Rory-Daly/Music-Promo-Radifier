import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const emailSchema = z.string().email({ message: 'Enter a valid email address.' })

type PageProps = {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>
}

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams
  const sent = params.sent === '1'
  const error = params.error

  async function signIn(formData: FormData) {
    'use server'
    const email = String(formData.get('email') ?? '').trim()
    const next = String(formData.get('next') ?? '/')
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      redirect(`/sign-in?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Invalid email')}`)
    }
    const supabase = await createSupabaseServerClient()
    const headersList = await headers()
    const host = headersList.get('host') ?? 'localhost:3000'
    const proto = headersList.get('x-forwarded-proto') ?? 'http'
    const origin = `${proto}://${host}`
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    if (signInError) {
      redirect(`/sign-in?error=${encodeURIComponent(signInError.message)}`)
    }
    redirect(`/sign-in?sent=1`)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-neutral-100">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.4em] text-neutral-500">Legatograph</p>
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-neutral-400">
            We&apos;ll email you a magic link. No password to remember.
          </p>
        </div>
        {sent ? (
          <div className="rounded-md border border-neutral-800 bg-neutral-900/60 p-4 text-sm">
            <p className="text-neutral-100">Check your inbox.</p>
            <p className="mt-1 text-neutral-400">
              Click the link in the email to finish signing in. You can close this tab in the meantime.
            </p>
          </div>
        ) : (
          <form action={signIn} className="space-y-4">
            <input type="hidden" name="next" value={params.next ?? '/'} />
            <label className="block space-y-2">
              <span className="text-sm text-neutral-400">Email</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
              />
            </label>
            {error ? (
              <p className="text-sm text-red-400">{error}</p>
            ) : null}
            <button
              type="submit"
              className="w-full rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-white"
            >
              Send magic link
            </button>
          </form>
        )}
        <p className="text-xs text-neutral-500">
          By signing in you agree to the{' '}
          <Link href="#" className="underline underline-offset-2 hover:text-neutral-300">
            terms
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
