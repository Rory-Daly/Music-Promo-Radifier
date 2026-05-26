import { describe, expect, it } from 'vitest'
import { parseSoundCloudUrl, soundCloudPlayerUrl } from './soundcloud'

describe('parseSoundCloudUrl', () => {
  it('accepts a canonical track URL', () => {
    const r = parseSoundCloudUrl('https://soundcloud.com/illutible/playing-for-keeps')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.canonicalUrl).toBe('https://soundcloud.com/illutible/playing-for-keeps')
  })

  it('accepts www. and strips tracking params', () => {
    const r = parseSoundCloudUrl('https://www.soundcloud.com/illutible/playing-for-keeps?utm_source=ig')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.canonicalUrl).toBe('https://soundcloud.com/illutible/playing-for-keeps')
  })

  it('accepts m. (mobile) URLs', () => {
    const r = parseSoundCloudUrl('https://m.soundcloud.com/illutible/playing-for-keeps')
    expect(r.ok).toBe(true)
  })

  it('rejects empty input', () => {
    const r = parseSoundCloudUrl('   ')
    expect(r.ok).toBe(false)
  })

  it('rejects non-URLs', () => {
    const r = parseSoundCloudUrl('illutible/playing-for-keeps')
    expect(r.ok).toBe(false)
  })

  it('rejects non-SoundCloud hosts', () => {
    const r = parseSoundCloudUrl('https://spotify.com/track/123')
    expect(r.ok).toBe(false)
  })

  it('rejects artist-only URLs', () => {
    const r = parseSoundCloudUrl('https://soundcloud.com/illutible')
    expect(r.ok).toBe(false)
  })

  it('rejects sets URLs', () => {
    const r = parseSoundCloudUrl('https://soundcloud.com/sets/illutible-album')
    expect(r.ok).toBe(false)
  })
})

describe('soundCloudPlayerUrl', () => {
  it('builds a widget URL with the brand accent', () => {
    const url = soundCloudPlayerUrl('https://soundcloud.com/illutible/playing-for-keeps')
    expect(url).toContain('w.soundcloud.com/player/')
    expect(url).toContain('color=%23c9a06b')
    expect(url).toContain('url=https%3A%2F%2Fsoundcloud.com%2Fillutible%2Fplaying-for-keeps')
  })
})
