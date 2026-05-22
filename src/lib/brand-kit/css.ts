import type { BrandColours, BrandKit } from './schema'

/**
 * Convert a brand kit's colours into a CSS-variables object suitable for
 * spreading into a React `style` prop. Keys use the `--brand-*` namespace
 * so they don't collide with Tailwind's own variables.
 *
 * Usage:
 *   <html style={brandColourVars(kit.colours)}>
 */
export function brandColourVars(colours: BrandColours): Record<string, string> {
  return {
    '--brand-bg': colours.bg,
    '--brand-bg-2': colours.bg_2,
    '--brand-fg': colours.fg,
    '--brand-fg-dim': colours.fg_dim,
    '--brand-fg-faint': colours.fg_faint,
    '--brand-accent': colours.accent,
    '--brand-accent-2': colours.accent_2,
    '--brand-rule': colours.rule,
  }
}

/**
 * CSS vars for the whole kit (colours + casing). Fonts are wired separately
 * via next/font in the layout so they can be subset and preloaded at build
 * time — they don't appear here.
 */
export function brandStyleVars(kit: BrandKit): Record<string, string> {
  return {
    ...brandColourVars(kit.colours),
  }
}
