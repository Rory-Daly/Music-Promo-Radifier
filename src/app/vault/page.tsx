import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ensureFirstArtist,
  getCurrentUserAndArtists,
  listClips,
  listTracks,
} from '@/lib/supabase/queries'
import { VaultClient } from './VaultClient'

export default async function VaultPage() {
  const { user, memberships } = await getCurrentUserAndArtists()
  if (!user) redirect('/sign-in')

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

  if (!activeMembership) {
    return (
      <main className="min-h-screen bg-neutral-950 px-8 py-10 text-neutral-100">
        <p className="text-sm text-neutral-400">No artist workspace found.</p>
      </main>
    )
  }

  const [tracks, clips] = await Promise.all([
    listTracks(activeMembership.artist_id),
    listClips(activeMembership.artist_id),
  ])

  return (
    <main className="min-h-screen bg-neutral-950 px-8 py-10 text-neutral-100">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.4em] text-neutral-500">
              {activeMembership.artists.name} · Vault
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tracks &amp; clips</h1>
          </div>
          <Link
            href="/"
            className="rounded-md border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:border-neutral-600 hover:text-white"
          >
            Dashboard
          </Link>
        </header>

        <VaultClient
          artistId={activeMembership.artist_id}
          initialTracks={tracks}
          initialClips={clips}
        />
      </div>
    </main>
  )
}
