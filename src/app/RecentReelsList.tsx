'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { ClientDate } from '@/components/ClientDate'
import type { RenderRow } from '@/lib/supabase/queries'
import { cn } from '@/lib/utils'

type Props = {
  initialRenders: RenderRow[]
}

export function RecentReelsList({ initialRenders }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [renders, setRenders] = useState<RenderRow[]>(initialRenders)
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<
    { kind: 'success'; message: string } | { kind: 'error'; message: string } | null
  >(null)

  const sorted = useMemo(
    () => [...renders].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [renders],
  )

  async function remove(render: RenderRow) {
    setBusy(render.id)
    setBanner(null)
    // Optimistically drop the card. Restore on failure so the user sees what
    // happened instead of a silently-still-there card.
    const previous = renders
    setRenders((rs) => rs.filter((r) => r.id !== render.id))
    try {
      const res = await fetch(`/api/renders/${render.id}`, { method: 'DELETE' })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setRenders(previous)
        setBanner({ kind: 'error', message: body?.error ?? `Delete failed (${res.status})` })
        return
      }
      setBanner({ kind: 'success', message: 'Reel deleted' })
      startTransition(() => router.refresh())
    } catch (e) {
      setRenders(previous)
      setBanner({ kind: 'error', message: e instanceof Error ? e.message : 'Delete failed' })
    } finally {
      setBusy(null)
    }
  }

  if (sorted.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {banner ? (
        <p
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            banner.kind === 'success'
              ? 'border-brand-rule bg-brand-bg-2 text-brand-fg'
              : 'border-brand-accent-2 bg-brand-bg-2 text-brand-fg',
          )}
        >
          {banner.message}
        </p>
      ) : null}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((render) => (
          <li key={render.id}>
            <RenderCard
              render={render}
              busy={busy === render.id}
              onDelete={() => remove(render)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function RenderCard({
  render,
  busy,
  onDelete,
}: {
  render: RenderRow
  busy: boolean
  onDelete: () => void
}) {
  const ready = render.status === 'ready' && render.output_url
  return (
    <div className="overflow-hidden rounded-md border border-brand-rule bg-brand-bg-2">
      <div className="aspect-[9/16] bg-brand-bg">
        {ready ? (

          <video
            src={render.output_url ?? undefined}
            className="h-full w-full object-cover"
            controls
            preload="metadata"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-4 text-center">
            <span className="text-xs uppercase tracking-[0.2em] text-brand-fg-faint">
              {render.status}
              {render.error ? ` — ${render.error.slice(0, 60)}` : ''}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="font-mono uppercase tracking-[0.2em] text-brand-fg-faint">
          {render.aspect_ratio ?? 'reel'}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-brand-fg-faint">
            <ClientDate value={render.created_at} />
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            aria-label="Delete reel"
            className="rounded-md border border-brand-accent-2 px-2 py-0.5 font-medium text-brand-accent-2 transition hover:bg-brand-accent-2 hover:text-brand-fg disabled:opacity-50"
          >
            {busy ? '…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
