'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ClipPreview } from '@/components/ClipPreview'
import {
  ASPECT_RATIO_CONFIGS,
  ASPECT_RATIOS,
  type AspectRatio,
} from '../../../scripts/remotion/aspect-ratios'
import {
  TRANSITION_LABELS,
  TRANSITIONS,
  type Transition,
} from '../../../scripts/remotion/transitions'
import { cn } from '@/lib/utils'
import type { HookRow, TrackRow } from '@/lib/supabase/queries'
import type { SignedClipRow } from '../vault/VaultClient'
import { CaptionDrafts } from './CaptionDrafts'

type RenderStatus = 'queued' | 'rendering' | 'ready' | 'failed'

type RenderPollResponse = {
  id: string
  status: RenderStatus
  output_url: string | null
  error: string | null
}

type TrackedRender = {
  renderId: string
  aspectRatio: AspectRatio
  status: RenderStatus
  outputUrl: string | null
  error: string | null
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'tracking'; renders: TrackedRender[] }
  | { kind: 'error'; message: string }

type Props = {
  artistId: string
  tracks: TrackRow[]
  hooks: HookRow[]
  clips: SignedClipRow[]
}

export function ComposeForm({ artistId, tracks, hooks, clips }: Props) {
  const initialTrackId = tracks[0]?.id ?? ''
  const initialHookId = hooks.find((h) => h.track_id === initialTrackId)?.id ?? ''
  const [selectedTrackId, setSelectedTrackId] = useState<string>(initialTrackId)
  const [selectedHookId, setSelectedHookId] = useState<string>(initialHookId)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [cta, setCta] = useState('')
  const [slowmo, setSlowmo] = useState(1)
  const [noOverlays, setNoOverlays] = useState(false)
  const [selectedAspectRatios, setSelectedAspectRatios] = useState<Set<AspectRatio>>(
    () => new Set<AspectRatio>(['9x16']),
  )
  const [transition, setTransition] = useState<Transition>('cut')
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' })

  function toggleAspectRatio(ratio: AspectRatio) {
    setSelectedAspectRatios((prev) => {
      const next = new Set(prev)
      if (next.has(ratio)) next.delete(ratio)
      else next.add(ratio)
      return next
    })
  }

  const hooksForTrack = useMemo(
    () => hooks.filter((h) => h.track_id === selectedTrackId),
    [hooks, selectedTrackId],
  )

  function changeTrack(trackId: string) {
    setSelectedTrackId(trackId)
    const firstHookForNewTrack = hooks.find((h) => h.track_id === trackId)
    setSelectedHookId(firstHookForNewTrack?.id ?? '')
  }

  useEffect(() => {
    if (submitState.kind !== 'tracking') return
    const pending = submitState.renders.filter(
      (r) => r.status !== 'ready' && r.status !== 'failed',
    )
    if (pending.length === 0) return

    const interval = setInterval(async () => {
      const updates = await Promise.all(
        pending.map(async (r) => {
          try {
            const res = await fetch(`/api/renders/${r.renderId}`, { cache: 'no-store' })
            if (!res.ok) return null
            const data = (await res.json()) as RenderPollResponse
            return {
              renderId: r.renderId,
              status: data.status,
              outputUrl: data.output_url,
              error: data.error,
            }
          } catch {
            return null
          }
        }),
      )
      setSubmitState((prev) => {
        if (prev.kind !== 'tracking') return prev
        const byId = new Map(
          updates
            .filter((u): u is NonNullable<typeof u> => u !== null)
            .map((u) => [u.renderId, u]),
        )
        return {
          kind: 'tracking',
          renders: prev.renders.map((r) => {
            const u = byId.get(r.renderId)
            return u ? { ...r, status: u.status, outputUrl: u.outputUrl, error: u.error } : r
          }),
        }
      })
    }, 2500)
    return () => clearInterval(interval)
  }, [submitState])

  function toggleClip(id: string) {
    setSelectedClipIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTrackId) {
      setSubmitState({ kind: 'error', message: 'Pick a track first.' })
      return
    }
    if (!selectedHookId) {
      setSubmitState({ kind: 'error', message: 'No hook selected for this track.' })
      return
    }
    if (selectedClipIds.size === 0) {
      setSubmitState({ kind: 'error', message: 'Pick at least one clip.' })
      return
    }
    const aspectRatios = Array.from(selectedAspectRatios)
    if (aspectRatios.length === 0) {
      setSubmitState({ kind: 'error', message: 'Pick at least one output format.' })
      return
    }
    setSubmitState({ kind: 'submitting' })

    try {
      const clipIds = Array.from(selectedClipIds)
      const results = await Promise.all(
        aspectRatios.map(async (aspectRatio) => {
          const body = {
            artistId,
            trackId: selectedTrackId,
            hookId: selectedHookId,
            clipIds,
            aspectRatio,
            transition,
            title: title.trim() || undefined,
            cta: cta.trim() || undefined,
            slowmo,
            noOverlays,
          }
          const res = await fetch('/api/renders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = (await res.json()) as { renderId?: string; error?: string }
          if (!res.ok || !data.renderId) {
            throw new Error(data.error ?? `Render request failed (${res.status}) for ${aspectRatio}`)
          }
          return { aspectRatio, renderId: data.renderId }
        }),
      )
      setSubmitState({
        kind: 'tracking',
        renders: results.map((r) => ({
          renderId: r.renderId,
          aspectRatio: r.aspectRatio,
          status: 'queued' as RenderStatus,
          outputUrl: null,
          error: null,
        })),
      })
    } catch (err) {
      setSubmitState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Render request failed',
      })
    }
  }

  if (tracks.length === 0) {
    return <EmptyState message="No tracks yet. Upload one from the vault first." />
  }
  if (clips.length === 0) {
    return <EmptyState message="No clips yet. Upload some footage from the vault first." />
  }

  const trackingPending =
    submitState.kind === 'tracking' &&
    submitState.renders.some((r) => r.status !== 'ready' && r.status !== 'failed')
  const submitDisabled = submitState.kind === 'submitting' || trackingPending

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-6">
        <Section label="1 · Track">
          <select
            value={selectedTrackId}
            onChange={(e) => changeTrack(e.target.value)}
            className="w-full rounded-md border border-brand-rule bg-brand-bg-2 px-3 py-2 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
          >
            {tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
                {track.duration_seconds ? ` (${formatSeconds(track.duration_seconds)})` : ''}
              </option>
            ))}
          </select>
        </Section>

        <Section label="2 · Hook">
          {hooksForTrack.length === 0 ? (
            <p className="text-sm text-brand-fg-dim">
              No hooks detected for this track yet. Re-upload from the vault to run detection.
            </p>
          ) : (
            <ul className="space-y-2">
              {hooksForTrack.map((hook) => (
                <li key={hook.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition',
                      selectedHookId === hook.id
                        ? 'border-brand-accent bg-brand-bg-2'
                        : 'border-brand-rule bg-brand-bg-2 hover:border-brand-accent',
                    )}
                  >
                    <input
                      type="radio"
                      name="hookId"
                      value={hook.id}
                      checked={selectedHookId === hook.id}
                      onChange={(e) => setSelectedHookId(e.target.value)}
                      className="accent-brand-fg"
                    />
                    <span className="font-mono text-xs text-brand-fg-dim">
                      {formatSeconds(hook.start_seconds)}–{formatSeconds(hook.end_seconds)}
                    </span>
                    <span className="text-xs text-brand-fg-faint">
                      ({(hook.end_seconds - hook.start_seconds).toFixed(0)}s)
                    </span>
                    {hook.label ? (
                      <span className="rounded-sm bg-brand-bg-2 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.15em] text-brand-fg-dim">
                        {hook.label}
                      </span>
                    ) : null}
                    {hook.score !== null ? (
                      <span className="ml-auto font-mono text-[10px] text-brand-fg-faint">
                        score {hook.score.toFixed(3)}
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section label={`3 · Clips (${selectedClipIds.size} selected)`}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {clips.map((clip) => {
              const checked = selectedClipIds.has(clip.id)
              return (
                <li key={clip.id}>
                  <button
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleClip(clip.id)}
                    className={cn(
                      'block w-full overflow-hidden rounded-md border-2 text-left transition',
                      checked
                        ? 'border-brand-fg'
                        : 'border-brand-rule hover:border-brand-accent',
                    )}
                  >
                    <div className="relative aspect-[9/16] bg-brand-bg">
                      <ClipPreview clip={clip} />
                      {clip.source === 'gdrive' ? (
                        <span className="absolute right-1 top-1 rounded-sm bg-brand-bg px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-brand-fg-dim">
                          drive
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-0.5 px-2 py-1">
                      <p
                        className="truncate text-[11px] text-brand-fg"
                        title={clip.name ?? undefined}
                      >
                        {clip.name ?? '(unnamed)'}
                      </p>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-mono uppercase tracking-[0.2em] text-brand-fg-faint">
                          {clip.duration_seconds ? `${clip.duration_seconds.toFixed(1)}s` : '—'}
                        </span>
                        {checked ? (
                          <span className="text-brand-fg">selected</span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>

        <Section label={`4 · Output formats (${selectedAspectRatios.size} selected)`}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ASPECT_RATIOS.map((ratio) => {
              const cfg = ASPECT_RATIO_CONFIGS[ratio]
              const checked = selectedAspectRatios.has(ratio)
              return (
                <li key={ratio}>
                  <button
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleAspectRatio(ratio)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border-2 px-3 py-2 text-left text-xs transition',
                      checked
                        ? 'border-brand-fg text-brand-fg'
                        : 'border-brand-rule text-brand-fg-dim hover:border-brand-accent hover:text-brand-fg',
                    )}
                  >
                    <AspectThumb ratio={ratio} active={checked} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{cfg.label}</p>
                      <p className="font-mono text-[10px] text-brand-fg-faint">
                        {cfg.width}×{cfg.height}
                      </p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-xs text-brand-fg-faint">
            Each selected format fires its own render — the dashboard will show them all.
          </p>
        </Section>

        <Section label="5 · Transition">
          <select
            value={transition}
            onChange={(e) => setTransition(e.target.value as Transition)}
            className="w-full rounded-md border border-brand-rule bg-brand-bg-2 px-3 py-2 text-sm text-brand-fg focus:border-brand-accent focus:outline-none sm:w-80"
          >
            {TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </Section>

        <Section label="6 · Options">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
                Title override
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="From track title"
                className="mt-1 block w-full rounded-md border border-brand-rule bg-brand-bg-2 px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">CTA</span>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="illutible.com"
                className="mt-1 block w-full rounded-md border border-brand-rule bg-brand-bg-2 px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
                Slowmo (0.25–2)
              </span>
              <input
                type="number"
                min={0.25}
                max={2}
                step={0.25}
                value={slowmo}
                onChange={(e) => setSlowmo(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-brand-rule bg-brand-bg-2 px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-brand-fg-dim">
            <input
              type="checkbox"
              checked={noOverlays}
              onChange={(e) => setNoOverlays(e.target.checked)}
              className="accent-brand-fg"
            />
            Skip brand overlays (clean footage only)
          </label>
        </Section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitDisabled}
            className="rounded-md bg-brand-fg px-4 py-2 text-sm font-medium text-brand-bg transition hover:bg-brand-fg disabled:opacity-50"
          >
            {submitState.kind === 'submitting'
              ? 'Queuing…'
              : `Render ${selectedAspectRatios.size} reel${selectedAspectRatios.size === 1 ? '' : 's'}`}
          </button>
          {submitState.kind === 'error' ? (
            <p className="text-sm text-red-400">{submitState.message}</p>
          ) : null}
        </div>
      </form>

      {submitState.kind === 'tracking' ? <RenderStatusPanel state={submitState} /> : null}

      {selectedTrackId ? (
        <CaptionDrafts
          artistId={artistId}
          trackId={selectedTrackId}
          trackTitle={tracks.find((t) => t.id === selectedTrackId)?.title ?? 'this track'}
          readyRenders={
            submitState.kind === 'tracking'
              ? submitState.renders
                  .filter((r) => r.status === 'ready')
                  .map((r) => ({ renderId: r.renderId, aspectRatio: r.aspectRatio }))
              : []
          }
        />
      ) : null}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-brand-fg-faint">{label}</h2>
      {children}
    </section>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-brand-rule bg-brand-bg-2 p-6 text-sm text-brand-fg-dim">
      <p>{message}</p>
      <Link
        href="/vault"
        className="mt-3 inline-block rounded-md bg-brand-fg px-3 py-1.5 text-xs font-medium text-brand-bg hover:bg-brand-fg"
      >
        Open vault
      </Link>
    </div>
  )
}

function RenderStatusPanel({ state }: { state: { renders: TrackedRender[] } }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-brand-fg-faint">
        Renders ({state.renders.length})
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.renders.map((r) => (
          <li
            key={r.renderId}
            className="space-y-2 rounded-md border border-brand-rule bg-brand-bg-2 p-3"
          >
            <header className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
                {ASPECT_RATIO_CONFIGS[r.aspectRatio].label}
              </span>
              <StatusPill status={r.status} />
            </header>
            {r.status === 'ready' && r.outputUrl ? (
              <>
                <div className="overflow-hidden rounded bg-brand-bg">
                  { }
                  <video
                    src={r.outputUrl}
                    className="block w-full"
                    style={{ aspectRatio: aspectRatioCss(r.aspectRatio) }}
                    controls
                    preload="metadata"
                  />
                </div>
                <a
                  href={r.outputUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs text-brand-fg-dim underline underline-offset-4 hover:text-brand-fg"
                >
                  Download MP4
                </a>
              </>
            ) : r.status === 'failed' ? (
              <p className="text-xs text-red-400">{r.error ?? 'Render failed.'}</p>
            ) : (
              <p className="text-xs text-brand-fg-dim">{r.status}…</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function aspectRatioCss(ratio: AspectRatio): string {
  const c = ASPECT_RATIO_CONFIGS[ratio]
  return `${c.width} / ${c.height}`
}

function AspectThumb({ ratio, active }: { ratio: AspectRatio; active: boolean }) {
  const cfg = ASPECT_RATIO_CONFIGS[ratio]
  const longEdge = 28
  const w = (cfg.width / Math.max(cfg.width, cfg.height)) * longEdge
  const h = (cfg.height / Math.max(cfg.width, cfg.height)) * longEdge
  return (
    <span
      aria-hidden
      style={{ width: longEdge, height: longEdge }}
      className="flex shrink-0 items-center justify-center"
    >
      <span
        style={{ width: w, height: h }}
        className={cn('block rounded-sm', active ? 'bg-brand-fg' : 'bg-brand-bg-2')}
      />
    </span>
  )
}

function StatusPill({ status }: { status: RenderStatus }) {
  const styles =
    status === 'ready'
      ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
      : status === 'failed'
        ? 'border-red-700/60 bg-red-950/40 text-red-200'
        : 'border-brand-rule bg-brand-bg-2 text-brand-fg-dim'
  return (
    <span
      className={cn(
        'rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em]',
        styles,
      )}
    >
      {status}
    </span>
  )
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
