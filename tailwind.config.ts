import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette driven by CSS custom properties injected on <html>
        // from the active artist's brand_kit.colours (src/app/layout.tsx).
        // The single source of truth is the DB; these utilities just point
        // at the variables so the kit can change without rebuilding CSS.
        brand: {
          bg: 'var(--brand-bg)',
          'bg-2': 'var(--brand-bg-2)',
          fg: 'var(--brand-fg)',
          'fg-dim': 'var(--brand-fg-dim)',
          'fg-faint': 'var(--brand-fg-faint)',
          accent: 'var(--brand-accent)',
          'accent-2': 'var(--brand-accent-2)',
          rule: 'var(--brand-rule)',
        },
      },
      fontFamily: {
        body: 'var(--brand-font-body)',
        display: 'var(--brand-font-display)',
        mono: 'var(--brand-font-mono)',
      },
    },
  },
  plugins: [],
}

export default config
