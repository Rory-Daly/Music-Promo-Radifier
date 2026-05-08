# Accessibility & UX Audit

Perform a full accessibility and UX audit of this codebase, then produce a prioritised upgrade plan. Do not make any changes yet — assessment and plan only.

---

## Context

This app was built before the following standards were in place. It likely has:

- Custom keyboard event handlers (`onKeyDown`, `onKeyUp`, `keyCode`/`key` checks) that were hand-rolled before Radix UI became the standard
- `tabindex` values that may include positive integers
- ARIA attributes managed manually on divs and spans rather than via semantic elements or headless primitives
- Focus management code (trap logic, return-to-trigger) that was written by hand
- Possibly missing `aria-live` regions for dynamic content
- Hover effects that cause layout shift or use `scale`/`translate` transforms
- Confirmation dialogs where undo toasts would be more appropriate
- Generic spinners where layout-matching skeletons would be better
- Button sizes and heading scales that are inconsistent across the app

The goal is to migrate toward the standards defined in `docs/accessibility.md`, `docs/ux-principles.md`, and `docs/ui-patterns.md`. This is not a trivial change — there is significant existing keyboard management that must be assessed carefully before recommending any replacement.

---

## Phase 1 — Inventory (do this first, before forming any plan)

### 1a. Map all custom keyboard management

Search the entire `src/` directory for:

- `onKeyDown` / `onKeyUp` / `onKeyPress`
- `keyCode` / `event.key` / `e.key`
- `addEventListener('keydown'` / `addEventListener('keyup'`

For each match, record:

- File and line number
- What widget/interaction it belongs to (modal, menu, combobox, tabs, custom widget, etc.)
- What the handler does (arrow key routing, Escape to close, Enter to activate, Tab trapping, etc.)
- Whether a Radix/shadcn primitive now covers this pattern

### 1b. Map all tabindex usage

Search for:

- `tabIndex=` / `tabindex=`
- Any value other than `0` or `-1`
- Specifically flag any positive integers

### 1c. Map all manual ARIA management

Search for direct uses of:

- `aria-expanded` / `aria-selected` / `aria-current` / `aria-checked` set via state props
- `role="dialog"` / `role="menu"` / `role="listbox"` / `role="tabpanel"` / `role="combobox"` on non-native elements
- `aria-live` / `aria-atomic` (note: these are good — catalogue them so we know what's already covered)

### 1d. Map all interactive divs and spans

Search for:

- `<div` or `<span` with `onClick` handlers
- `<div` or `<span` with `onKeyDown` handlers
- `cursor-pointer` on non-button, non-link elements (Tailwind grep)

### 1e. Identify existing Radix / headless library usage

Search for imports from:

- `@radix-ui/*`
- `@headlessui/*`
- `cmdk`
- `vaul`
- `react-aria`

Note what's already been migrated so we don't recommend duplicating it.

### 1f. Scan for UX pattern violations

Look for:

- `hover:scale-` / `hover:translate-` Tailwind classes
- `transition-all` (too broad — causes unexpected layout shifts)
- `animate-pulse` without `motion-safe:` prefix
- `window.confirm(` / `confirm(` usage
- Spinner components used as page/section loading states (vs. action loading states)
- `focus:outline-none` without a replacement focus ring

---

## Phase 2 — Categorise findings

Group every finding into one of these buckets:

**A — Replace with Radix primitive (high confidence)**
Custom keyboard/ARIA code where a Radix primitive covers the exact pattern. These are the highest-value replacements: the custom code can be deleted, not just patched. Examples: hand-rolled dialog focus traps, custom dropdown arrow-key routing, manual tab panel keyboard management.

**B — Wrap with Radix primitive (medium complexity)**
Existing interactive divs that can be replaced with a native element or Radix primitive, but require refactoring the data flow or props.

**C — Augment with ARIA (lower risk)**
Code that has correct behaviour but is missing labelling: `aria-label` on icon buttons, `aria-live` regions for dynamic content, `alt` attributes on images.

**D — UX pattern violations (cosmetic / interaction)**
`hover:scale-*`, layout-shifting hovers, `transition-all`, missing `motion-safe:`, confirm dialogs that should be undo toasts, spinners that should be skeletons.

**E — Needs specialist review**
Custom widgets that have no direct Radix equivalent and have complex existing keyboard logic. These need careful assessment before any recommendation — do not suggest replacement without understanding exactly what behaviour must be preserved.

---

## Phase 3 — Produce the upgrade plan

For each finding, produce a line item with:

```
[Priority] [Bucket] File:line — Description
  Current: what the code does now
  Problem: why this doesn't meet the standard
  Recommendation: specific change (e.g. "replace with shadcn Dialog", "add aria-label", "wrap in motion-safe:")
  Risk: low / medium / high (based on how much existing logic would change)
  Effort: S / M / L
```

Then produce a phased rollout order:

- **Phase 1**: All bucket C items (pure additions, zero regression risk)
- **Phase 2**: All bucket D items (cosmetic/UX, low regression risk)
- **Phase 3**: Bucket A items ordered by effort (smallest first)
- **Phase 4**: Bucket B items
- **Phase 5**: Bucket E items (each requiring its own sub-plan)

---

## Phase 4 — Summarise

Close with:

1. Total count of issues by bucket
2. Estimated scope: how many files touched, rough S/M/L effort per phase
3. The single highest-value change (the one that eliminates the most custom code for the least risk)
4. Any existing custom keyboard management that looks correct and should be **preserved** even after migration — flag these explicitly so they are not accidentally removed

---

## Important constraints

- **Do not make any code changes in this task.** Assessment and plan only.
- Where existing custom keyboard management is sophisticated or covers edge cases, note what must be preserved in the recommendation — do not assume Radix handles every edge case out of the box.
- If you find a pattern where the existing hand-rolled solution is better than the Radix equivalent for this specific use case, say so. The goal is correctness, not replacing custom code for its own sake.
- If the app already uses Radix for some components, note those as reference implementations — the migration style should match what's already been done.
