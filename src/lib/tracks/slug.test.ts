import { describe, expect, it } from 'vitest'
import { slugifyTitle } from './slug'

describe('slugifyTitle', () => {
  it('lowercases', () => {
    expect(slugifyTitle('LightHouse')).toBe('lighthouse')
  })

  it('collapses non-alphanumerics into single hyphens', () => {
    expect(slugifyTitle("Sometimes it's nice")).toBe('sometimes-it-s-nice')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugifyTitle('-trim me-')).toBe('trim-me')
  })

  it('caps length', () => {
    const long = 'a'.repeat(120)
    expect(slugifyTitle(long).length).toBeLessThanOrEqual(60)
  })

  it('falls back to "track" for empty or symbol-only input', () => {
    expect(slugifyTitle('')).toBe('track')
    expect(slugifyTitle('!!!')).toBe('track')
  })

  it('handles accented characters', () => {
    expect(slugifyTitle('Café Noir')).toBe('cafe-noir')
  })
})
