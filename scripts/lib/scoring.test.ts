import { describe, expect, it } from 'vitest'
import { findTopHooks, type EnergyCurve } from './scoring'

function uniformCurve(samples: number[], resolutionSeconds = 1): EnergyCurve {
  return {
    durationSeconds: samples.length * resolutionSeconds,
    resolutionSeconds,
    samples,
  }
}

describe('findTopHooks', () => {
  // These tests probe the scoring algorithm, not the default duration
  // bounds. They were written for the original 15-30s defaults; the
  // function's defaults have since moved to ~60s reels. Passing the
  // historical bounds keeps the algorithmic assertions sharp.
  const shortDefaults = { minDuration: 15, maxDuration: 30 } as const

  it('prefers the loud section over the quiet section', () => {
    const samples = [
      ...Array<number>(30).fill(0.1),
      ...Array<number>(30).fill(0.9),
      ...Array<number>(30).fill(0.1),
    ]
    const hooks = findTopHooks(uniformCurve(samples), { ...shortDefaults, count: 1 })
    expect(hooks).toHaveLength(1)
    expect(hooks[0].startSeconds).toBeGreaterThanOrEqual(20)
    expect(hooks[0].endSeconds).toBeLessThanOrEqual(70)
    expect(hooks[0].meanEnergy).toBeGreaterThan(0.6)
  })

  it('labels a sharp transition as a drop', () => {
    const samples = [
      ...Array<number>(40).fill(0.1),
      ...Array<number>(40).fill(0.95),
    ]
    const hooks = findTopHooks(uniformCurve(samples), { ...shortDefaults, count: 1 })
    expect(hooks[0].label).toBe('drop')
    expect(hooks[0].contrast).toBeGreaterThan(0.5)
  })

  it('returns non-overlapping candidates', () => {
    const samples = Array.from({ length: 240 }, (_, i) => 0.4 + Math.sin(i * 0.2) * 0.3 + (i % 30 === 0 ? 0.3 : 0))
    const hooks = findTopHooks(uniformCurve(samples), { ...shortDefaults, count: 5 })
    for (let i = 0; i < hooks.length; i++) {
      for (let j = i + 1; j < hooks.length; j++) {
        const a = hooks[i]
        const b = hooks[j]
        const overlapStart = Math.max(a.startSeconds, b.startSeconds)
        const overlapEnd = Math.min(a.endSeconds, b.endSeconds)
        expect(overlapStart).toBeGreaterThanOrEqual(overlapEnd)
      }
    }
  })

  it('penalises hooks that start in the intro', () => {
    const samples = [
      ...Array<number>(30).fill(0.95),
      ...Array<number>(100).fill(0.3),
      ...Array<number>(30).fill(0.95),
      ...Array<number>(80).fill(0.3),
    ]
    const hooks = findTopHooks(uniformCurve(samples), { ...shortDefaults, count: 1 })
    expect(hooks[0].startSeconds).toBeGreaterThan(50)
  })

  it('defaults to ~60s hook bounds for full-length reels', () => {
    const samples = Array<number>(180).fill(0.5)
    const hooks = findTopHooks(uniformCurve(samples), { count: 1 })
    expect(hooks).toHaveLength(1)
    expect(hooks[0].durationSeconds).toBeGreaterThanOrEqual(45)
    expect(hooks[0].durationSeconds).toBeLessThanOrEqual(75)
  })

  it('returns an empty list when the track is shorter than minDuration', () => {
    const samples = Array<number>(10).fill(0.5)
    const hooks = findTopHooks(uniformCurve(samples), { minDuration: 15, count: 3 })
    expect(hooks).toEqual([])
  })

  it('respects the requested count cap', () => {
    const samples = Array.from({ length: 200 }, () => 0.5 + Math.random() * 0.1)
    const hooks = findTopHooks(uniformCurve(samples), { count: 3 })
    expect(hooks.length).toBeLessThanOrEqual(3)
  })

  it('clamps maxDuration to the track length', () => {
    const samples = Array<number>(20).fill(0.6)
    const hooks = findTopHooks(uniformCurve(samples), { minDuration: 15, maxDuration: 60, count: 1 })
    expect(hooks).toHaveLength(1)
    expect(hooks[0].durationSeconds).toBeLessThanOrEqual(20)
  })
})
