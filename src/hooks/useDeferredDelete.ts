'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

/**
 * Deferred-delete with undo (per docs/ux-principles.md §4).
 *
 * Drops the item from the UI immediately, shows an undo toast, and fires
 * the actual DELETE only when the undo window closes. Undo cancels the
 * queued request — no server round-trip wasted on accidental clicks.
 *
 * If the component unmounts (eg the user navigates away) while a delete
 * is still queued, the request is flushed with `keepalive: true` so the
 * deletion still happens in the background.
 */

const UNDO_WINDOW_MS = 8000

export type DeferredDeleteOptions = {
  /** Build the DELETE URL for a given item id. */
  endpoint: (id: string) => string
  /** Toast headline shown after the optimistic removal. */
  toastLabel?: string
}

export function useDeferredDelete({
  endpoint,
  toastLabel = 'Deleted',
}: DeferredDeleteOptions) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  // Timer handles kept in a ref so the unmount cleanup can flush any
  // queued deletes without going through React state.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const clearPending = useCallback((id: string) => {
    setPendingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const fire = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(endpoint(id), { method: 'DELETE' })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          toast.error(body?.error ?? `Delete failed (${res.status})`)
          clearPending(id)
          return
        }
        clearPending(id)
        startTransition(() => router.refresh())
      } catch (e) {
        clearPending(id)
        toast.error(e instanceof Error ? e.message : 'Delete failed')
      }
    },
    [endpoint, clearPending, router, startTransition],
  )

  const schedule = useCallback(
    (id: string) => {
      // Defensive: if the caller schedules the same id twice in quick
      // succession, drop the older timer.
      const existing = timersRef.current.get(id)
      if (existing) clearTimeout(existing)

      setPendingIds((prev) => {
        if (prev.has(id)) return prev
        const next = new Set(prev)
        next.add(id)
        return next
      })

      const handle = setTimeout(() => {
        timersRef.current.delete(id)
        void fire(id)
      }, UNDO_WINDOW_MS)
      timersRef.current.set(id, handle)

      toast(toastLabel, {
        duration: UNDO_WINDOW_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            const t = timersRef.current.get(id)
            if (t) clearTimeout(t)
            timersRef.current.delete(id)
            clearPending(id)
          },
        },
      })
    },
    [fire, toastLabel, clearPending],
  )

  // Flush any queued deletes on unmount so SPA navigation doesn't leave
  // the user with phantom items that reappear on next load.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((handle, id) => {
        clearTimeout(handle)
        // `keepalive` lets the browser carry the request through the
        // navigation/unload. Errors are intentionally swallowed.
        fetch(endpoint(id), { method: 'DELETE', keepalive: true }).catch(() => {})
      })
      timers.clear()
    }
  }, [endpoint])

  return { pendingIds, schedule }
}
