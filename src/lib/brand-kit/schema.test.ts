import { describe, expect, it } from 'vitest'
import { defaultBrandKit } from './defaults'
import { brandKitSchema } from './schema'

describe('brandKitSchema', () => {
  it('accepts the default kit', () => {
    const result = brandKitSchema.safeParse(defaultBrandKit)
    expect(result.success).toBe(true)
  })

  it('accepts hex with alpha channel', () => {
    const kit = {
      ...defaultBrandKit,
      colours: { ...defaultBrandKit.colours, rule: '#ece6dc24' },
    }
    expect(brandKitSchema.safeParse(kit).success).toBe(true)
  })

  it('rejects non-hex colours', () => {
    const kit = {
      ...defaultBrandKit,
      colours: { ...defaultBrandKit.colours, bg: 'black' },
    }
    expect(brandKitSchema.safeParse(kit).success).toBe(false)
  })

  it('rejects unknown DSP platforms', () => {
    const kit = {
      ...defaultBrandKit,
      smart_link: {
        ...defaultBrandKit.smart_link,
        dsps: [{ platform: 'myspace', handle: '@x', url: 'https://x.com' }],
      },
    }
    expect(brandKitSchema.safeParse(kit).success).toBe(false)
  })

  it('accepts empty DSP url (placeholder for unfilled)', () => {
    const kit = {
      ...defaultBrandKit,
      smart_link: {
        ...defaultBrandKit.smart_link,
        dsps: [{ platform: 'spotify' as const, handle: '@x', url: '' }],
      },
    }
    expect(brandKitSchema.safeParse(kit).success).toBe(true)
  })
})
