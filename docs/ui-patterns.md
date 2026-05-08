# UI Patterns Registry

**Before building any new UI, check this file first.** If a pattern exists, reuse it. If you build something new that could be reused, add it here.

## Registered Patterns

| Pattern                                                     | Component(s) | Keywords |
| ----------------------------------------------------------- | ------------ | -------- |
| _(none yet — add entries as you build reusable components)_ |              |          |

## Before you build — mandatory search process

Before writing any new component, complete all three steps:

1. **Check this registry** — scan the table above for anything matching your use case (use the Keywords column liberally).
2. **Glob the component tree** — run `Glob src/components/**/*.tsx` and scan file names for anything similar. Similarity in name = read that file before proceeding.
3. **Grep for the concept** — search for the core noun (e.g. `grep -r "ActionItem"` or `grep -r "Lightbox"` in `src/components/`).

If you find an existing component that's close but not identical: **add a prop, don't fork.** Read the component, understand its interface, and extend it.

**When you do create something new**, add a one-line note in your task summary: _"Created X — no existing component matched because Y."_ This keeps the decision visible and auditable.

## Rules

1. **No new component without the 3-step search above** — this is a gate, not a suggestion.
2. **Update this registry** when you add a genuinely reusable pattern.
3. **No silent divergence** — if a component is used in two places, they share one source file. Never copy-paste to make a "slightly different version".
4. **Variant props over duplication** — if you need a minor variant, add an optional prop. Only create a new component if the variants are fundamentally incompatible (different data shape, different interaction model).

---

## Charts & Data Visualisation

### Library choice

Before installing a chart library, check if one is already in `package.json`. If not, choose one and record it here — the whole project uses one charting library.

Recommended default: **Recharts** (React-native, composable, good TypeScript support, accessible). Alternatives: Nivo (more chart types), Victory (good for mobile), Observable Plot (statistical/exploratory).

### Mandatory patterns

**Loading state:** Every chart has a skeleton while data fetches. Use a grey rounded rectangle matching the chart's approximate dimensions — not a generic spinner.

```tsx
// Always wrap charts in a Suspense boundary or show skeleton during loading
{
  isLoading ? <ChartSkeleton className="h-64 w-full" /> : <ActualChart data={data} />;
}
```

**Empty state:** Every chart handles `data.length === 0` explicitly — show a meaningful message, not a blank area.

**Responsive sizing:** Charts must be wrapped in a container that constrains width. Never use fixed pixel widths. Use `ResponsiveContainer` (Recharts) or equivalent.

```tsx
<ResponsiveContainer width="100%" height={300}>
  <LineChart data={data}>...</LineChart>
</ResponsiveContainer>
```

**Colour palette:** Use semantic colour variables, not hardcoded hex values. This ensures charts respect dark mode. Define your palette in one place (e.g. `src/lib/chart-colors.ts`) and import it everywhere.

### Accessibility

- Every chart must have an accessible title via `aria-label` on the container
- Colour alone must not be the only differentiator between series — use dashed lines, different shapes, or labels
- Tooltips must be keyboard-accessible (Recharts supports this natively)
- For critical data, provide a `<table>` fallback or a "View data" toggle for screen reader users

### Performance

- Aggregate data in the server/database layer — never send thousands of raw rows to the client for the chart to aggregate
- Memoize chart data transformations with `useMemo` if the data shape needs client-side reshaping
- For large datasets (>500 points), consider downsampling or windowing before rendering

---

## Design Tokens

Use these exact size and spacing tokens. Do not invent ad-hoc combinations — if a new canonical size is needed, add it here first.

### Button sizes

Always use one of these three sizes. Never style a button with arbitrary classes that fall outside these tiers.

| Size | Use case                                             | Tailwind classes                               |
| ---- | ---------------------------------------------------- | ---------------------------------------------- |
| `sm` | Incidental actions within content (tag, inline edit) | `h-7 px-2.5 text-xs rounded font-medium`       |
| `md` | Standard form controls and secondary actions         | `h-9 px-4 text-sm rounded-md font-medium`      |
| `lg` | Primary form submit / prominent CTAs                 | `h-11 px-6 text-base rounded-lg font-semibold` |

A **link button** is a `sm` variant: same font size and weight, `bg-transparent`, `underline` on hover, no padding background.

### Heading scale

| Level | Tailwind classes                    |
| ----- | ----------------------------------- |
| `h1`  | `text-2xl font-bold tracking-tight` |
| `h2`  | `text-xl font-semibold`             |
| `h3`  | `text-base font-semibold`           |
| `h4`  | `text-sm font-semibold`             |

Never use arbitrary combinations like `text-lg font-bold` for headings — pick the nearest level and use it.

### Spacing rhythm

Use multiples of 4 (`p-1`=4px, `p-2`=8px, `p-4`=16px, `p-6`=24px, `p-8`=32px). Avoid arbitrary values (`px-[18px]`) unless there is a hard constraint (e.g. matching an external component's border).

### Modal and drawer widths

| Type                | Max width                  |
| ------------------- | -------------------------- |
| Confirmation        | `max-w-sm` (384px)         |
| Standard form       | `max-w-md` (448px)         |
| Complex form        | `max-w-lg` (512px)         |
| Wide / data         | `max-w-2xl` (672px)        |
| Full-screen overlay | `max-w-full` + safe insets |
