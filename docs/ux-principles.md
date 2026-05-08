# UX Principles

These are mandatory quality gates — not aspirational guidelines. Complete each checklist before marking any UI task done.

Read this file before any task that shows, hides, animates, or moves UI elements.

---

## 1. User retains locus of control

The user is always the one driving. The interface follows their intent — it never acts on their behalf without a signal.

**Rules:**

- Never auto-scroll content the user may be reading. Only scroll in response to an explicit user action (e.g. clicking a "Jump to bottom" button, submitting a form that moves focus).
- Never steal focus from an element the user is interacting with.
- Never close a menu, sheet, or popover because of a timer or background event — only on user action (click outside, Escape, explicit close).
- Never redirect or navigate away from the current page without user intent. Background refreshes must not cause navigation.

---

## 2. No unmotivated movement

Fast, purposeful animation is fine. Unsolicited jiggle, bounce, grow-on-hover, and auto-scroll are not.

**The test:** Can you point to the user action that caused this movement? If yes — it's motivated. If no — remove it.

**Rules:**

- No scale/size transforms on hover (e.g. `hover:scale-105`). Use colour, shadow, or border changes for hover feedback instead.
- No layout shifts caused by adding padding or margin on interaction (e.g. a card that gains `p-4` on hover, pushing surrounding content).
- No entrance animations on content that is already visible on load — reserve for things appearing in response to user action.
- Transitions must be short: `duration-150` or `duration-200` for hover/focus; `duration-300` max for modals and drawers.
- Always respect `prefers-reduced-motion` — wrap any decorative animation in the `motion-safe:` Tailwind variant.

```tsx
// Bad — unsolicited movement, ignores reduced motion
<div className="hover:scale-105 transition-transform duration-300">

// Good — colour feedback only, no movement
<div className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-150">

// Good — animated entrance, but respects reduced motion
<div className="motion-safe:animate-fade-in">
```

**Checklist — before marking any UI task complete:**

- [ ] No `hover:scale-*` or `hover:translate-*` on any element
- [ ] No layout shift on hover or focus (inspect with browser layout shift debugger)
- [ ] All transitions use `duration-150` or `duration-200`; modals/drawers `duration-300` max
- [ ] Decorative animations wrapped in `motion-safe:`

---

## 3. Optimistic updates and immediate feedback

Make changes to the UI instantly, then reconcile with the server in the background. Never make the user wait for a round-trip before seeing their action reflected.

**Rules:**

- Apply state changes to the UI before the server request completes (optimistic update). Roll back with an error toast if the request fails.
- Always acknowledge a user action immediately — disable submit buttons, show a spinner, or change state — even if the work will take time.
- Show visible content as fast as possible, then lazy-load hidden/below-fold content in the background so it's preloaded for the next action.
- Use `useSWR` with `mutate` for optimistic updates in client components:

```tsx
// Optimistic delete example
async function handleDelete(id: string) {
  // 1. Update UI immediately
  mutate('/api/items', (current) => current?.filter((item) => item.id !== id), {
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

- Disable the submit button and show a spinner the moment a form is submitted. Re-enable only on success or error.
- If an async operation takes >300ms, show a progress indicator. Never leave the user staring at a static UI.

**Checklist — before marking any UI task complete:**

- [ ] Mutations update local state before awaiting the server response
- [ ] Submit buttons disable + show spinner on submit
- [ ] Failed mutations roll back the optimistic state and show an error toast
- [ ] No frozen/unresponsive UI states while async work runs

---

## 4. Easy undo over confirmation dialogs

When something disappears from the interface (deleted, archived, moved out of filter scope), do not interrupt the user with a confirmation dialog. Instead, let the action complete immediately and offer a time-limited undo toast.

**When to use undo instead of confirm:**

- Deleting an item the user just created or is viewing
- Archiving or hiding content
- Removing a tag, relation, or link
- Any action that is reversible within a reasonable window (30 seconds)

**When a confirmation dialog IS appropriate:**

- Irreversible destructive actions (e.g. permanently deleting an account, purging a dataset)
- Actions with significant downstream consequences that are not obviously undoable
- Actions affecting other people's data

**Undo toast pattern:**

```tsx
// Show action, then undo affordance
toast('Item deleted', {
  action: {
    label: 'Undo',
    onClick: () => restoreItem(id),
  },
  duration: 8000, // give enough time to notice and act
});
```

**Checklist — before marking any destructive action complete:**

- [ ] Reversible actions use undo toast, not confirm dialog
- [ ] Undo window is at least 5 seconds (8 seconds recommended)
- [ ] Undo restores the item to exactly its previous state and position

---

## 5. Consistent, familiar UI elements

Users build trust through pattern recognition. Once we establish a UI widget for a problem (e.g. selecting from a list), use the same widget everywhere that problem recurs.

**Rules:**

- Before building any new interactive element, check `docs/ui-patterns.md` first.
- If a standard element exists that solves the problem, use it — even if you could build something slightly more bespoke.
- Add genuinely new patterns to `docs/ui-patterns.md` so they can be reused.
- Never have two slightly different versions of the same element living in parallel — consolidate into one component with props.

---

## 6. Consistent rhythm and sizing

**Button sizes — always use one of these three:**

| Size | Use case                                                  | Tailwind classes                               |
| ---- | --------------------------------------------------------- | ---------------------------------------------- |
| `sm` | Incidental actions within content (e.g. tag, inline edit) | `h-7 px-2.5 text-xs rounded font-medium`       |
| `md` | Standard form controls and secondary actions              | `h-9 px-4 text-sm rounded-md font-medium`      |
| `lg` | Primary form submit / prominent CTAs                      | `h-11 px-6 text-base rounded-lg font-semibold` |

A `link` button is a variant of `sm`: same font size, no background, underline on hover.

**Heading scale:**

| Level | Tailwind classes                    |
| ----- | ----------------------------------- |
| `h1`  | `text-2xl font-bold tracking-tight` |
| `h2`  | `text-xl font-semibold`             |
| `h3`  | `text-base font-semibold`           |
| `h4`  | `text-sm font-semibold`             |

**Spacing rhythm:** Use multiples of 4 for all padding and margin (`p-1`=4px, `p-2`=8px, `p-4`=16px, `p-6`=24px, `p-8`=32px). Avoid arbitrary values unless unavoidable.

**Modal and drawer widths:**

| Type                | Max width                     |
| ------------------- | ----------------------------- |
| Confirmation        | `max-w-sm` (384px)            |
| Standard form       | `max-w-md` (448px)            |
| Complex form        | `max-w-lg` (512px)            |
| Wide/data           | `max-w-2xl` (672px)           |
| Full-screen overlay | `max-w-full` with safe insets |

**Checklist — before marking any UI task complete:**

- [ ] Buttons use only `sm`, `md`, or `lg` sizes from the table above
- [ ] Heading levels follow the scale — no ad-hoc `text-lg font-bold` combinations
- [ ] Spacing uses 4px-multiple values — no arbitrary `px-[18px]` etc.

---

## 7. PWA / fullscreen mode

In PWA mode (standalone display) the browser chrome is gone — content can reach the very top of the screen and collide with the device notch or status bar.

**Rules:**

- Add `pt-safe` (or `padding-top: env(safe-area-inset-top)`) to any fixed header or top-of-screen element.
- Never place interactive elements in the top ~44px without safe-area padding — they will be unreachable on notched devices.
- Test layout in Safari with "Add to Home Screen" or use the Xcode simulator's notched device profiles.

```tsx
// Tailwind with safe area (requires tailwindcss-safe-area plugin or manual config)
<header className="fixed top-0 inset-x-0 pt-safe bg-white dark:bg-slate-900">

// CSS fallback
style={{ paddingTop: 'env(safe-area-inset-top)' }}
```

---

## 8. Responsive design collapse rules

| Screen size      | Layout rule                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile (`< md`)  | Single column. Everything stacks vertically.                                                                                            |
| Mobile (`< md`)  | Side panels, drawers, and secondary content become modals or bottom sheets.                                                             |
| Tablet (`md–lg`) | Two-column max. Content that doesn't fit flows below (not truncated or hidden).                                                         |
| Tablet (`md–lg`) | Horizontal scroll is acceptable for data tables, timelines, and kanban boards — where the same metaphor is standard in comparable apps. |
| Desktop (`> lg`) | Full layout. Multi-column sidebars and panels are fine.                                                                                 |

Never hide content on mobile by just applying `hidden md:block`. If the content matters, find a mobile-appropriate way to surface it (collapsed section, bottom sheet, secondary screen).

---

## 9. Skeleton screens over generic spinners

For initial content loads, use a skeleton that mirrors the layout of the actual content — not a generic spinner in the middle of the screen. This preserves layout stability, reduces perceived load time, and prevents jarring shifts when content arrives.

- Use a spinner only for discrete actions (button submit, uploading a file) where there is no content shape to mirror.
- Skeletons must match the approximate height and column structure of the loaded content.
- Skeletons should pulse with `animate-pulse` — but wrapped in `motion-safe:animate-pulse` to respect reduced motion.

```tsx
// Generic spinner — avoid for page/section loads
<div className="flex justify-center"><Spinner /></div>

// Skeleton — mirrors content shape
<div className="space-y-3">
  <div className="motion-safe:animate-pulse h-5 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
  <div className="motion-safe:animate-pulse h-4 w-full rounded bg-slate-200 dark:bg-slate-700" />
  <div className="motion-safe:animate-pulse h-4 w-5/6 rounded bg-slate-200 dark:bg-slate-700" />
</div>
```

---

## 10. Inline editing over modal editing

Where possible, let users edit content in place rather than opening a modal. Reserve modals for:

- Multi-field forms that need a clean context (e.g. creating a new entity)
- Flows with multiple steps
- Actions that need to clearly block the underlying page

For single-field edits (renaming, changing a value, toggling a setting), use inline editing with a click-to-edit pattern and an explicit save/cancel affordance.

---

## 11. Error states need recovery actions

An error state must always tell the user what to do next. "Something went wrong" with no action is a dead end.

**Every error state must include at least one of:**

- A retry action
- A navigation escape (e.g. "Go back", "Return to dashboard")
- Contact/support information for errors the user cannot self-recover from

```tsx
// Bad
<p className="text-red-500">Something went wrong.</p>

// Good
<div>
  <p className="text-red-500">Could not load your data.</p>
  <button onClick={retry}>Try again</button>
</div>
```

---

## 12. No orphaned loading states

A component that enters a loading state must always exit it — either with content, or with an error state. A spinner that runs forever because a fetch silently failed destroys trust.

**Rules:**

- All data fetches must have a timeout or error boundary.
- Never leave `isLoading: true` as a possible permanent state — always handle the error case.
- If using SWR, always handle the `error` return alongside `data`.

```tsx
const { data, error, isLoading } = useSWR('/api/items', fetcher);

if (isLoading) return <ItemsSkeleton />;
if (error) return <ErrorState onRetry={() => mutate('/api/items')} />;
return <ItemsList items={data} />;
```
