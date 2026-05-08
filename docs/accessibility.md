# Accessibility & Responsive Design

These are mandatory quality gates — not aspirational guidelines. Complete each checklist before marking any UI task done.

---

## 1. Mobile-first layout

Build mobile-first: base Tailwind classes apply at all sizes; `md:` and `lg:` prefixes add layout for larger screens only. Never design desktop-first and then try to shrink.

**Checklist — before marking any UI task complete:**

- [ ] Renders correctly at **375px width** (iPhone SE — most constrained common viewport)
- [ ] Stacked vertically on mobile; row/grid layout at `md:` and above
- [ ] No horizontal overflow — nothing extends past the viewport edge (check `overflow-x` in dev tools)
- [ ] Touch targets: all interactive elements are at minimum **44×44px** (`min-h-[44px]` or `p-3` on small icons)
- [ ] Text is readable without zooming — effective minimum ~14px

```tsx
// Bad: desktop-first, mobile is an afterthought
<div className="flex gap-4 sm:flex-col">

// Good: mobile-first, desktop is the enhancement
<div className="flex flex-col gap-4 md:flex-row">
```

---

## 2. Light and dark mode

Every color class must work in both modes. Use Tailwind dark mode pairs consistently:

```tsx
// Text
className = 'text-slate-900 dark:text-slate-100';

// Backgrounds
className = 'bg-white dark:bg-slate-900';

// Borders
className = 'border-slate-200 dark:border-slate-700';

// Muted/secondary text
className = 'text-slate-500 dark:text-slate-400';
```

**WCAG AA contrast requirements:**

| Text type                                    | Minimum ratio |
| -------------------------------------------- | ------------- |
| Normal text (<18px regular / <14px bold)     | **4.5 : 1**   |
| Large text (≥18px regular / ≥14px bold)      | **3 : 1**     |
| UI components (buttons, inputs, focus rings) | **3 : 1**     |

Never rely on color alone to convey information — pair color with a text label, icon, or pattern.

**Checklist — before marking any UI task complete that introduces color:**

- [ ] Viewed in **both dark and light mode**
- [ ] Body text passes 4.5:1 contrast against its background in both modes
- [ ] Secondary/muted text, placeholder text, and disabled states checked — these commonly fail
- [ ] No information conveyed by color alone (error states have icons/labels; status badges have text)

---

## 3. Keyboard navigation

### The decision hierarchy

Always resolve keyboard behaviour in this order — do not skip levels:

```
1. Native HTML element  →  <button>, <a>, <input>, <select>, <textarea>
       keyboard behaviour is free, correct, and cross-browser

2. Radix UI / shadcn primitive  →  Dialog, DropdownMenu, Select, Tabs, etc.
       complex ARIA patterns (focus trap, roving tabindex, arrow-key routing)
       are pre-implemented and tested

3. Manual ARIA implementation  →  only for genuinely bespoke patterns
       that Radix does not cover — this should be rare
```

Never implement level 3 when level 1 or 2 applies. The [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/) defines what correct looks like — but implementing those patterns manually in every project is where bugs accumulate. Radix exists specifically to solve this.

**Use semantic HTML — always:**

```tsx
// Wrong — invisible to keyboard and assistive tech
<div onClick={handleClick} className="cursor-pointer">Click me</div>

// Right
<button onClick={handleClick}>Click me</button>
<a href="/path">Navigate</a>
```

Rules:

- `<button>` for actions that don't navigate
- `<a href>` for navigation (including Next.js `<Link>`)
- Native `<input>` / `<select>` / `<textarea>` for form fields — never fake them with `div`
- Heading hierarchy: `h1` → `h2` → `h3` in document order, no level skipping

---

### tabindex — three rules only

| Value           | Rule                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabindex > 0`  | **Never use.** Creates a custom tab order that becomes impossible to maintain and breaks AT navigation. No exceptions.                                                                          |
| `tabindex="0"`  | Use only to make a genuinely non-interactive element focusable when no native element fits. This need is rare — if you're reaching for it, consider whether a native element solves it instead. |
| `tabindex="-1"` | For programmatic focus management only: `ref.current?.focus()` when opening a modal, returning focus to a trigger on close, or moving focus to a validation error summary.                      |

**Roving tabindex** (for composite widgets like toolbars, menus, tab lists, radio groups): only one element in the group has `tabindex="0"` at a time; the rest have `tabindex="-1"`; arrow keys move focus within the group; Tab moves focus out. **Do not implement this manually** — use the Radix primitive that covers your pattern. Radix handles roving tabindex internally.

---

### Radix UI / shadcn widget map

When you need one of these patterns, use the corresponding primitive. Do not build a custom implementation.

| Pattern                    | Radix primitive                    | shadcn component |
| -------------------------- | ---------------------------------- | ---------------- |
| Modal / dialog             | `@radix-ui/react-dialog`           | `Dialog`         |
| Dropdown menu              | `@radix-ui/react-dropdown-menu`    | `DropdownMenu`   |
| Context menu               | `@radix-ui/react-context-menu`     | `ContextMenu`    |
| Select (single)            | `@radix-ui/react-select`           | `Select`         |
| Combobox / command palette | `cmdk`                             | `Command`        |
| Tabs                       | `@radix-ui/react-tabs`             | `Tabs`           |
| Accordion                  | `@radix-ui/react-accordion`        | `Accordion`      |
| Tooltip                    | `@radix-ui/react-tooltip`          | `Tooltip`        |
| Popover                    | `@radix-ui/react-popover`          | `Popover`        |
| Radio group                | `@radix-ui/react-radio-group`      | `RadioGroup`     |
| Checkbox                   | `@radix-ui/react-checkbox`         | `Checkbox`       |
| Toggle / toggle group      | `@radix-ui/react-toggle-group`     | `ToggleGroup`    |
| Alert dialog (confirm)     | `@radix-ui/react-alert-dialog`     | `AlertDialog`    |
| Sheet / drawer             | `@radix-ui/react-dialog` (or Vaul) | `Sheet`          |

If you are building a custom widget not covered above, consult the [APG patterns index](https://www.w3.org/WAI/ARIA/apg/patterns/) for the correct ARIA roles, properties, and keyboard contract before writing any code.

---

### Focus management contract

- **Modal opens** → focus moves into the modal's first focusable element (Radix does this automatically).
- **Modal closes** → focus returns to the element that triggered it (Radix does this automatically).
- **Page mutation** (item added, deleted, filtered) → do not steal focus. Announce the change via `aria-live` instead.
- **Form validation error** → move focus to the error summary or the first invalid field (not an alert dialog).
- **`autofocus`** → only in modals and first-run onboarding flows. Never on page load for general content.

---

### ARIA live regions — for dynamic content

Screen readers won't announce content that changes without a page navigation unless you use a live region.

```tsx
// Status messages, toasts, counts — announce politely (waits for user to finish)
<div aria-live="polite" aria-atomic="true">
  {statusMessage}
</div>

// Critical errors only — interrupts immediately
<div aria-live="assertive" aria-atomic="true">
  {criticalError}
</div>
```

Rules:

- Use `polite` for: toast notifications, form submission results, filter counts updating, background sync status.
- Use `assertive` sparingly — it interrupts whatever the screen reader is currently saying. Reserve for session expiry, critical errors, or security alerts.
- The live region element must be present in the DOM _before_ the content changes — inserting the element and content simultaneously is unreliable.
- `aria-atomic="true"` means the whole region is read together, not piecemeal.

---

### Focus visibility — never suppress without replacement

```tsx
// Bug — removes focus ring with nothing to replace it
className = 'focus:outline-none';

// Correct — removes browser default, provides explicit ring
className = 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';
```

Focus rings must be visible against both light and dark backgrounds. Tab order must follow visual reading order.

---

### ARIA labelling

- Icon-only buttons and links: `<button aria-label="Close dialog">`
- Images: `alt="descriptive text"` (use `alt=""` for purely decorative images — never omit `alt`)
- Don't add `aria-expanded`, `aria-selected`, `aria-haspopup` etc. manually to elements inside a Radix primitive — Radix sets these correctly. Adding them yourself creates conflicts.

---

**Checklist — before marking any UI task complete:**

- [ ] Tab through all interactive elements — every one is reachable and in logical order
- [ ] All interactive elements show a visible focus ring (light and dark mode)
- [ ] All icon-only buttons have `aria-label`
- [ ] All images have `alt` attributes
- [ ] No `tabindex > 0` anywhere
- [ ] Complex widgets (modals, menus, selects, tabs) use a Radix/shadcn primitive
- [ ] Dynamic content updates use `aria-live` regions, not focus-stealing
- [ ] Modal focus trap and return-to-trigger verified manually

---

## 4. Motion and animation

Respect user preferences and avoid disorienting movement. This overlaps with WCAG 2.3.3 (Animation from Interactions).

**Always wrap decorative animation in `motion-safe:`:**

```tsx
// Bad — animates even for users who've requested reduced motion
<div className="animate-pulse">

// Good
<div className="motion-safe:animate-pulse">
```

**No layout-shifting hover effects:**

```tsx
// Bad — hover adds padding, shifting surrounding content
<div className="hover:p-4 transition-all">

// Good — hover changes appearance without affecting layout
<div className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-150">
```

**Transition durations:** `duration-150` or `duration-200` for hover/focus states; `duration-300` maximum for modals, drawers, and panels.

**Checklist — before marking any UI task complete that introduces animation:**

- [ ] All decorative animations use `motion-safe:` variant
- [ ] No `hover:scale-*` or `hover:translate-*`
- [ ] No layout shift on hover/focus
- [ ] Transitions stay within duration limits above

---

## 5. When to apply these checks

| Task type                                   | Mobile | Dark/light | Keyboard | Motion |
| ------------------------------------------- | ------ | ---------- | -------- | ------ |
| New page or route                           | ✓      | ✓          | ✓        | ✓      |
| New component added to a page               | ✓      | ✓          | ✓        | ✓      |
| Colour or styling changes                   |        | ✓          |          |        |
| New interactive element (button, form, etc) |        |            | ✓        |        |
| Layout change                               | ✓      |            |          |        |
| Any animation or transition added           |        |            |          | ✓      |
