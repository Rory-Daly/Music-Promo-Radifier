'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { cn } from '@/lib/utils'
import type { HookRow, TrackRow } from '@/lib/supabase/queries'
import type { SignedClipRow } from '../vault/VaultClient'

type RenderStatus = 'queued' | 'rendering' | 'ready' | 'failed'

type RenderPollResponse = {
  id: string
  status: RenderStatus
  output_url: string | null
  error: string | null
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'tracking'; renderId: string; status: RenderStatus; outputUrl: string | null; error: string | null }
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
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' })

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
    if (submitState.status === 'ready' || submitState.status === 'failed') return
    const renderId = submitState.renderId
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/renders/${renderId}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as RenderPollResponse
        setSubmitState({
          kind: 'tracking',
          renderId,
          status: data.status,
          outputUrl: data.output_url,
          error: data.error,
        })
      } catch {
        // poll again
      }
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
    setSubmitState({ kind: 'submitting' })

    try {
      const body = {
        artistId,
        trackId: selectedTrackId,
        hookId: selectedHookId,
        clipIds: Array.from(selectedClipIds),
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
        setSubmitState({
          kind: 'error',
          message: data.error ?? `Render request failed (${res.status})`,
        })
        return
      }
      setSubmitState({
        kind: 'tracking',
        renderId: data.renderId,
        status: 'queued',
        outputUrl: null,
        error: null,
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

  const submitDisabled =
    submitState.kind === 'submitting' ||
    (submitState.kind === 'tracking' &&
      submitState.status !== 'ready' &&
      submitState.status !== 'failed')

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-6">
        <Section label="1 · Track">
          <select
            value={selectedTrackId}
            onChange={(e) => changeTrack(e.target.value)}
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
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
            <p className="text-sm text-neutral-400">
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
                        ? 'border-neutral-300 bg-neutral-900/70'
                        : 'border-neutral-800 bg-neutral-900/40 hover:border-neutral-600',
                    )}
                  >
                    <input
                      type="radio"
                      name="hookId"
                      value={hook.id}
                      checked={selectedHookId === hook.id}
                      onChange={(e) => setSelectedHookId(e.target.value)}
                      className="accent-neutral-100"
                    />
                    <span className="font-mono text-xs text-neutral-300">
                      {formatSeconds(hook.start_seconds)}–{formatSeconds(hook.end_seconds)}
                    </span>
                    <span className="text-xs text-neutral-500">
                      ({(hook.end_seconds - hook.start_seconds).toFixed(0)}s)
                    </span>
                    {hook.label ? (
                      <span className="rounded-sm bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.15em] text-neutral-300">
                        {hook.label}
                      </span>
                    ) : null}
                    {hook.score !== null ? (
                      <span className="ml-auto font-mono text-[10px] text-neutral-500">
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
                        ? 'border-neutral-100'
                        : 'border-neutral-800 hover:border-neutral-600',
                    )}
                  >
                    <div className="relative aspect-[9/16] bg-neutral-950">
                      <ClipPreview clip={clip} />
                      {clip.source === 'gdrive' ? (
                        <span className="absolute right-1 top-1 rounded-sm bg-neutral-950/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-300">
                          drive
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-1 px-2 py-1 text-[10px]">
                      <span className="font-mono uppercase tracking-[0.2em] text-neutral-500">
                        {clip.duration_seconds ? `${clip.duration_seconds.toFixed(1)}s` : '—'}
                      </span>
                      {checked ? (
                        <span className="text-neutral-100">selected</span>
                      ) : null}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>

        <Section label="4 · Options">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs uppercase tracking-[0.2em] text-neutral-500">
                Title override
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="From track title"
                className="mt-1 block w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-[0.2em] text-neutral-500">CTA</span>
              <input
                type="text"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="illutible.com"
                className="mt-1 block w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-[0.2em] text-neutral-500">
                Slowmo (0.25–2)
              </span>
              <input
                type="number"
                min={0.25}
                max={2}
                step={0.25}
                value={slowmo}
                onChange={(e) => setSlowmo(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={noOverlays}
              onChange={(e) => setNoOverlays(e.target.checked)}
              className="accent-neutral-100"
            />
            Skip brand overlays (clean footage only)
          </label>
        </Section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitDisabled}
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-white disabled:opacity-50"
          >
            {submitState.kind === 'submitting' ? 'Queuing…' : 'Render reel'}
          </button>
          {submitState.kind === 'error' ? (
            <p className="text-sm text-red-400">{submitState.message}</p>
          ) : null}
        </div>
      </form>

      {submitState.kind === 'tracking' ? <RenderStatusPanel state={submitState} /> : null}
    </div>
  )
}

function ClipPreview({ clip }: { clip: SignedClipRow }) {
  if (clip.signedUrl) {
    return (
      <video
        src={clip.signedUrl}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    )
  }
  if (clip.thumbnail_url) {
     
    return (
      <img
        src={clip.thumbnail_url}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-neutral-600">
      no preview
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">{label}</h2>
      {children}
    </section>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-6 text-sm text-neutral-300">
      <p>{message}</p>
      <Link
        href="/vault"
        className="mt-3 inline-block rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-950 hover:bg-white"
      >
        Open vault
      </Link>
    </div>
  )
}

function RenderStatusPanel({
  state,
}: {
  state: { renderId: string; status: RenderStatus; outputUrl: string | null; error: string | null }
}) {
  return (
    <section className="space-y-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-[0.3em] text-neutral-500">
          Render · {state.renderId.slice(0, 8)}
        </h2>
        <StatusPill status={state.status} />
      </header>
      {state.status === 'ready' && state.outputUrl ? (
        <div className="space-y-2">
          <div className="overflow-hidden rounded-md bg-neutral-950">
            { }
            <video
              src={state.outputUrl}
              className="mx-auto block aspect-[9/16] w-full max-w-xs object-cover"
              controls
              preload="metadata"
            />
          </div>
          <a
            href={state.outputUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-neutral-300 underline underline-offset-4 hover:text-neutral-100"
          >
            Download MP4
          </a>
        </div>
      ) : state.status === 'failed' ? (
        <p className="text-sm text-red-400">{state.error ?? 'Render failed.'}</p>
      ) : (
        <p className="text-sm text-neutral-400">
          Working… we&apos;ll poll every couple of seconds and show the result here.
        </p>
      )}
    </section>
  )
}

function StatusPill({ status }: { status: RenderStatus }) {
  const styles =
    status === 'ready'
      ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
      : status === 'failed'
        ? 'border-red-700/60 bg-red-950/40 text-red-200'
        : 'border-neutral-700 bg-neutral-900 text-neutral-300'
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
