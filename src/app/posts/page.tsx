import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ensureFirstArtist,
  getCurrentUserAndArtists,
  listPosts,
} from '@/lib/supabase/queries'
import { PostsClient } from './PostsClient'

export default async function PostsPage() {
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

  const posts = await listPosts(activeMembership.artist_id)

  return (
    <main className="min-h-screen bg-brand-bg px-8 py-10 text-brand-fg">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.4em] text-brand-fg-faint">
              {activeMembership.artists.name} · Posts
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight">Posts</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/compose"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent"
            >
              Compose
            </Link>
            <Link
              href="/vault"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent"
            >
              Vault
            </Link>
            <Link
              href="/"
              className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent"
            >
              Dashboard
            </Link>
          </div>
        </header>

        <PostsClient initialPosts={posts} />
      </div>
    </main>
  )
}
