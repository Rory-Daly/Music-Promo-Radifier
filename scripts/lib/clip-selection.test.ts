import { describe, expect, it } from 'vitest'
import { mulberry32, selectClips, type ClipCandidate } from './clip-selection'

function makeCandidates(durations: number[]): ClipCandidate[] {
  return durations.map((d, i) => ({ path: `/clip-${i}.mp4`, durationSeconds: d }))
}

describe('selectClips', () => {
  it('picks one clip per slot when enough candidates exist', () => {
    const candidates = makeCandidates([60, 60, 60])
    const result = selectClips(candidates, {
      outputDurationsSeconds: [5, 6, 7],
      random: mulberry32(42),
    })
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.outputDurationSeconds)).toEqual([5, 6, 7])
  })

  it('respects per-slot duration in slowmo mode (slot * slowmo source needed)', () => {
    const candidates = makeCandidates([10, 10])
    const result = selectClips(candidates, {
      outputDurationsSeconds: [8, 8],
      slowmo: 0.5,
      random: mulberry32(1),
    })
    expect(result).toHaveLength(2)
    for (const r of result) {
      expect(r.outputDurationSeconds).toBe(8)
      expect(r.sourceStartSeconds).toBeGreaterThanOrEqual(0)
      expect(r.sourceStartSeconds + 8 * 0.5).toBeLessThanOrEqual(10)
    }
  })

  it('throws when no clip is long enough for a slot', () => {
    const candidates = makeCandidates([3, 4])
    expect(() =>
      selectClips(candidates, { outputDurationsSeconds: [10], random: mulberry32(0) }),
    ).toThrow(/No clip is long enough/)
  })

  it('reuses clips when there are more slots than candidates', () => {
    const candidates = makeCandidates([60])
    const result = selectClips(candidates, {
      outputDurationsSeconds: [5, 5, 5],
      random: mulberry32(7),
    })
    expect(result).toHaveLength(3)
    expect(new Set(result.map((r) => r.path))).toEqual(new Set(['/clip-0.mp4']))
  })

  it('without reuse, throws when not enough unique clips', () => {
    const candidates = makeCandidates([60, 60])
    expect(() =>
      selectClips(candidates, {
        outputDurationsSeconds: [5, 5, 5],
        random: mulberry32(3),
        reuseAllowed: false,
      }),
    ).toThrow(/No clip is long enough/)
  })

  it('is deterministic with a seeded RNG', () => {
    const candidates = makeCandidates([60, 60, 60, 60])
    const opts = { outputDurationsSeconds: [5, 5, 5] }
    const a = selectClips(candidates, { ...opts, random: mulberry32(99) })
    const b = selectClips(candidates, { ...opts, random: mulberry32(99) })
    expect(a).toEqual(b)
  })

  it('samples a different start point per slot when headroom exists', () => {
    const candidates = makeCandidates([60, 60, 60])
    const result = selectClips(candidates, {
      outputDurationsSeconds: [5, 5, 5],
      random: mulberry32(123),
    })
    const starts = result.map((r) => r.sourceStartSeconds)
    expect(new Set(starts).size).toBeGreaterThanOrEqual(2)
  })
})

describe('mulberry32', () => {
  it('produces deterministic sequences', () => {
    const r1 = mulberry32(42)
    const r2 = mulberry32(42)
    for (let i = 0; i < 5; i++) {
      expect(r1()).toBe(r2())
    }
  })

  it('produces values in [0, 1)', () => {
    const r = mulberry32(1)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
