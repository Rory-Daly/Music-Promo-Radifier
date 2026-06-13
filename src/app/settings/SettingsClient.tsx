'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { AppPlatform } from '@/lib/post-pulse/platform-map'
import type { SocialConnectionRow } from '@/lib/post-pulse/connections'

const PLATFORM_LABEL: Record<Exclude<AppPlatform, 'yt_short'>, string> = {
  ig_reel: 'Instagram Reels',
  ig_story: 'Instagram Stories',
  ig_feed: 'Instagram Feed',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  threads: 'Threads',
  fb: 'Facebook',
}

const ORDER: Exclude<AppPlatform, 'yt_short'>[] = [
  'ig_reel',
  'ig_story',
  'ig_feed',
  'tiktok',
  'x',
  'threads',
  'fb',
]

type Props = {
  artistId: string
  initialConnections: SocialConnectionRow[]
  apiKeyConfigured: boolean
}

export function SettingsClient({ artistId, initialConnections, apiKeyConfigured }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Exclude<AppPlatform, 'yt_short'> | null>(null)
  const [accountIdInput, setAccountIdInput] = useState('')
  const [handleInput, setHandleInput] = useState('')

  const byPlatform = new Map(initialConnections.map((c) => [c.platform, c]))

  function reset() {
    setEditing(null)
    setAccountIdInput('')
    setHandleInput('')
  }

  async function save(platform: Exclude<AppPlatform, 'yt_short'>) {
    setError(null)
    const id = Number(accountIdInput.trim())
    if (!Number.isInteger(id) || id <= 0) {
      setError('Account ID must be a positive integer.')
      return
    }
    setBusy(platform)
    try {
      const res = await fetch('/api/integrations/post-pulse/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistId,
          platform,
          socialMediaAccountId: id,
          displayHandle: handleInput.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      reset()
      startTransition(() => router.refresh())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save connection.')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(platform: Exclude<AppPlatform, 'yt_short'>) {
    setError(null)
    setBusy(platform)
    try {
      const res = await fetch('/api/integrations/post-pulse/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId, platform }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      startTransition(() => router.refresh())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-md border border-brand-rule bg-brand-bg-2 p-5">
        <h2 className="font-display text-lg tracking-tight">Post-Pulse</h2>
        <p className="mt-1 text-sm text-brand-fg-dim">
          Connect each platform to a Post-Pulse social account. Find the numeric account ID
          inside the Post-Pulse dashboard (Accounts tab). YouTube Shorts publishes via the
          native YouTube path — connect that on the Posts page.
        </p>
        {!apiKeyConfigured && (
          <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <code className="font-mono">POST_PULSE_API_KEY</code> is not set on the server.
            Add it to <code className="font-mono">.env.local</code> and restart the dev
            server. Connections you save below will still be stored, but publishing will
            fail until the key is configured. See{' '}
            <code className="font-mono">docs/post-pulse.md</code>.
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </section>

      <ul className="space-y-3">
        {ORDER.map((platform) => {
          const conn = byPlatform.get(platform)
          const isEditing = editing === platform
          return (
            <li
              key={platform}
              className="rounded-md border border-brand-rule bg-brand-bg-2 p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">{PLATFORM_LABEL[platform]}</p>
                  {conn ? (
                    <p className="mt-0.5 text-xs text-brand-fg-dim">
                      Account <span className="font-mono">{conn.social_media_account_id}</span>
                      {conn.display_handle ? ` · ${conn.display_handle}` : ''}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-brand-fg-faint">Not connected</p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {conn && !isEditing && (
                    <button
                      type="button"
                      onClick={() => disconnect(platform)}
                      disabled={busy === platform}
                      className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg-dim transition hover:border-red-500/50 hover:text-red-300 disabled:opacity-50"
                    >
                      {busy === platform ? '…' : 'Disconnect'}
                    </button>
                  )}
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(platform)
                        setAccountIdInput(conn ? String(conn.social_media_account_id) : '')
                        setHandleInput(conn?.display_handle ?? '')
                      }}
                      disabled={busy === platform}
                      className="rounded-md border border-brand-rule px-3 py-1.5 font-medium text-brand-fg transition hover:border-brand-accent disabled:opacity-50"
                    >
                      {conn ? 'Edit' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
              {isEditing && (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <label className="block text-xs">
                    <span className="text-brand-fg-dim">Account ID</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={accountIdInput}
                      onChange={(e) => setAccountIdInput(e.target.value)}
                      placeholder="e.g. 12345"
                      className="mt-1 w-full rounded-md border border-brand-rule bg-brand-bg px-3 py-1.5 font-mono text-sm"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="text-brand-fg-dim">Display handle (optional)</span>
                    <input
                      type="text"
                      value={handleInput}
                      onChange={(e) => setHandleInput(e.target.value)}
                      placeholder="@illutible"
                      className="mt-1 w-full rounded-md border border-brand-rule bg-brand-bg px-3 py-1.5 text-sm"
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      onClick={() => save(platform)}
                      disabled={busy === platform || !accountIdInput.trim()}
                      className="h-9 rounded-md border border-brand-accent bg-brand-accent/15 px-3 text-xs font-medium text-brand-fg transition hover:bg-brand-accent/25 disabled:opacity-50"
                    >
                      {busy === platform ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      disabled={busy === platform}
                      className="h-9 rounded-md border border-brand-rule px-3 text-xs font-medium text-brand-fg-dim transition hover:text-brand-fg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
