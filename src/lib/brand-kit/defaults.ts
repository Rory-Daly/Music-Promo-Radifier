import type { BrandKit } from './schema'

/**
 * Fallback brand kit used when an artist row has no brand_kit yet, or when
 * the stored JSON fails schema validation. Mirrors the illutible seed so
 * the app degrades to a visually consistent default rather than blank.
 */
export const defaultBrandKit: BrandKit = {
  version: 1,
  tagline: null,
  location: null,
  colours: {
    bg: '#0e0c0a',
    bg_2: '#16120e',
    fg: '#ece6dc',
    fg_dim: '#ece6dc9e',
    fg_faint: '#ece6dc4d',
    accent: '#c9a06b',
    accent_2: '#8a3a2a',
    rule: '#ece6dc24',
  },
  fonts: {
    body: { family: 'DM Sans', google_font: 'DM Sans', weights: [400, 500, 700] },
    display: { family: 'Special Elite', google_font: 'Special Elite', weights: [400] },
    mono: { family: 'JetBrains Mono', google_font: 'JetBrains Mono', weights: [400, 500] },
  },
  logo: {
    wordmark_asset_id: null,
    wordmark_storage_path: null,
    casing: 'lowercase',
    text_fallback: 'Legatograph',
  },
  smart_link: {
    template: 'https://legatograph.app/r/{artist}/{slug}',
    dsps: [],
  },
  voice: {
    register: 'evocative',
    exemplars: [],
    avoid: [],
    max_chars_per_platform: {
      x: 280,
      threads: 500,
      ig: 2200,
      tiktok: 2200,
      yt_short: 5000,
    },
  },
  caption_presets: [],
  hashtag_presets: {
    default: [],
    by_platform: {},
  },
}
