import Link from 'next/link'
import { redirect } from 'next/navigation'
import { listSocialConnectionsForArtist } from '@/lib/post-pulse/connections'
import { getCurrentUserAndArtists } from '@/lib/supabase/queries'
import { SettingsClient } from './SettingsClient'

export default async function SettingsPage() {
  const { user, memberships } = await getCurrentUserAndArtists()
  if (!user) redirect('/sign-in?next=/settings')

  const activeMembership = memberships[0]
  if (!activeMembership) {
    return (
      <main className="min-h-screen bg-brand-bg px-8 py-10 text-brand-fg">
        <p className="text-sm text-brand-fg-dim">No artist workspace found.</p>
      </main>
    )
  }

  const connections = await listSocialConnectionsForArtist(activeMembership.artist_id)
  const apiKeyConfigured = Boolean(process.env.POST_PULSE_API_KEY)

  return (
    <main className="min-h-screen bg-brand-bg px-8 py-10 text-brand-fg">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.4em] text-brand-fg-faint">
              {activeMembership.artists.name} · Settings
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight">Settings</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/posts"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent"
            >
              Posts
            </Link>
            <Link
              href="/"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent"
            >
              Dashboard
            </Link>
          </div>
        </header>

        <SettingsClient
          artistId={activeMembership.artist_id}
          initialConnections={connections}
          apiKeyConfigured={apiKeyConfigured}
        />
      </div>
    </main>
  )
}
