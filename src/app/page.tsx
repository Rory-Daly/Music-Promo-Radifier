import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ClientDate } from '@/components/ClientDate'
import {
  ensureFirstArtist,
  getCurrentUserAndArtists,
  listRecentRenders,
  type RenderRow,
} from '@/lib/supabase/queries'

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

  const renders = activeMembership ? await listRecentRenders(activeMembership.artist_id, 6) : []

  return (
    <main className="min-h-screen bg-brand-bg px-8 py-10 text-brand-fg">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.4em] text-brand-fg-faint">Legatograph</p>
            <h1 className="mt-1 font-display text-3xl tracking-tight text-brand-fg">
              {activeMembership?.artists.name ?? 'Welcome'}
            </h1>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Link
              href="/compose"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent hover:text-brand-fg"
            >
              Compose
            </Link>
            <Link
              href="/vault"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent hover:text-brand-fg"
            >
              Vault
            </Link>
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="font-medium text-brand-fg-dim underline-offset-4 hover:text-brand-fg hover:underline"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-brand-fg-faint">Account</h2>
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
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-brand-fg-faint">
              Recent reels
            </h2>
            {renders.length > 0 ? (
              <span className="text-xs text-brand-fg-faint">{renders.length} most recent</span>
            ) : null}
          </div>
          {renders.length === 0 ? (
            <p className="text-sm text-brand-fg-dim">
              No reels yet. Open{' '}
              <Link href="/compose" className="underline underline-offset-2 hover:text-brand-fg">
                Compose
              </Link>{' '}
              to build one, or run{' '}
              <code className="text-brand-fg">npm run reel:auto -- --artistId=…</code> from the
              CLI.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {renders.map((render) => (
                <li key={render.id}>
                  <RenderCard render={render} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-brand-fg-faint">
            Next up
          </h2>
          <ul className="space-y-2 text-sm text-brand-fg-dim">
            <li>
              Upload tracks and clips in the{' '}
              <Link href="/vault" className="underline underline-offset-2">
                vault
              </Link>{' '}
              — hooks auto-detect on upload.
            </li>
            <li>
              Build a reel in{' '}
              <Link href="/compose" className="underline underline-offset-2">
                compose
              </Link>
              : pick a track + hook + clips and queue a render.
            </li>
          </ul>
        </section>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-brand-rule bg-brand-bg-2 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand-fg-faint">{label}</p>
      <p className="mt-1 truncate text-sm text-brand-fg">{value}</p>
    </div>
  )
}

function RenderCard({ render }: { render: RenderRow }) {
  const ready = render.status === 'ready' && render.output_url
  return (
    <div className="overflow-hidden rounded-md border border-brand-rule bg-brand-bg-2">
      <div className="aspect-[9/16] bg-brand-bg">
        {ready ? (
           
          <video
            src={render.output_url ?? undefined}
            className="h-full w-full object-cover"
            controls
            preload="metadata"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-4 text-center">
            <span className="text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
              {render.status}
              {render.error ? ` — ${render.error.slice(0, 60)}` : ''}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="font-mono uppercase tracking-[0.2em] text-brand-fg-faint">
          {render.aspect_ratio ?? 'reel'}
        </span>
        <span className="text-brand-fg-faint">
          <ClientDate value={render.created_at} />
        </span>
      </div>
    </div>
  )
}
