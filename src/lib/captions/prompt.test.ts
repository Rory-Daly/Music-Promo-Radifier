import { describe, expect, it } from 'vitest'
import { defaultBrandKit } from '@/lib/brand-kit/defaults'
import type { CaptionPreset } from '@/lib/brand-kit/schema'
import {
  buildSystemPrompt,
  buildUserMessage,
  pickPresetForPlatform,
  type CaptionRequestBlock,
} from './prompt'

describe('buildSystemPrompt', () => {
  it('includes the artist name from logo.text_fallback', () => {
    const kit = { ...defaultBrandKit, logo: { ...defaultBrandKit.logo, text_fallback: 'illutible' } }
    const prompt = buildSystemPrompt(kit, ['ig_reel'])
    expect(prompt).toContain('"illutible"')
  })

  it('includes per-platform guidance for each requested platform', () => {
    const prompt = buildSystemPrompt(defaultBrandKit, ['x', 'tiktok'])
    expect(prompt).toContain('x:')
    expect(prompt).toContain('tiktok:')
    expect(prompt).not.toContain('ig_reel:')
  })

  it('lists voice exemplars verbatim when present', () => {
    const kit = {
      ...defaultBrandKit,
      voice: { ...defaultBrandKit.voice, exemplars: ["Sometimes it's nice to feel sad."] },
    }
    const prompt = buildSystemPrompt(kit, ['ig_reel'])
    expect(prompt).toContain("Sometimes it's nice to feel sad.")
  })
})

describe('pickPresetForPlatform', () => {
  const presets = [
    { id: 'tease', label: 'Tease', platforms: ['ig_reel', 'tiktok'], template: 'T' },
    { id: 'drop_day', label: 'Drop', platforms: ['ig_reel', 'x'], template: 'D' },
  ] as CaptionPreset[]

  it('honours explicit presetId when valid', () => {
    const r = pickPresetForPlatform([...presets], 'ig_reel', 'drop_day')
    expect(r?.id).toBe('drop_day')
  })

  it('falls back to first matching preset when presetId is unknown', () => {
    const r = pickPresetForPlatform([...presets], 'tiktok', 'nonexistent')
    expect(r?.id).toBe('tease')
  })

  it('falls back to first preset when no platform matches', () => {
    const r = pickPresetForPlatform([...presets], 'fb', null)
    expect(r?.id).toBe('tease')
  })

  it('returns null on empty preset list', () => {
    expect(pickPresetForPlatform([], 'ig_reel', null)).toBeNull()
  })
})

describe('buildUserMessage', () => {
  it('includes track title and one block per platform', () => {
    const blocks: CaptionRequestBlock[] = [
      {
        platform: 'ig_reel',
        presetLabel: 'Tease',
        baseTemplate: 'Lighthouse. Coming May 28.',
        smartLink: 'https://legatograph.app/r/illutible/lighthouse',
        hashtags: ['#cinematic', '#downtempo'],
        hashtagsString: '#cinematic #downtempo',
      },
    ]
    const msg = buildUserMessage(blocks, {
      trackTitle: 'Lighthouse',
      releaseDate: 'May 28',
      tagline: 'cinematic downtempo',
      locationOrMood: null,
    })
    expect(msg).toContain('Lighthouse')
    expect(msg).toContain('### ig_reel (Tease)')
    expect(msg).toContain('https://legatograph.app/r/illutible/lighthouse')
    expect(msg).toContain('#cinematic #downtempo')
  })
})
