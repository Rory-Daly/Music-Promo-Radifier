import { describe, expect, it } from 'vitest'
import { getPostPulseMapping, isPostPulseSupported } from './platform-map'

describe('platform-map', () => {
  it('routes Instagram variants to INSTAGRAM with distinct publicationType', () => {
    expect(getPostPulseMapping('ig_reel').buildPlatformSettings()).toEqual({
      type: 'INSTAGRAM',
      publicationType: 'REELS',
    })
    expect(getPostPulseMapping('ig_story').buildPlatformSettings()).toEqual({
      type: 'INSTAGRAM',
      publicationType: 'STORY',
    })
    expect(getPostPulseMapping('ig_feed').buildPlatformSettings()).toEqual({
      type: 'INSTAGRAM',
      publicationType: 'FEED',
    })
  })

  it('uses TIK_TOK (underscored) and TWITTER, not TIKTOK/X', () => {
    expect(getPostPulseMapping('tiktok').buildPlatformSettings().type).toBe('TIK_TOK')
    expect(getPostPulseMapping('x').buildPlatformSettings().type).toBe('TWITTER')
  })

  it('flags yt_short as not supported through Post-Pulse', () => {
    expect(isPostPulseSupported('yt_short')).toBe(false)
    expect(() => getPostPulseMapping('yt_short').buildPlatformSettings()).toThrow(
      /native YouTube/i,
    )
  })

  it('reports every other platform as supported', () => {
    for (const p of ['ig_reel', 'ig_story', 'ig_feed', 'tiktok', 'x', 'threads', 'fb'] as const) {
      expect(isPostPulseSupported(p)).toBe(true)
    }
  })
})
