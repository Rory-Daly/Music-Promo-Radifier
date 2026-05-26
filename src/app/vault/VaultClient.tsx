'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition, type FormEvent } from 'react'
import { ClientDate } from '@/components/ClientDate'
import { ClipPreview } from '@/components/ClipPreview'
import type { BrandKit } from '@/lib/brand-kit/schema'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { uploadFileToStorage } from '@/lib/storage/browser-upload'
import { cn } from '@/lib/utils'
import type { ClipRow, TrackRow } from '@/lib/supabase/queries'
import { BrandTab } from './BrandTab'

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

type Tab = 'tracks' | 'clips' | 'brand'

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string; progressPct: number; stage: 'upload' | 'process' }
  | { kind: 'importing'; folder: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

type Props = {
  artistId: string
  artistSlug: string
  initialTracks: SignedTrackRow[]
  initialClips: SignedClipRow[]
  driveOauthAvailable: boolean
  driveConnected: boolean
  brandKit: BrandKit
  appUrl: string
}

export function VaultClient({
  artistId,
  artistSlug,
  initialTracks,
  initialClips,
  driveOauthAvailable,
  driveConnected,
  brandKit,
  appUrl,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const driveStatus = searchParams.get('drive')
  const driveMsg = searchParams.get('msg')

  const [tab, setTab] = useState<Tab>(driveStatus ? 'clips' : 'tracks')
  const [uploadState, setUploadState] = useState<UploadState>(() => {
    if (driveStatus === 'success') {
      return { kind: 'success', message: 'Google Drive connected.' }
    }
    if (driveStatus === 'error') {
      return {
        kind: 'error',
        message: `Google Drive connection failed: ${driveMsg ?? 'unknown error'}`,
      }
    }
    return { kind: 'idle' }
  })
  const [, startTransition] = useTransition()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  // Clear the OAuth status params from the address bar after first render so
  // a manual refresh doesn't re-trigger the banner. No setState involved —
  // banner state is already initialised from the URL above.
  useEffect(() => {
    if (driveStatus) router.replace('/vault')
  }, [driveStatus, router])

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

  async function importGdriveFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const folder = String(data.get('folder') ?? '').trim()
    if (folder.length === 0) {
      setUploadState({ kind: 'error', message: 'Paste a Drive folder URL or ID first.' })
      return
    }
    setUploadState({ kind: 'importing', folder })
    try {
      const res = await fetch('/api/vault/clips/import-gdrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId, folder }),
      })
      const parsed = await safeParseResponse<{
        error?: string
        imported?: number
        updated?: number
        thumbnails?: number
        total?: number
        message?: string
        thumbnailFailures?: Array<{ name: string; reason: string }>
      }>(res)
      if (!res.ok) {
        setUploadState({ kind: 'error', message: parsed.message })
        return
      }
      const body = parsed.body ?? {}
      const imported = body.imported ?? 0
      const updated = body.updated ?? 0
      const thumbnails = body.thumbnails ?? 0
      const failures = body.thumbnailFailures ?? []
      const parts: string[] = []
      if (imported > 0) parts.push(`imported ${imported}`)
      if (updated > 0) parts.push(`updated ${updated}`)
      if (thumbnails > 0)
        parts.push(`generated ${thumbnails} thumbnail${thumbnails === 1 ? '' : 's'}`)
      if (failures.length > 0)
        parts.push(`${failures.length} thumbnail failure${failures.length === 1 ? '' : 's'}`)
      const summary =
        parts.length === 0 ? (body.message ?? 'Nothing changed.') : parts.join(', ') + '.'
      const message =
        failures.length === 0
          ? summary
          : summary +
            '\nFailures:\n' +
            failures
              .slice(0, 5)
              .map((f) => `• ${f.name}: ${f.reason}`)
              .join('\n') +
            (failures.length > 5 ? `\n…and ${failures.length - 5} more.` : '')
      setUploadState({ kind: failures.length > 0 ? 'error' : 'success', message })
      form.reset()
      startTransition(() => router.refresh())
    } catch (err) {
      setUploadState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Drive import failed',
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
        body: JSON.stringify({ artistId, clipId, path, name: file.name, tags }),
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
      <div role="tablist" className="flex gap-1 border-b border-brand-rule">
        <TabButton active={tab === 'tracks'} onClick={() => setTab('tracks')} label="Tracks" count={initialTracks.length} />
        <TabButton active={tab === 'clips'} onClick={() => setTab('clips')} label="Clips" count={initialClips.length} />
        <TabButton active={tab === 'brand'} onClick={() => setTab('brand')} label="Brand" />
      </div>

      {uploadState.kind === 'uploading' ? (
        <UploadProgress
          filename={uploadState.filename}
          pct={uploadState.progressPct}
          stage={uploadState.stage}
        />
      ) : null}
      {uploadState.kind === 'importing' ? (
        <Banner tone="info">Importing from Drive…</Banner>
      ) : null}
      {uploadState.kind === 'success' ? <Banner tone="success">{uploadState.message}</Banner> : null}
      {uploadState.kind === 'error' ? <Banner tone="error">{uploadState.message}</Banner> : null}

      {tab === 'tracks' ? (
        <section className="space-y-6" role="tabpanel" aria-label="Tracks">
          <form
            onSubmit={uploadTrack}
            className="space-y-3 rounded-md border border-brand-rule bg-brand-bg-2 p-4"
          >
            <h2 className="text-sm font-medium text-brand-fg">Upload a track</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">File</span>
                <input
                  type="file"
                  name="file"
                  accept="audio/*,.wav,.mp3,.flac,.aiff,.aif,.m4a,.ogg"
                  required
                  className="mt-1 block w-full text-xs text-brand-fg file:mr-3 file:rounded-md file:border file:border-brand-rule file:bg-brand-bg-2 file:px-3 file:py-1.5 file:text-xs file:text-brand-fg hover:file:border-brand-accent"
                />
              </label>
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">Title (optional)</span>
                <input
                  type="text"
                  name="title"
                  placeholder="Auto from filename"
                  className="mt-1 block w-full rounded-md border border-brand-rule bg-brand-bg-2 px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={uploadState.kind === 'uploading'}
                className="rounded-md bg-brand-fg px-3 py-2 text-sm font-medium text-brand-bg transition hover:bg-brand-fg disabled:opacity-50"
              >
                Upload
              </button>
            </div>
            <p className="text-xs text-brand-fg-faint">
              Hooks are auto-detected on upload and stored against the track.
            </p>
          </form>

          <SoundCloudTrackForm
            artistId={artistId}
            onResult={(r) => {
              setUploadState(r)
              if (r.kind === 'success') startTransition(() => router.refresh())
            }}
            disabled={uploadState.kind === 'uploading' || uploadState.kind === 'importing'}
          />

          <TrackList tracks={initialTracks} artistSlug={artistSlug} appUrl={appUrl} />
        </section>
      ) : null}

      {tab === 'clips' ? (
        <section className="space-y-6" role="tabpanel" aria-label="Clips">
          <DriveConnection
            artistId={artistId}
            driveOauthAvailable={driveOauthAvailable}
            driveConnected={driveConnected}
            onDisconnect={() => startTransition(() => router.refresh())}
          />

          <form
            onSubmit={importGdriveFolder}
            className="space-y-3 rounded-md border border-brand-rule bg-brand-bg-2 p-4"
          >
            <h2 className="text-sm font-medium text-brand-fg">Import from Google Drive</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
                  Folder URL or ID
                </span>
                <input
                  type="text"
                  name="folder"
                  required
                  placeholder="https://drive.google.com/drive/folders/…"
                  className="mt-1 block w-full rounded-md border border-brand-rule bg-brand-bg-2 px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={uploadState.kind === 'importing'}
                className="rounded-md bg-brand-fg px-3 py-2 text-sm font-medium text-brand-bg transition hover:bg-brand-fg disabled:opacity-50"
              >
                Import
              </button>
            </div>
            <p className="text-xs text-brand-fg-faint">
              The folder must be shared as <strong>Anyone with the link</strong>. Drive IDs are
              stored in the clip — files stay in Drive and are streamed at render time.
            </p>
          </form>

          <form
            onSubmit={uploadClip}
            className="space-y-3 rounded-md border border-brand-rule bg-brand-bg-2 p-4"
          >
            <h2 className="text-sm font-medium text-brand-fg">Upload a clip</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">File</span>
                <input
                  type="file"
                  name="file"
                  accept="video/*,.mp4,.mov,.m4v,.webm"
                  required
                  className="mt-1 block w-full text-xs text-brand-fg file:mr-3 file:rounded-md file:border file:border-brand-rule file:bg-brand-bg-2 file:px-3 file:py-1.5 file:text-xs file:text-brand-fg hover:file:border-brand-accent"
                />
              </label>
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">Tags (comma-separated)</span>
                <input
                  type="text"
                  name="tags"
                  placeholder="drone, dusk, beach"
                  className="mt-1 block w-full rounded-md border border-brand-rule bg-brand-bg-2 px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={uploadState.kind === 'uploading'}
                className="rounded-md bg-brand-fg px-3 py-2 text-sm font-medium text-brand-bg transition hover:bg-brand-fg disabled:opacity-50"
              >
                Upload
              </button>
            </div>
            <p className="text-xs text-brand-fg-faint">
              Clips become candidates for the composer&apos;s auto-selection.
            </p>
          </form>
          <ClipList clips={initialClips} />
        </section>
      ) : null}

      {tab === 'brand' ? <BrandTab artistId={artistId} brandKit={brandKit} /> : null}
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
  count?: number
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
          ? 'border-brand-fg text-brand-fg'
          : 'border-transparent text-brand-fg-faint hover:text-brand-fg',
      )}
    >
      {label}
      {typeof count === 'number' ? (
        <span className="text-xs text-brand-fg-faint"> ({count})</span>
      ) : null}
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
    <div role="status" className="space-y-2 rounded-md border border-brand-rule bg-brand-bg-2 px-3 py-2 text-sm text-brand-fg">
      <p>{label}</p>
      <div className="h-1.5 w-full overflow-hidden rounded bg-brand-bg-2">
        <div
          className={cn(
            'h-full bg-brand-fg transition-[width] duration-150',
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
        : 'border-brand-rule bg-brand-bg-2 text-brand-fg'
  return (
    <div
      role="status"
      className={cn(
        'whitespace-pre-line rounded-md border px-3 py-2 text-sm leading-relaxed',
        styles,
      )}
    >
      {children}
    </div>
  )
}

function SoundCloudTrackForm({
  artistId,
  onResult,
  disabled,
}: {
  artistId: string
  onResult: (state: UploadState) => void
  disabled: boolean
}) {
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const url = String(data.get('url') ?? '').trim()
    const title = String(data.get('title') ?? '').trim()
    if (!url) {
      onResult({ kind: 'error', message: 'Paste a SoundCloud URL first.' })
      return
    }
    if (!title) {
      onResult({ kind: 'error', message: 'Add a title — pulled from the SoundCloud page is fine.' })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/vault/tracks/soundcloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId, trackId: crypto.randomUUID(), url, title }),
      })
      const body = (await res.json().catch(() => null)) as
        | { error?: string; slug?: string }
        | null
      if (!res.ok) {
        onResult({ kind: 'error', message: body?.error ?? `Add failed (${res.status})` })
        return
      }
      onResult({ kind: 'success', message: `Added ${title}` })
      form.reset()
    } catch (e) {
      onResult({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Add failed',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-brand-rule bg-brand-bg-2 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-brand-fg">Add from SoundCloud</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
          no audio upload · no hook detection
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
        <label className="block">
          <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
            SoundCloud URL
          </span>
          <input
            type="url"
            name="url"
            required
            placeholder="https://soundcloud.com/illutible/…"
            className="mt-1 block w-full rounded-md border border-brand-rule bg-brand-bg-2 px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-xs uppercase tracking-[0.2em] text-brand-fg-faint">Title</span>
          <input
            type="text"
            name="title"
            required
            placeholder="e.g. Playing for Keeps"
            className="mt-1 block w-full rounded-md border border-brand-rule bg-brand-bg-2 px-2.5 py-1.5 text-sm text-brand-fg focus:border-brand-accent focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={disabled || submitting}
          className="rounded-md border border-brand-accent bg-brand-accent px-3 py-2 text-sm font-medium text-brand-bg transition disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
      <p className="text-xs text-brand-fg-faint">
        Use this for tracks that already live on SoundCloud — gets the smart-link URL without
        re-hosting audio. Compose / render features need an uploaded file.
      </p>
    </form>
  )
}

function TrackList({
  tracks,
  artistSlug,
  appUrl,
}: {
  tracks: SignedTrackRow[]
  artistSlug: string
  appUrl: string
}) {
  if (tracks.length === 0) {
    return <p className="text-sm text-brand-fg-dim">No tracks yet.</p>
  }
  return (
    <ul className="divide-y divide-brand-rule rounded-md border border-brand-rule">
      {tracks.map((track) => {
        const smartLink = `${appUrl}/r/${artistSlug}/${track.slug}`
        return (
          <li key={track.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-brand-fg">{track.title}</p>
                <span
                  className={cn(
                    'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em]',
                    track.source === 'soundcloud'
                      ? 'border-brand-accent text-brand-accent'
                      : 'border-brand-rule text-brand-fg-faint',
                  )}
                >
                  {track.source}
                </span>
              </div>
              <p className="text-xs text-brand-fg-faint">
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
              <SmartLinkCopy href={smartLink} />
            </div>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-brand-fg-faint">
              <ClientDate value={track.created_at} mode="date" />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function SmartLinkCopy({ href }: { href: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail in non-secure contexts; fall through silently.
    }
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="truncate font-mono text-[10px] text-brand-fg-dim hover:text-brand-accent"
      >
        {href.replace(/^https?:\/\//, '')}
      </a>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded border border-brand-rule px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-brand-fg-faint transition hover:border-brand-accent hover:text-brand-fg"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function ClipList({ clips }: { clips: SignedClipRow[] }) {
  if (clips.length === 0) {
    return <p className="text-sm text-brand-fg-dim">No clips yet.</p>
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {clips.map((clip) => (
        <li
          key={clip.id}
          className="overflow-hidden rounded-md border border-brand-rule bg-brand-bg-2"
        >
          <div className="relative aspect-[9/16] bg-brand-bg">
            <ClipPreview clip={clip} />
            {clip.source === 'gdrive' ? (
              <span className="absolute right-1 top-1 rounded-sm bg-brand-bg px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-brand-fg-dim">
                drive
              </span>
            ) : null}
          </div>
          <div className="space-y-1 px-2 py-1.5">
            <p className="truncate text-xs text-brand-fg" title={clip.name ?? undefined}>
              {clip.name ?? '(unnamed)'}
            </p>
            <div className="flex items-center justify-between text-[10px] text-brand-fg-faint">
              <span className="font-mono uppercase tracking-[0.2em]">
                {clip.duration_seconds ? `${clip.duration_seconds.toFixed(1)}s` : '—'}
              </span>
              <ClientDate value={clip.created_at} mode="date" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function DriveConnection({
  artistId,
  driveOauthAvailable,
  driveConnected,
  onDisconnect,
}: {
  artistId: string
  driveOauthAvailable: boolean
  driveConnected: boolean
  onDisconnect: () => void
}) {
  const [busy, setBusy] = useState(false)
  if (!driveOauthAvailable) {
    return (
      <div className="rounded-md border border-brand-rule bg-brand-bg-2 px-4 py-3 text-xs text-brand-fg-dim">
        Sign-in with Google not configured. Set <code className="text-brand-fg">GOOGLE_OAUTH_CLIENT_ID</code> /{' '}
        <code className="text-brand-fg">GOOGLE_OAUTH_CLIENT_SECRET</code> to allow private folders and bypass anonymous quotas.
      </div>
    )
  }
  if (!driveConnected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-brand-rule bg-brand-bg-2 px-4 py-3 text-sm">
        <div>
          <p className="text-brand-fg">Google Drive — not connected</p>
          <p className="mt-0.5 text-xs text-brand-fg-faint">
            Sign in once to import private folders and bypass per-file download quotas.
          </p>
        </div>
        <a
          href={`/api/integrations/google/start?artistId=${encodeURIComponent(artistId)}`}
          className="rounded-md bg-brand-fg px-3 py-1.5 text-xs font-medium text-brand-bg hover:bg-brand-fg"
        >
          Connect Google Drive
        </a>
      </div>
    )
  }
  async function disconnect() {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/integrations/google/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artistId }),
      })
      onDisconnect()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-700/60 bg-emerald-950/30 px-4 py-3 text-sm">
      <div>
        <p className="text-emerald-100">Google Drive — connected</p>
        <p className="mt-0.5 text-xs text-emerald-300/80">
          Imports and renders will use your account; per-file anonymous quotas don&apos;t apply.
        </p>
      </div>
      <button
        type="button"
        onClick={disconnect}
        disabled={busy}
        className="text-xs font-medium text-emerald-200 underline-offset-4 hover:text-emerald-50 hover:underline disabled:opacity-50"
      >
        Disconnect
      </button>
    </div>
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
