import { describe, expect, it } from 'vitest'
import { formatReleaseDate, substituteCaptionTokens } from './tokens'

describe('substituteCaptionTokens', () => {
  it('replaces all known tokens', () => {
    const tpl = '{track_title}. Coming {release_date}.\n\n{smart_link}\n\n{hashtags}'
    const result = substituteCaptionTokens(tpl, {
      track_title: 'Lighthouse',
      release_date: 'May 28',
      smart_link: 'https://legatograph.app/r/illutible/lighthouse',
      hashtags: '#cinematic #downtempo',
    })
    expect(result).toBe(
      'Lighthouse. Coming May 28.\n\nhttps://legatograph.app/r/illutible/lighthouse\n\n#cinematic #downtempo',
    )
  })

  it('leaves unsupplied tokens as placeholders so callers can spot gaps', () => {
    const tpl = '{track_title} · {smart_link}'
    const result = substituteCaptionTokens(tpl, { track_title: 'Lighthouse' })
    expect(result).toBe('Lighthouse · {smart_link}')
  })

  it('falls back to "soon" for release_date when not supplied', () => {
    const tpl = 'Out {release_date}'
    expect(substituteCaptionTokens(tpl, {})).toBe('Out soon')
  })

  it('collapses runs of blank lines left by empty optional tokens', () => {
    const tpl = '{track_title}\n\n{location_or_mood}\n\n{smart_link}'
    const result = substituteCaptionTokens(tpl, {
      track_title: 'Lighthouse',
      smart_link: 'https://x.com',
    })
    expect(result).toBe('Lighthouse\n\nhttps://x.com')
  })
})

describe('formatReleaseDate', () => {
  it('returns "soon" for null', () => {
    expect(formatReleaseDate(null)).toBe('soon')
  })

  it('returns "soon" for unparseable input', () => {
    expect(formatReleaseDate('not-a-date')).toBe('soon')
  })

  it('formats a same-year date without the year (en-AU: day first)', () => {
    const thisYear = new Date().getUTCFullYear()
    const formatted = formatReleaseDate(`${thisYear}-05-28`)
    expect(formatted).toBe('28 May')
  })

  it('includes the year for cross-year dates', () => {
    const otherYear = new Date().getUTCFullYear() + 1
    const formatted = formatReleaseDate(`${otherYear}-05-28`)
    expect(formatted).toBe(`28 May ${otherYear}`)
  })
})
