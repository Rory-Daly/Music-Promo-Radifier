'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { ClientDate } from '@/components/ClientDate'
import { useDeferredDelete } from '@/hooks/useDeferredDelete'
import type { PostPlatform, PostRow, PostStatus } from '@/lib/supabase/queries'
import { cn } from '@/lib/utils'

const PLATFORM_LABEL: Record<PostPlatform, string> = {
  ig_reel: 'IG Reel',
  ig_story: 'IG Story',
  ig_feed: 'IG Feed',
  tiktok: 'TikTok',
  yt_short: 'YT Short',
  x: 'X',
  threads: 'Threads',
  fb: 'Facebook',
}

const STATUS_ORDER: PostStatus[] = ['draft', 'scheduled', 'published', 'failed']
const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Drafts',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
}

type Props = {
  initialPosts: PostRow[]
  artistId: string
  youtubeConnected: boolean
}

export function PostsClient({ initialPosts, artistId, youtubeConnected }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
    | { kind: 'reconnect'; message: string; href: string; cta: string }
    | null
  >(null)

  const deleteEndpoint = useCallback((id: string) => `/api/posts/${id}`, [])
  const { pendingIds: pendingDeleteIds, schedule: scheduleDelete } = useDeferredDelete({
    endpoint: deleteEndpoint,
    toastLabel: 'Post deleted',
  })

  const groups = useMemo(() => {
    const g: Record<PostStatus, PostRow[]> = {
      draft: [],
      scheduled: [],
      published: [],
      failed: [],
    }
    for (const p of initialPosts) {
      if (pendingDeleteIds.has(p.id)) continue
      g[p.status].push(p)
    }
    return g
  }, [initialPosts, pendingDeleteIds])

  async function call(
    url: string,
    init: RequestInit,
    okMessage: string,
    postId: string,
  ): Promise<boolean> {
    setBusy(postId)
    setBanner(null)
    try {
      const res = await fetch(url, init)
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setBanner({ kind: 'error', message: body?.error ?? `Request failed (${res.status})` })
        return false
      }
      setBanner({ kind: 'success', message: okMessage })
      startTransition(() => router.refresh())
      return true
    } catch (e) {
      setBanner({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Request failed',
      })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function saveCaption(post: PostRow, caption: string) {
    await call(
      `/api/posts/${post.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption }),
      },
      'Caption saved',
      post.id,
    )
  }

  async function schedule(post: PostRow, scheduledFor: string | null) {
    await call(
      `/api/posts/${post.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor }),
      },
      scheduledFor ? 'Scheduled' : 'Reverted to draft',
      post.id,
    )
  }

  function remove(post: PostRow) {
    // Deferred-delete + undo (see docs/ux-principles.md §4). The hook
    // hides the card immediately, shows an undo toast, and only fires
    // the DELETE once the undo window closes.
    scheduleDelete(post.id)
  }

  async function publish(post: PostRow) {
    setBusy(post.id)
    setBanner(null)
    try {
      const res = await fetch(`/api/posts/${post.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = (await res.json().catch(() => null)) as
        | { error?: string; code?: string }
        | null
      if (!res.ok) {
        if (body?.code === 'post_pulse_not_connected') {
          setBanner({
            kind: 'reconnect',
            message: 'Post-Pulse is not connected. Reconnect to publish to IG / TikTok / X / Threads / Facebook.',
            href: '/settings',
            cta: 'Reconnect Post-Pulse →',
          })
        } else {
          setBanner({
            kind: 'error',
            message: body?.error ?? `Publish failed (${res.status})`,
          })
        }
        return
      }
      setBanner({ kind: 'success', message: 'Published' })
      startTransition(() => router.refresh())
    } catch (e) {
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Publish failed' })
    } finally {
      setBusy(null)
    }
  }

  async function disconnectYouTube() {
    setBusy('youtube_disconnect')
    setBanner(null)
    try {
      const res = await fetch('/api/integrations/youtube/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setBanner({
          kind: 'error',
          message: body?.error ?? `Disconnect failed (${res.status})`,
        })
        return
      }
      setBanner({ kind: 'success', message: 'YouTube disconnected' })
      startTransition(() => router.refresh())
    } finally {
      setBusy(null)
    }
  }

  const connectionBanner = (
    <ConnectionsBanner
      artistId={artistId}
      youtubeConnected={youtubeConnected}
      onDisconnectYouTube={disconnectYouTube}
      busy={busy === 'youtube_disconnect'}
    />
  )

  const visibleCount = STATUS_ORDER.reduce((sum, s) => sum + groups[s].length, 0)
  if (visibleCount === 0) {
    return (
      <div className="space-y-6">
        {connectionBanner}
        <section className="rounded-md border border-brand-rule bg-brand-bg-2 p-6 text-center">
          <p className="text-sm text-brand-fg-dim">
            No posts yet. Open{' '}
            <a href="/compose" className="text-brand-fg underline-offset-2 hover:underline">
              Compose
            </a>{' '}
            to draft a reel, generate captions, and save them here as drafts.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {connectionBanner}

      {banner ? (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm',
            banner.kind === 'success'
              ? 'border-brand-rule bg-brand-bg-2 text-brand-fg'
              : 'border-brand-accent-2 bg-brand-bg-2 text-brand-fg',
          )}
        >
          <p className="min-w-0">{banner.message}</p>
          <div className="flex shrink-0 items-center gap-2">
            {banner.kind === 'reconnect' ? (
              <a
                href={banner.href}
                className="rounded-md border border-brand-accent bg-brand-accent/15 px-3 py-1 text-xs font-medium text-brand-fg transition hover:bg-brand-accent/25"
              >
                {banner.cta}
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="rounded-md border border-brand-rule px-2 py-1 text-xs font-medium text-brand-fg-dim transition hover:text-brand-fg"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {STATUS_ORDER.map((status) => {
        const posts = groups[status]
        if (posts.length === 0) return null
        return (
          <section key={status} className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-brand-fg-faint">
              {STATUS_LABEL[status]} · {posts.length}
            </h2>
            <ul className="space-y-3">
              {posts.map((p) => (
                <li key={p.id}>
                  <PostCard
                    post={p}
                    busy={busy === p.id}
                    youtubeConnected={youtubeConnected}
                    onSaveCaption={(caption) => saveCaption(p, caption)}
                    onSchedule={(when) => schedule(p, when)}
                    onDelete={() => remove(p)}
                    onPublish={() => publish(p)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function PostCard({
  post,
  busy,
  youtubeConnected,
  onSaveCaption,
  onSchedule,
  onDelete,
  onPublish,
}: {
  post: PostRow
  busy: boolean
  youtubeConnected: boolean
  onSaveCaption: (caption: string) => void | Promise<void>
  onSchedule: (when: string | null) => void | Promise<void>
  onDelete: () => void | Promise<void>
  onPublish: () => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(post.caption ?? '')
  const [whenLocal, setWhenLocal] = useState(() => toLocalDatetimeInput(post.scheduled_for))

  const locked = post.status === 'published'
  const aspectClass = aspectClassFor(post.render_aspect_ratio)

  return (
    <article className="grid grid-cols-1 gap-4 rounded-md border border-brand-rule bg-brand-bg-2 p-4 sm:grid-cols-[180px_1fr]">
      <div className="space-y-2">
        <div className={cn('overflow-hidden rounded border border-brand-rule bg-brand-bg', aspectClass)}>
          {post.render_output_url ? (
            <video
              src={post.render_output_url}
              className="h-full w-full object-cover"
              controls
              preload="metadata"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-3 text-center text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
              No render attached
            </div>
          )}
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
          {PLATFORM_LABEL[post.platform]}
          {post.render_aspect_ratio ? ` · ${post.render_aspect_ratio}` : ''}
        </p>
      </div>

      <div className="space-y-3">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-brand-fg">
            {post.track_title ?? 'Untitled post'}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
            <ClientDate value={post.created_at} mode="date" />
          </p>
        </header>

        {post.error && post.status === 'failed' ? (
          <p className="rounded border border-brand-accent-2 bg-brand-bg px-2 py-1 font-mono text-[11px] text-brand-accent-2">
            {post.error}
          </p>
        ) : null}

        {editing && !locked ? (
          <div className="space-y-2">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              className="block w-full rounded-md border border-brand-rule bg-brand-bg p-2 font-body text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-brand-fg-faint">{caption.length} chars</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setCaption(post.caption ?? '')
                    setEditing(false)
                  }}
                  className="rounded-md border border-brand-rule px-2.5 py-1 font-medium text-brand-fg-dim transition hover:text-brand-fg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await onSaveCaption(caption)
                    setEditing(false)
                  }}
                  className="rounded-md border border-brand-accent bg-brand-accent px-2.5 py-1 font-medium text-brand-bg transition disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save caption'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-body text-sm text-brand-fg-dim">
            {post.caption?.trim() || <span className="italic text-brand-fg-faint">No caption</span>}
          </pre>
        )}

        {!locked ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-rule pt-3">
            <label className="flex items-center gap-2 text-xs">
              <span className="font-mono uppercase tracking-[0.2em] text-brand-fg-faint">
                Schedule
              </span>
              <input
                type="datetime-local"
                value={whenLocal}
                disabled={busy}
                onChange={(e) => setWhenLocal(e.target.value)}
                className="rounded-md border border-brand-rule bg-brand-bg px-2 py-1 text-xs text-brand-fg focus:border-brand-accent focus:outline-none"
              />
            </label>
            <div className="flex flex-wrap gap-2 text-xs">
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={busy}
                  className="rounded-md border border-brand-rule px-2.5 py-1 font-medium text-brand-fg-dim transition hover:text-brand-fg"
                >
                  Edit caption
                </button>
              ) : null}
              {post.status === 'scheduled' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSchedule(null)}
                  className="rounded-md border border-brand-rule px-2.5 py-1 font-medium text-brand-fg-dim transition hover:text-brand-fg"
                >
                  Revert to draft
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || whenLocal.length === 0}
                onClick={() => onSchedule(localInputToIso(whenLocal))}
                className="rounded-md border border-brand-accent bg-brand-accent px-2.5 py-1 font-medium text-brand-bg transition disabled:opacity-50"
              >
                {post.status === 'scheduled' ? 'Update schedule' : 'Schedule'}
              </button>
              {publishSupportedForPlatform(post.platform) ? (
                <button
                  type="button"
                  disabled={
                    busy ||
                    !post.render_id ||
                    (post.platform === 'yt_short' && !youtubeConnected)
                  }
                  onClick={onPublish}
                  title={
                    !post.render_id
                      ? 'Attach a render before publishing'
                      : post.platform === 'yt_short' && !youtubeConnected
                        ? 'Connect YouTube above to enable publishing'
                        : 'Publish to YouTube now'
                  }
                  className="rounded-md border border-brand-fg bg-brand-fg px-2.5 py-1 font-medium text-brand-bg transition disabled:opacity-50"
                >
                  {busy ? 'Publishing…' : 'Publish now'}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="rounded-md border border-brand-accent-2 px-2.5 py-1 font-medium text-brand-accent-2 transition hover:bg-brand-accent-2 hover:text-brand-fg"
              >
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-rule pt-3 text-xs">
            <span className="font-mono uppercase tracking-[0.2em] text-brand-fg-faint">
              Published
            </span>
            {post.permalink ? (
              <a
                href={post.permalink}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-brand-fg hover:text-brand-accent"
              >
                View →
              </a>
            ) : null}
          </div>
        )}
      </div>
    </article>
  )
}

function publishSupportedForPlatform(platform: PostPlatform): boolean {
  // Direct publishing is currently only wired for YouTube Shorts. Other
  // platforms still rely on the "Copy caption" flow (manual upload).
  return platform === 'yt_short'
}

function ConnectionsBanner({
  artistId,
  youtubeConnected,
  onDisconnectYouTube,
  busy,
}: {
  artistId: string
  youtubeConnected: boolean
  onDisconnectYouTube: () => void
  busy: boolean
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-rule bg-brand-bg-2 px-4 py-3">
      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand-fg-faint">
          Publishing connections
        </p>
        <p className="text-sm text-brand-fg">
          YouTube{' '}
          {youtubeConnected ? (
            <span className="font-medium text-brand-accent">Connected</span>
          ) : (
            <span className="text-brand-fg-dim">— not connected</span>
          )}
        </p>
        <p className="text-xs text-brand-fg-faint">
          IG / TikTok / X / Threads / Facebook publish manually — use the Copy buttons in the
          post cards and paste into each app.
        </p>
      </div>
      <div className="flex gap-2 text-xs">
        {youtubeConnected ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDisconnectYouTube}
            className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg-dim transition hover:text-brand-fg disabled:opacity-50"
          >
            {busy ? 'Disconnecting…' : 'Disconnect YouTube'}
          </button>
        ) : (
          <a
            href={`/api/integrations/youtube/start?artistId=${encodeURIComponent(artistId)}&returnTo=${encodeURIComponent('/posts')}`}
            className="rounded-md border border-brand-accent bg-brand-accent px-3 py-1.5 font-medium text-brand-bg transition hover:opacity-90"
          >
            Connect YouTube
          </a>
        )}
      </div>
    </section>
  )
}

function aspectClassFor(ratio: string | null): string {
  switch (ratio) {
    case '1x1':
      return 'aspect-square'
    case '16x9':
      return 'aspect-video'
    case '4x5':
      return 'aspect-[4/5]'
    case '9x16':
    default:
      return 'aspect-[9/16]'
  }
}

// HTML <input type="datetime-local"> uses local wall time without a tz suffix
// (YYYY-MM-DDTHH:mm). Convert to/from ISO 8601 with the user's offset so we
// store an unambiguous instant in the DB.
function toLocalDatetimeInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
