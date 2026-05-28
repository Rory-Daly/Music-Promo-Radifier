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
      <main className="min-h-screen bg-brand-bg px-8 py-10 text-brand-fg">
        <p className="text-sm text-brand-fg-dim">No artist workspace found.</p>
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
    <main className="min-h-screen bg-brand-bg px-8 py-10 text-brand-fg">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.4em] text-brand-fg-faint">
              {activeMembership.artists.name} · Compose
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight">Build a reel</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/vault"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent hover:text-brand-fg"
            >
              Vault
            </Link>
            <Link
              href="/posts"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent hover:text-brand-fg"
            >
              Posts
            </Link>
            <Link
              href="/"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent hover:text-brand-fg"
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
