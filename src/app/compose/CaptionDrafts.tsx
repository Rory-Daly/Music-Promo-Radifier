'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

type Platform =
  | 'ig_reel'
  | 'ig_story'
  | 'ig_feed'
  | 'tiktok'
  | 'yt_short'
  | 'x'
  | 'threads'
  | 'fb'

const PLATFORM_LABELS: Record<Platform, string> = {
  ig_reel: 'IG Reel',
  ig_story: 'IG Story',
  ig_feed: 'IG Feed',
  tiktok: 'TikTok',
  yt_short: 'YT Short',
  x: 'X',
  threads: 'Threads',
  fb: 'Facebook',
}

const DEFAULT_PLATFORMS: Platform[] = ['ig_reel', 'tiktok', 'yt_short', 'x']

type Draft = {
  platform: Platform
  caption: string
  hashtags: string[]
}

type DraftState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; drafts: Draft[] }
  | { kind: 'error'; message: string }

type Props = {
  artistId: string
  trackId: string
  trackTitle: string
  disabled?: boolean
}

export function CaptionDrafts({ artistId, trackId, trackTitle, disabled }: Props) {
  const [selected, setSelected] = useState<Set<Platform>>(() => new Set(DEFAULT_PLATFORMS))
  const [contextHint, setContextHint] = useState('')
  const [state, setState] = useState<DraftState>({ kind: 'idle' })
  const [copied, setCopied] = useState<Platform | null>(null)

  function togglePlatform(p: Platform) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  async function draft() {
    if (selected.size === 0) return
    setState({ kind: 'loading' })
    try {
      const res = await fetch('/api/captions/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistId,
          trackId,
          platforms: Array.from(selected),
          contextHint: contextHint.trim() || undefined,
        }),
      })
      const body = (await res.json().catch(() => null)) as
        | { captions?: Draft[]; error?: string }
        | null
      if (!res.ok) {
        setState({
          kind: 'error',
          message: body?.error ?? `Caption draft failed (${res.status})`,
        })
        return
      }
      setState({ kind: 'success', drafts: body?.captions ?? [] })
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Caption draft failed',
      })
    }
  }

  async function copyDraft(platform: Platform, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(platform)
      setTimeout(() => setCopied((p) => (p === platform ? null : p)), 1500)
    } catch {
      // Clipboard API can fail in non-secure contexts; ignore silently.
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-brand-rule bg-brand-bg-2 p-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-lg tracking-tight">Caption drafts</h2>
          <p className="mt-1 text-xs text-brand-fg-faint">
            Drafted in the brand voice from the brand kit · {trackTitle}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
          claude · low effort
        </span>
      </header>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => togglePlatform(p)}
            disabled={state.kind === 'loading'}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50',
              selected.has(p)
                ? 'border-brand-accent bg-brand-accent text-brand-bg'
                : 'border-brand-rule text-brand-fg-dim hover:border-brand-accent hover:text-brand-fg',
            )}
          >
            {PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>

      <label className="block space-y-1">
        <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
          Optional context (location, mood, shoot notes)
        </span>
        <input
          type="text"
          value={contextHint}
          onChange={(e) => setContextHint(e.target.value)}
          placeholder="e.g. shot on a rainy morning at South Bank"
          maxLength={280}
          className="block w-full rounded-md border border-brand-rule bg-brand-bg px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        {state.kind === 'error' ? (
          <p className="mr-auto text-xs text-brand-accent-2">{state.message}</p>
        ) : null}
        <button
          type="button"
          onClick={draft}
          disabled={disabled || state.kind === 'loading' || selected.size === 0}
          className="rounded-md border border-brand-accent bg-brand-accent px-3 py-1.5 text-sm font-medium text-brand-bg transition disabled:opacity-50"
        >
          {state.kind === 'loading' ? 'Drafting…' : 'Draft captions'}
        </button>
      </div>

      {state.kind === 'success' && state.drafts.length > 0 ? (
        <ul className="space-y-3">
          {state.drafts.map((d) => {
            const full = d.caption
            return (
              <li
                key={d.platform}
                className="rounded-md border border-brand-rule bg-brand-bg p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
                    {PLATFORM_LABELS[d.platform]} · {full.length} chars
                  </span>
                  <button
                    type="button"
                    onClick={() => copyDraft(d.platform, full)}
                    className="rounded border border-brand-rule px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-brand-fg-faint transition hover:border-brand-accent hover:text-brand-fg"
                  >
                    {copied === d.platform ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words font-body text-sm text-brand-fg">
                  {full}
                </pre>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
