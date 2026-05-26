import Link from 'next/link'
import { redirect } from 'next/navigation'
import { loadBrandKit } from '@/lib/brand-kit/load'
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
      <main className="min-h-screen bg-brand-bg px-8 py-10 text-brand-fg">
        <p className="text-sm text-brand-fg-dim">No artist workspace found.</p>
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
  const brandKit = await loadBrandKit(activeMembership.artist_id)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3030'

  return (
    <main className="min-h-screen bg-brand-bg px-8 py-10 text-brand-fg">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.4em] text-brand-fg-faint">
              {activeMembership.artists.name} · Vault
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight">Tracks &amp; clips</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/compose"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent hover:text-brand-fg"
            >
              Compose
            </Link>
            <Link
              href="/"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent hover:text-brand-fg"
            >
              Dashboard
            </Link>
          </div>
        </header>

        <VaultClient
          artistId={activeMembership.artist_id}
          artistSlug={activeMembership.artists.slug}
          initialTracks={tracksWithUrls}
          initialClips={clipsWithUrls}
          driveOauthAvailable={driveOauthAvailable}
          driveConnected={driveConnected}
          brandKit={brandKit}
          appUrl={appUrl}
        />
      </div>
    </main>
  )
}
