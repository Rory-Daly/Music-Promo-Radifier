'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { ClientDate } from '@/components/ClientDate'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { uploadFileToStorage } from '@/lib/storage/browser-upload'
import { cn } from '@/lib/utils'
import type { ClipRow, TrackRow } from '@/lib/supabase/queries'

const ALLOWED_AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.aiff', '.aif', '.m4a', '.ogg'])
const ALLOWED_VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'])

// Client-side caps. The same limits should be set on the storage bucket
// (see migration 0004_bucket_size_limits.sql) so server enforcement matches.
const MAX_TRACK_BYTES = 512 * 1024 * 1024 // 512 MB — generous for WAV masters
const MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB — transcode anything bigger

function extOf(name: string): string {
  const m = name.match(/\.[^.]+$/)
  return (m ? m[0] : '').toLowerCase()
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

export type SignedTrackRow = TrackRow & { signedUrl: string | null }
export type SignedClipRow = ClipRow & { signedUrl: string | null }

type Tab = 'tracks' | 'clips'

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string; progressPct: number; stage: 'upload' | 'process' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

type Props = {
  artistId: string
  initialTracks: SignedTrackRow[]
  initialClips: SignedClipRow[]
}

export function VaultClient({ artistId, initialTracks, initialClips }: Props) {
  const [tab, setTab] = useState<Tab>('tracks')
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [uploadState, setUploadState] = useState<UploadState>({ kind: 'idle' })
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  async function uploadTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get('file')
    const titleRaw = String(data.get('title') ?? '').trim()
    if (!(file instanceof File) || file.size === 0) {
      setUploadState({ kind: 'error', message: 'Pick an audio file first.' })
      return
    }
    const ext = extOf(file.name)
    if (!ALLOWED_AUDIO_EXT.has(ext)) {
      setUploadState({ kind: 'error', message: `Unsupported audio format: ${ext || '(none)'}` })
      return
    }
    if (file.size > MAX_TRACK_BYTES) {
      setUploadState({
        kind: 'error',
        message: `Audio file is ${formatBytes(file.size)} — please bounce a smaller mixdown (cap is ${formatBytes(MAX_TRACK_BYTES)}).`,
      })
      return
    }
    const trackId = crypto.randomUUID()
    const path = `${artistId}/${trackId}${ext}`
    const title = titleRaw.length > 0 ? titleRaw : file.name.replace(/\.[^.]+$/, '')

    setUploadState({ kind: 'uploading', filename: file.name, progressPct: 0, stage: 'upload' })
    try {
      await uploadFileToStorage({
        bucket: 'tracks',
        path,
        file,
        onProgress: (pct) =>
          setUploadState({ kind: 'uploading', filename: file.name, progressPct: pct, stage: 'upload' }),
      })

      setUploadState({ kind: 'uploading', filename: file.name, progressPct: 100, stage: 'process' })
      const res = await fetch('/api/vault/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId, trackId, path, title }),
      })
      const parsed = await safeParseResponse<{ error?: string; hookCount?: number; title?: string }>(res)
      if (!res.ok) {
        await supabase.storage.from('tracks').remove([path]).catch(() => {})
        setUploadState({ kind: 'error', message: parsed.message })
        return
      }
      const body = parsed.body ?? {}
      const note = body.hookCount
        ? ` (${body.hookCount} hook${body.hookCount === 1 ? '' : 's'} detected)`
        : ''
      setUploadState({ kind: 'success', message: `Uploaded ${body.title ?? title}${note}` })
      form.reset()
      startTransition(() => router.refresh())
    } catch (err) {
      await supabase.storage.from('tracks').remove([path]).catch(() => {})
      setUploadState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  async function uploadClip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const file = data.get('file')
    const tagsRaw = String(data.get('tags') ?? '').trim()
    if (!(file instanceof File) || file.size === 0) {
      setUploadState({ kind: 'error', message: 'Pick a video file first.' })
      return
    }
    const ext = extOf(file.name)
    if (!ALLOWED_VIDEO_EXT.has(ext)) {
      setUploadState({ kind: 'error', message: `Unsupported video format: ${ext || '(none)'}` })
      return
    }
    if (file.size > MAX_CLIP_BYTES) {
      setUploadState({
        kind: 'error',
        message: `Clip is ${formatBytes(file.size)} — transcode with ffmpeg to under ${formatBytes(MAX_CLIP_BYTES)} before uploading. See docs/supabase.md.`,
      })
      return
    }
    const clipId = crypto.randomUUID()
    const path = `${artistId}/${clipId}${ext}`
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 10)

    setUploadState({ kind: 'uploading', filename: file.name, progressPct: 0, stage: 'upload' })
    try {
      await uploadFileToStorage({
        bucket: 'clips',
        path,
        file,
        onProgress: (pct) =>
          setUploadState({ kind: 'uploading', filename: file.name, progressPct: pct, stage: 'upload' }),
      })

      setUploadState({ kind: 'uploading', filename: file.name, progressPct: 100, stage: 'process' })
      const res = await fetch('/api/vault/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId, clipId, path, tags }),
      })
      const parsed = await safeParseResponse<{ error?: string }>(res)
      if (!res.ok) {
        await supabase.storage.from('clips').remove([path]).catch(() => {})
        setUploadState({ kind: 'error', message: parsed.message })
        return
      }
      setUploadState({ kind: 'success', message: `Uploaded ${file.name}` })
      form.reset()
      startTransition(() => router.refresh())
    } catch (err) {
      await supabase.storage.from('clips').remove([path]).catch(() => {})
      setUploadState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex gap-1 border-b border-neutral-800">
        <TabButton active={tab === 'tracks'} onClick={() => setTab('tracks')} label="Tracks" count={initialTracks.length} />
        <TabButton active={tab === 'clips'} onClick={() => setTab('clips')} label="Clips" count={initialClips.length} />
      </div>

      {uploadState.kind === 'uploading' ? (
        <UploadProgress
          filename={uploadState.filename}
          pct={uploadState.progressPct}
          stage={uploadState.stage}
        />
      ) : null}
      {uploadState.kind === 'success' ? <Banner tone="success">{uploadState.message}</Banner> : null}
      {uploadState.kind === 'error' ? <Banner tone="error">{uploadState.message}</Banner> : null}

      {tab === 'tracks' ? (
        <section className="space-y-6" role="tabpanel" aria-label="Tracks">
          <form
            onSubmit={uploadTrack}
            className="space-y-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-4"
          >
            <h2 className="text-sm font-medium text-neutral-200">Upload a track</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-neutral-500">File</span>
                <input
                  type="file"
                  name="file"
                  accept="audio/*,.wav,.mp3,.flac,.aiff,.aif,.m4a,.ogg"
                  required
                  className="mt-1 block w-full text-xs text-neutral-200 file:mr-3 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-xs file:text-neutral-100 hover:file:border-neutral-500"
                />
              </label>
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-neutral-500">Title (optional)</span>
                <input
                  type="text"
                  name="title"
                  placeholder="Auto from filename"
                  className="mt-1 block w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={uploadState.kind === 'uploading'}
                className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-white disabled:opacity-50"
              >
                Upload
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Hooks are auto-detected on upload and stored against the track.
            </p>
          </form>
          <TrackList tracks={initialTracks} />
        </section>
      ) : (
        <section className="space-y-6" role="tabpanel" aria-label="Clips">
          <form
            onSubmit={uploadClip}
            className="space-y-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-4"
          >
            <h2 className="text-sm font-medium text-neutral-200">Upload a clip</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-neutral-500">File</span>
                <input
                  type="file"
                  name="file"
                  accept="video/*,.mp4,.mov,.m4v,.webm"
                  required
                  className="mt-1 block w-full text-xs text-neutral-200 file:mr-3 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-xs file:text-neutral-100 hover:file:border-neutral-500"
                />
              </label>
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-neutral-500">Tags (comma-separated)</span>
                <input
                  type="text"
                  name="tags"
                  placeholder="drone, dusk, beach"
                  className="mt-1 block w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-neutral-600 focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={uploadState.kind === 'uploading'}
                className="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-950 transition hover:bg-white disabled:opacity-50"
              >
                Upload
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Clips become candidates for the composer&apos;s auto-selection.
            </p>
          </form>
          <ClipList clips={initialClips} />
        </section>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm transition',
        active
          ? 'border-neutral-100 text-neutral-100'
          : 'border-transparent text-neutral-500 hover:text-neutral-200',
      )}
    >
      {label} <span className="text-xs text-neutral-500">({count})</span>
    </button>
  )
}

function UploadProgress({
  filename,
  pct,
  stage,
}: {
  filename: string
  pct: number
  stage: 'upload' | 'process'
}) {
  const label =
    stage === 'process'
      ? `Processing ${filename}…`
      : `Uploading ${filename} (${Math.round(pct)}%)`
  const indeterminate = stage === 'process'
  return (
    <div role="status" className="space-y-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-200">
      <p>{label}</p>
      <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
        <div
          className={cn(
            'h-full bg-neutral-100 transition-[width] duration-150',
            indeterminate && 'animate-pulse',
          )}
          style={{ width: indeterminate ? '100%' : `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  )
}

function Banner({
  tone,
  children,
}: {
  tone: 'info' | 'success' | 'error'
  children: React.ReactNode
}) {
  const styles =
    tone === 'success'
      ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-100'
      : tone === 'error'
        ? 'border-red-700/60 bg-red-950/40 text-red-100'
        : 'border-neutral-700 bg-neutral-900/60 text-neutral-200'
  return (
    <div role="status" className={cn('rounded-md border px-3 py-2 text-sm', styles)}>
      {children}
    </div>
  )
}

function TrackList({ tracks }: { tracks: SignedTrackRow[] }) {
  if (tracks.length === 0) {
    return <p className="text-sm text-neutral-400">No tracks yet.</p>
  }
  return (
    <ul className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
      {tracks.map((track) => (
        <li key={track.id} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-100">{track.title}</p>
            <p className="text-xs text-neutral-500">
              {track.duration_seconds ? formatSeconds(track.duration_seconds) : '—'}
              {track.bpm ? ` · ${track.bpm.toFixed(0)} BPM` : ''}
            </p>
            {track.signedUrl ? (
               
              <audio
                src={track.signedUrl}
                controls
                preload="metadata"
                className="mt-2 h-8 w-full max-w-md"
              />
            ) : null}
          </div>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">
            <ClientDate value={track.created_at} mode="date" />
          </span>
        </li>
      ))}
    </ul>
  )
}

function ClipList({ clips }: { clips: SignedClipRow[] }) {
  if (clips.length === 0) {
    return <p className="text-sm text-neutral-400">No clips yet.</p>
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {clips.map((clip) => (
        <li
          key={clip.id}
          className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-900/40"
        >
          <div className="aspect-[9/16] bg-neutral-950">
            {clip.signedUrl ? (
               
              <video
                src={clip.signedUrl}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-neutral-600">
                no preview
              </div>
            )}
          </div>
          <div className="space-y-1 px-2 py-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">
              {clip.duration_seconds ? `${clip.duration_seconds.toFixed(1)}s` : '—'}
            </p>
            <p className="text-[10px] text-neutral-500">
              <ClientDate value={clip.created_at} mode="date" />
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

async function safeParseResponse<T extends { error?: string }>(
  res: Response,
): Promise<{ body: T | null; message: string }> {
  const text = await res.text().catch(() => '')
  if (!text) {
    const reason =
      res.status === 0
        ? 'Connection closed before response (network or proxy issue)'
        : res.status === 413
          ? 'File too large for the upload endpoint (413 Payload Too Large)'
          : `Empty response from server (status ${res.status})`
    return { body: null, message: reason }
  }
  try {
    const body = JSON.parse(text) as T
    const message = body.error ?? `Request failed (${res.status})`
    return { body, message }
  } catch {
    return { body: null, message: `Non-JSON response (status ${res.status}): ${text.slice(0, 200)}` }
  }
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
