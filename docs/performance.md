# Performance Conventions

Apply these consistently. Most are cheap habits that compound across the codebase.

---

## Data fetching

**Enumerate DB fields — never `select('*')`**
For tables queried at scale (anything with >10 rows per user), list only the fields the TypeScript type actually uses. `select('*')` fetches 3–4× more data than needed and balloons response payloads.

**Parallelize independent server-side fetches**
When a server component or API route needs data from multiple independent sources, use `Promise.all`. Sequential awaits are the single most common accidental latency source.

```ts
// Bad
const okrData = await loadOKRData(...);
const projectData = await loadProjectData(...);

// Good
const [okrData, projectData] = await Promise.all([
  loadOKRData(...),
  loadProjectData(...),
]);
```

**`revalidatePath` is a no-op in SWR architectures**
`revalidatePath('/plan')` invalidates the Next.js RSC cache for a page, but if your page component returns `null` (or a cache-warming helper), the actual data lives in `/api/panels/*` route handlers fetched via SWR. Calling `revalidatePath` adds server overhead with no client benefit. Use `mutate('/api/panels/plan')` after mutations instead:

```ts
const { mutate } = useSWRConfig();
await updateProject(data);
await mutate('/api/panels/plan'); // triggers SWR refetch
```

**SWR config baseline**
All data hooks should include:

```ts
useSWR(key, fetcher, {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 30_000, // prevents spammy focus revalidations
});
```

---

## Bundle size

**Lazy-import heavy packages (>50KB)**

For React components, use `next/dynamic`:

```ts
const KanbanBoard = dynamic(
  () => import('@/components/hud/KanbanBoard').then(m => m.KanbanBoard),
  { ssr: false, loading: () => <KanbanSkeleton /> }
);
```

For server-side packages used conditionally, use a lazy factory:

```ts
// Before: import { google } from 'googleapis'; // loads on every cold start
// After:
export async function getDriveClient() {
  const { google } = await import('googleapis');
  return initDriveClient(google);
}
```

**Common packages to lazy-import:** `googleapis`, rich text editors (Tiptap, Lexical, Slate), PDF libraries, chart libraries, DnD libraries.

---

## Images and fonts

**`loading="lazy"` on below-fold images only**
Images that appear in lists, galleries, or card grids below the fold should use `loading="lazy"`. Never add it to hero images, logos, or any image visible on first paint.

**`priority` on above-fold Next.js `<Image>` only**
Add the `priority` prop to the LCP image and above-fold branding. Applying it broadly defeats the purpose — it forces eager loading of images that would be faster lazy.

**Font display: `'optional'`**
For body fonts loaded from Google Fonts or `next/font`, use `display: 'optional'`. This eliminates the flash of unstyled text (FOUT) on repeat visits by skipping the font swap if the font isn't cached within a brief window.

```ts
const inter = Inter({ subsets: ['latin'], display: 'optional' });
```

---

## Logging

**No debug `console.log` in data-fetch paths**
Server-side `console.log` in API routes, server actions, or data loaders streams to Vercel logs (and any connected log drains) on every request. Remove debug logs before committing. Operational facts (counts, durations, errors) are fine; debug dumps of fetched data are not.

---

## Optimistic UI

Apply state changes to the UI immediately — before the server confirms — then reconcile in the background. Roll back on failure. Never make the user wait for a round-trip before their action is reflected.

**Pattern with SWR `mutate`:**

```tsx
async function handleDelete(id: string) {
  // 1. Apply optimistically
  mutate('/api/items', (current: Item[]) => current?.filter((item) => item.id !== id), {
    revalidate: false,
  });
  try {
    await deleteItem(id);
    mutate('/api/items'); // confirm with server
  } catch {
    mutate('/api/items'); // roll back by revalidating
    toast.error('Could not delete — changes reverted');
  }
}
```

**Rules:**

- Disable submit buttons and show a spinner the moment a form submits — re-enable only on success or error.
- If an operation will take >300ms, show a progress indicator. Never leave the UI static while async work runs.
- Failed optimistic updates must roll back visually and show a clear error toast.

---

## SWR cache warming (SPA architectures)

In apps that use a multi-panel SPA shell (where a single React tree persists across navigations and panels are shown/hidden via CSS), server-side data can't safely be passed to panels as RSC `children` frozen in state — RSC reconciliation from `revalidatePath` calls will replace the frozen element, causing blank renders.

The safe pattern is `SWRCacheWarmer`: the server page fetches data and returns a tiny invisible client component that pre-populates the SWR cache via `useLayoutEffect` before the panel's `useSWR` fires its first request.

```tsx
// src/components/shell/SWRCacheWarmer.tsx
'use client';
import { useEffect, useLayoutEffect } from 'react';
import { mutate } from 'swr';

const useIsomorphicLayoutEffect =
  typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export function SWRCacheWarmer({ cacheKey, data }: { cacheKey: string; data: unknown }) {
  useIsomorphicLayoutEffect(() => {
    void mutate(cacheKey, data, { revalidate: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// In dash/page.tsx:
export default async function DashPage() {
  const data = await loadDashData(...);
  return <SWRCacheWarmer cacheKey="/api/panels/dash" data={data} />;
}

// In MultiPanelHost, mount it in a hidden div so effects fire without visibility:
<div hidden>{children}</div>
```

`useLayoutEffect` fires before SWR's own `useEffect` fetch, so the cache is warm before the first subscription — no skeleton on cold load.
