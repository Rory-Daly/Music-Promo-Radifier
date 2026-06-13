'use client'

import { useCallback, useMemo } from 'react'
import { ClientDate } from '@/components/ClientDate'
import { useDeferredDelete } from '@/hooks/useDeferredDelete'
import type { RenderRow } from '@/lib/supabase/queries'

type Props = {
  initialRenders: RenderRow[]
}

export function RecentReelsList({ initialRenders }: Props) {
  const endpoint = useCallback((id: string) => `/api/renders/${id}`, [])
  const { pendingIds, schedule } = useDeferredDelete({ endpoint, toastLabel: 'Reel deleted' })

  const visible = useMemo(
    () =>
      [...initialRenders]
        .filter((r) => !pendingIds.has(r.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [initialRenders, pendingIds],
  )

  if (visible.length === 0) return null

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((render) => (
        <li key={render.id}>
          <RenderCard render={render} onDelete={() => schedule(render.id)} />
        </li>
      ))}
    </ul>
  )
}

function RenderCard({
  render,
  onDelete,
}: {
  render: RenderRow
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
            onClick={onDelete}
            aria-label="Delete reel"
            className="rounded-md border border-brand-accent-2 px-2 py-0.5 font-medium text-brand-accent-2 transition hover:bg-brand-accent-2 hover:text-brand-fg"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
