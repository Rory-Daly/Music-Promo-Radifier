'use client'

import Link from 'next/link'
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

type AspectRatio = '9x16' | '1x1' | '16x9' | '4x5'

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

// Aspect-ratio preference per platform. We try these in order against the
// renders the user has queued in this compose session — the first match
// wins. If none match, the post is saved without a render_id (still valid
// as a draft).
const PLATFORM_ASPECT_PREFERENCE: Record<Platform, AspectRatio[]> = {
  ig_reel: ['9x16'],
  ig_story: ['9x16'],
  ig_feed: ['4x5', '1x1'],
  tiktok: ['9x16'],
  yt_short: ['9x16'],
  x: ['1x1', '16x9'],
  threads: ['1x1', '16x9'],
  fb: ['16x9', '1x1', '4x5'],
}

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

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; count: number }
  | { kind: 'error'; message: string }

type ReadyRender = { renderId: string; aspectRatio: AspectRatio }

type Props = {
  artistId: string
  trackId: string
  trackTitle: string
  disabled?: boolean
  readyRenders?: ReadyRender[]
}

export function CaptionDrafts({
  artistId,
  trackId,
  trackTitle,
  disabled,
  readyRenders = [],
}: Props) {
  const [selected, setSelected] = useState<Set<Platform>>(() => new Set(DEFAULT_PLATFORMS))
  const [contextHint, setContextHint] = useState('')
  const [state, setState] = useState<DraftState>({ kind: 'idle' })
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
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

  function pickRenderForPlatform(platform: Platform): string | null {
    const preferences = PLATFORM_ASPECT_PREFERENCE[platform]
    for (const ratio of preferences) {
      const match = readyRenders.find((r) => r.aspectRatio === ratio)
      if (match) return match.renderId
    }
    return null
  }

  async function saveAllAsDrafts(drafts: Draft[]) {
    if (drafts.length === 0) return
    setSaveState({ kind: 'saving' })
    const results = await Promise.all(
      drafts.map((d) =>
        fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            artistId,
            trackId,
            renderId: pickRenderForPlatform(d.platform) ?? undefined,
            platform: d.platform,
            caption: d.caption,
            hashtags: d.hashtags,
          }),
        }).then(async (res) => ({
          ok: res.ok,
          status: res.status,
          body: (await res.json().catch(() => null)) as { error?: string } | null,
        })),
      ),
    )
    const failures = results.filter((r) => !r.ok)
    if (failures.length > 0) {
      setSaveState({
        kind: 'error',
        message: failures[0].body?.error ?? `Save failed (${failures[0].status})`,
      })
      return
    }
    setSaveState({ kind: 'success', count: drafts.length })
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
        <>
          <ul className="space-y-3">
            {state.drafts.map((d) => {
              const full = d.caption
              const matchedRender = pickRenderForPlatform(d.platform)
              return (
                <li
                  key={d.platform}
                  className="rounded-md border border-brand-rule bg-brand-bg p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
                      {PLATFORM_LABELS[d.platform]} · {full.length} chars
                      {matchedRender
                        ? ' · render attached'
                        : readyRenders.length > 0
                          ? ' · no matching render'
                          : ''}
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

          <div className="flex items-center justify-between gap-2 border-t border-brand-rule pt-3 text-xs">
            {saveState.kind === 'success' ? (
              <p className="mr-auto text-brand-fg-dim">
                Saved {saveState.count} draft post{saveState.count === 1 ? '' : 's'}.{' '}
                <Link
                  href="/posts"
                  className="text-brand-fg underline-offset-2 hover:text-brand-accent hover:underline"
                >
                  Open Posts →
                </Link>
              </p>
            ) : saveState.kind === 'error' ? (
              <p className="mr-auto text-brand-accent-2">{saveState.message}</p>
            ) : readyRenders.length === 0 ? (
              <p className="mr-auto text-brand-fg-faint">
                Queue a render first to auto-attach the right aspect ratio per platform. Drafts
                can still be saved without one.
              </p>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => state.kind === 'success' && saveAllAsDrafts(state.drafts)}
              disabled={saveState.kind === 'saving' || disabled}
              className="rounded-md border border-brand-accent bg-brand-accent px-3 py-1.5 font-medium text-brand-bg transition disabled:opacity-50"
            >
              {saveState.kind === 'saving' ? 'Saving…' : 'Save all as drafts'}
            </button>
          </div>
        </>
      ) : null}
    </section>
  )
}
