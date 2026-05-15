import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isDriveConnected } from '@/lib/oauth/drive-tokens'
import { readOAuthClientFromEnv } from '@/lib/oauth/google'
import {
  ensureFirstArtist,
  getCurrentUserAndArtists,
  listClips,
  listTracks,
} from '@/lib/supabase/queries'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { signStorageRefs } from '@/lib/storage/sign'
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

  const supabase = await createSupabaseServerClient()
  const [trackSignedUrls, clipSignedUrls] = await Promise.all([
    signStorageRefs(
      supabase,
      tracks.map((t) => t.audio_url),
    ),
    signStorageRefs(
      supabase,
      clips.map((c) => c.storage_url),
    ),
  ])

  const tracksWithUrls = tracks.map((t, i) => ({ ...t, signedUrl: trackSignedUrls[i] }))
  const clipsWithUrls = clips.map((c, i) => ({ ...c, signedUrl: clipSignedUrls[i] }))

  const driveOauthAvailable = readOAuthClientFromEnv() !== null
  const driveConnected = driveOauthAvailable
    ? await isDriveConnected(activeMembership.artist_id)
    : false

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
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/compose"
              className="rounded-md border border-neutral-800 px-3 py-1.5 font-medium text-neutral-200 transition hover:border-neutral-600 hover:text-white"
            >
              Compose
            </Link>
            <Link
              href="/"
              className="rounded-md border border-neutral-800 px-3 py-1.5 font-medium text-neutral-200 transition hover:border-neutral-600 hover:text-white"
            >
              Dashboard
            </Link>
          </div>
        </header>

        <VaultClient
          artistId={activeMembership.artist_id}
          initialTracks={tracksWithUrls}
          initialClips={clipsWithUrls}
          driveOauthAvailable={driveOauthAvailable}
          driveConnected={driveConnected}
        />
      </div>
    </main>
  )
}
