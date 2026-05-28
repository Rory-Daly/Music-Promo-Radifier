import { describe, expect, it } from 'vitest'
import { composeShortsMetadata } from './upload'

describe('composeShortsMetadata', () => {
  it('uses the first non-empty caption line as the title', () => {
    const r = composeShortsMetadata({
      caption: '\n\nLighthouse.\n\nEverywhere now → https://x',
      hashtags: ['#downtempo'],
      trackTitle: 'Lighthouse',
      artistName: 'illutible',
    })
    expect(r.title).toBe('Lighthouse.')
  })

  it('falls back to track title when caption is empty', () => {
    const r = composeShortsMetadata({
      caption: '',
      hashtags: [],
      trackTitle: 'Lighthouse',
      artistName: 'illutible',
    })
    expect(r.title).toBe('Lighthouse')
  })

  it('truncates long titles with an ellipsis', () => {
    const long = 'a'.repeat(120)
    const r = composeShortsMetadata({
      caption: long,
      hashtags: [],
      trackTitle: null,
      artistName: 'illutible',
    })
    expect(r.title.length).toBeLessThanOrEqual(80)
    expect(r.title.endsWith('…')).toBe(true)
  })

  it('appends #Shorts when missing from caption', () => {
    const r = composeShortsMetadata({
      caption: 'Lighthouse.',
      hashtags: ['#downtempo'],
      trackTitle: 'Lighthouse',
      artistName: 'illutible',
    })
    expect(r.description).toContain('#Shorts')
  })

  it('does not duplicate #Shorts when caption already has it', () => {
    const r = composeShortsMetadata({
      caption: 'Lighthouse. #Shorts',
      hashtags: [],
      trackTitle: 'Lighthouse',
      artistName: 'illutible',
    })
    expect(r.description.match(/#Shorts/gi)?.length ?? 0).toBe(1)
  })

  it('strips leading # from tags (YouTube tags field rejects them)', () => {
    const r = composeShortsMetadata({
      caption: 'Lighthouse.',
      hashtags: ['#downtempo', '#cinematic'],
      trackTitle: 'Lighthouse',
      artistName: 'illutible',
    })
    expect(r.tags).toEqual(['downtempo', 'cinematic'])
  })

  it('dedupes hashtags between caption and hashtag list', () => {
    const r = composeShortsMetadata({
      caption: 'Lighthouse. #cinematic',
      hashtags: ['#cinematic', '#downtempo'],
      trackTitle: 'Lighthouse',
      artistName: 'illutible',
    })
    const matches = r.description.match(/#cinematic/gi) ?? []
    expect(matches.length).toBe(1)
  })
})
