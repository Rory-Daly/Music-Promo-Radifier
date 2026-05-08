# Stack Option: ECharts

Run this prompt in a new project to set up Apache ECharts as the charting standard.

**When to use:** dashboard/analytics-forward apps requiring advanced chart types
(Sankey, chord, sunburst, clustering, correlation, treemap, etc.). Desktop-primary use cases
where bundle size is less critical than capability and visual quality.

**What this sets up:**

- `echarts` package installed (tree-shaken imports, no third-party wrapper)
- `src/hooks/use-echarts.ts` — shared React hook for all charts
- `src/lib/echarts-theme.ts` — theme wired to Tailwind CSS variables (dark mode aware)
- `src/components/charts/sankey-chart.tsx` — reference implementation
- `docs/charts.md` — full conventions doc
- `CLAUDE.md` updated with a link to docs/charts.md

---

## Prompt

````
This project uses ECharts for all data visualisation. Set up ECharts according to
the following specification, embedding rules into the correct places in CLAUDE.md,
docs/, and any relevant agent definitions.

## What to do

1. Install the `echarts` package
2. Add a one-line ECharts entry to CLAUDE.md linking to docs/charts.md
3. Create docs/charts.md with the full spec below
4. Create src/hooks/use-echarts.ts — production-quality implementation (spec below)
5. Create src/lib/echarts-theme.ts — starter theme wired to Tailwind CSS variables
6. Create src/components/charts/sankey-chart.tsx — reference implementation using all correct patterns
7. Update .env.example if any chart-related env vars are needed

## ECharts Specification

### Package and imports

Use `echarts` (apache-echarts) directly. Do NOT use `echarts-for-react` or any
third-party wrapper. The custom useECharts hook is the only integration point.

Always import from `echarts/core`, never `import * as echarts from 'echarts'`:

```ts
import * as echarts from 'echarts/core'
import { SankeyChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([SankeyChart, TooltipComponent, GridComponent, CanvasRenderer])
````

Register only the chart types and components actually used in that file.
Use CanvasRenderer by default. Only switch to SVGRenderer for specific reasons
(e.g. server-side export, accessibility requirements).

### All chart components must

- Be `'use client'` components
- Use the shared `useECharts` hook — never call `echarts.init()` directly in a component
- Memoize the option object with `useMemo` — never construct it inline in render
- Accept data as typed props, not raw ECharts option objects (keep ECharts an
  implementation detail, not part of the component's public API)

### useECharts hook (src/hooks/use-echarts.ts)

The hook accepts a ref and an ECharts option object. It must:

- Call `echarts.init(el, theme)` on mount, passing the registered theme name
- Handle resize via `ResizeObserver` (not `window.resize`)
- Call `chart.dispose()` on unmount
- Call `chart.setOption(option, { notMerge: true })` when option changes
- Return the chart instance so callers can call imperative APIs if needed

### Theming (src/lib/echarts-theme.ts)

- Define a single shared ECharts theme object and register it with `echarts.registerTheme()`
- Colours must read Tailwind CSS variables at runtime (`getComputedStyle`) so they
  respond to dark mode automatically — do not hardcode hex values
- The theme is registered once at app startup (import it in the root layout or a
  client boundary component)
- All charts reference the theme by name when calling `echarts.init()`

### Dark mode

Charts must respond to the app's colour scheme. Read CSS variables
(`--background`, `--foreground`, `--muted`, etc.) and pass them into the ECharts
theme rather than hardcoding colours. Re-initialise or update the theme when the
colour scheme changes.

### Performance

- For datasets over 10,000 points, set `large: true` and an appropriate
  `largeThreshold` on the series
- Use ECharts' `dataset` API when multiple series share the same source data
- Do not recompute option objects on every render — always memoize with `useMemo`

### File structure

```
src/
  hooks/
    use-echarts.ts          # shared hook — used by all chart components
  lib/
    echarts-theme.ts        # theme registration
  components/
    charts/                 # one file per chart type
      sankey-chart.tsx
      sunburst-chart.tsx
      chord-chart.tsx
      # etc.
```

### Testing

- Chart components are tested at integration level: renders without throwing,
  displays correct number of series in the option passed to the hook
- Use `vi.mock('echarts/core')` to stub the library in unit tests
- Do not test ECharts internals

### Do not use

Tremor chart components, Recharts, Chart.js, Nivo, or any other charting library.
ECharts is the single charting standard for this project.

```

```
