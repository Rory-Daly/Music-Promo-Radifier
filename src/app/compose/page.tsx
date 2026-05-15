import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ensureFirstArtist,
  getCurrentUserAndArtists,
  listClips,
  listHooksForTracks,
  listTracks,
} from '@/lib/supabase/queries'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { signStorageRefs } from '@/lib/storage/sign'
import { ComposeForm } from './ComposeForm'

export default async function ComposePage() {
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
  const hooks = await listHooksForTracks(tracks.map((t) => t.id))

  const supabase = await createSupabaseServerClient()
  const clipSignedUrls = await signStorageRefs(
    supabase,
    clips.map((c) => c.storage_url),
  )
  const clipsWithUrls = clips.map((c, i) => ({ ...c, signedUrl: clipSignedUrls[i] }))

  return (
    <main className="min-h-screen bg-neutral-950 px-8 py-10 text-neutral-100">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.4em] text-neutral-500">
              {activeMembership.artists.name} · Compose
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Build a reel</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/vault"
              className="rounded-md border border-neutral-800 px-3 py-1.5 font-medium text-neutral-200 transition hover:border-neutral-600 hover:text-white"
            >
              Vault
            </Link>
            <Link
              href="/"
              className="rounded-md border border-neutral-800 px-3 py-1.5 font-medium text-neutral-200 transition hover:border-neutral-600 hover:text-white"
            >
              Dashboard
            </Link>
          </div>
        </header>

        <ComposeForm
          artistId={activeMembership.artist_id}
          tracks={tracks}
          hooks={hooks}
          clips={clipsWithUrls}
        />
      </div>
    </main>
  )
}
