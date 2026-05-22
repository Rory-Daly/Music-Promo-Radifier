import { z } from 'zod'

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, 'Must be a hex colour like #0e0c0a or #ece6dc9e')

const fontSlot = z.object({
  family: z.string().min(1),
  google_font: z.string().min(1).nullable(),
  weights: z.array(z.number().int().min(100).max(900)).min(1),
})

const dsp = z.object({
  platform: z.enum([
    'spotify',
    'apple',
    'youtube',
    'bandcamp',
    'soundcloud',
    'tidal',
    'deezer',
  ]),
  handle: z.string(),
  url: z.string().url().or(z.literal('')),
})

const captionPreset = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  platforms: z.array(
    z.enum(['ig_reel', 'ig_story', 'ig_feed', 'tiktok', 'yt_short', 'x', 'threads', 'fb']),
  ),
  template: z.string().min(1),
})

export const brandKitSchema = z.object({
  version: z.literal(1),
  tagline: z.string().nullable(),
  location: z.string().nullable(),

  colours: z.object({
    bg: hex,
    bg_2: hex,
    fg: hex,
    fg_dim: hex,
    fg_faint: hex,
    accent: hex,
    accent_2: hex,
    rule: hex,
  }),

  fonts: z.object({
    body: fontSlot,
    display: fontSlot,
    mono: fontSlot,
  }),

  logo: z.object({
    wordmark_asset_id: z.string().uuid().nullable(),
    wordmark_storage_path: z.string().nullable(),
    casing: z.enum(['lowercase', 'uppercase', 'titlecase', 'as-is']),
    text_fallback: z.string().min(1),
  }),

  smart_link: z.object({
    template: z.string().min(1),
    dsps: z.array(dsp),
  }),

  voice: z.object({
    register: z.enum(['evocative', 'hype', 'conversational', 'technical']),
    exemplars: z.array(z.string()),
    avoid: z.array(z.string()),
    max_chars_per_platform: z.record(z.string(), z.number().int().positive()),
  }),

  caption_presets: z.array(captionPreset),

  hashtag_presets: z.object({
    default: z.array(z.string()),
    by_platform: z.record(z.string(), z.array(z.string())).default({}),
  }),
})

export type BrandKit = z.infer<typeof brandKitSchema>
export type BrandColours = BrandKit['colours']
export type BrandFontSlot = z.infer<typeof fontSlot>
export type CaptionPreset = z.infer<typeof captionPreset>
export type Dsp = z.infer<typeof dsp>
