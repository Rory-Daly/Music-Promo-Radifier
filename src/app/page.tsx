import { redirect } from 'next/navigation'
import { ensureFirstArtist, getCurrentUserAndArtists } from '@/lib/supabase/queries'

export default async function HomePage() {
  const { user, memberships } = await getCurrentUserAndArtists()
  if (!user) {
    redirect('/sign-in')
  }

  let activeMembership = memberships[0]
  if (!activeMembership) {
    const defaultName =
      typeof user.user_metadata?.name === 'string' && user.user_metadata.name.length > 0
        ? user.user_metadata.name
        : (user.email?.split('@')[0] ?? 'My artist')
    const artist = await ensureFirstArtist(defaultName)
    if (artist) {
      activeMembership = { artist_id: artist.id, role: 'owner', artists: artist }
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-8 py-10 text-neutral-100">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.4em] text-neutral-500">Legatograph</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {activeMembership?.artists.name ?? 'Welcome'}
            </h1>
          </div>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="text-xs font-medium text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline"
            >
              Sign out
            </button>
          </form>
        </header>

        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">Account</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Signed in as" value={user.email ?? '—'} />
            <Stat
              label="Active artist"
              value={activeMembership?.artists.name ?? 'None yet'}
            />
            <Stat label="Memberships" value={String(memberships.length || 1)} />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">
            Next up
          </h2>
          <ul className="space-y-2 text-sm text-neutral-300">
            <li>
              The standalone CLI (<code className="text-neutral-100">npm run reel:auto</code>) is the
              fastest path to a beat-aligned reel today.
            </li>
            <li>
              The vault (track + clip uploads, brand kit, social connections) lands in the next
              iteration.
            </li>
            <li>
              Multi-artist switching ships when you have a second artist; for now your one workspace
              is selected automatically.
            </li>
          </ul>
        </section>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">{label}</p>
      <p className="mt-1 truncate text-sm text-neutral-100">{value}</p>
    </div>
  )
}
