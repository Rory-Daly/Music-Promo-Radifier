'use client'

import { useSyncExternalStore } from 'react'

type Mode = 'date' | 'datetime'

const subscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

/**
 * Renders an ISO timestamp using the browser's locale + timezone.
 *
 * Why this exists: `new Date(x).toLocaleString()` uses the runtime's
 * default locale, which differs between the Node server (often en-US /
 * UTC) and the browser (the user's actual locale). Rendering it during
 * SSR causes a hydration mismatch. We render an empty span on the
 * server pass, then fill it in on the client — single render path,
 * no mismatch.
 */
export function ClientDate({ value, mode = 'datetime' }: { value: string; mode?: Mode }) {
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
  if (!mounted) return <span suppressHydrationWarning />
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return <span suppressHydrationWarning />
  const text = mode === 'date' ? d.toLocaleDateString() : d.toLocaleString()
  return <span suppressHydrationWarning>{text}</span>
}
