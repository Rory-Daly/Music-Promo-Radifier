import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSITION,
  isTransition,
  planTransition,
  TRANSITIONS,
} from './transitions'

describe('planTransition', () => {
  it('cut has zero duration and no overlap', () => {
    const p = planTransition('cut')
    expect(p).toEqual({ type: 'cut', durationSeconds: 0, overlapping: false })
  })

  it('crossfade overlaps neighbouring clips', () => {
    const p = planTransition('crossfade')
    expect(p.overlapping).toBe(true)
    expect(p.durationSeconds).toBeGreaterThan(0)
  })

  it('fade-black does not overlap (each clip fades independently)', () => {
    const p = planTransition('fade-black')
    expect(p.overlapping).toBe(false)
    expect(p.durationSeconds).toBeGreaterThan(0)
  })

  it('default is "cut"', () => {
    expect(DEFAULT_TRANSITION).toBe('cut')
  })

  it('all listed transitions plan without throwing', () => {
    for (const t of TRANSITIONS) {
      expect(() => planTransition(t)).not.toThrow()
    }
  })
})

describe('isTransition', () => {
  it('accepts registered values', () => {
    for (const t of TRANSITIONS) expect(isTransition(t)).toBe(true)
  })

  it('rejects junk', () => {
    expect(isTransition('')).toBe(false)
    expect(isTransition('dissolve')).toBe(false)
    expect(isTransition(undefined)).toBe(false)
    expect(isTransition(42)).toBe(false)
  })
})
