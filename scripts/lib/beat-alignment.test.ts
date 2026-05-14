import { describe, expect, it } from 'vitest'
import { planBeatAlignedCuts } from './beat-alignment'

describe('planBeatAlignedCuts', () => {
  it('places cuts on bar boundaries for 90 BPM, 20s hook, 3 clips', () => {
    const result = planBeatAlignedCuts({ durationSeconds: 20, bpm: 90, numClips: 3 })
    expect(result.barDurationSeconds).toBeCloseTo(2.6667, 3)
    expect(result.cutSeconds).toHaveLength(2)
    for (const c of result.cutSeconds) {
      const remainder = c % result.barDurationSeconds
      const aligned = Math.min(remainder, result.barDurationSeconds - remainder) < 1e-3
      expect(aligned).toBe(true)
    }
    const total = result.clipDurationsSeconds.reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(20, 5)
  })

  it('returns a single-clip plan when numClips=1', () => {
    const result = planBeatAlignedCuts({ durationSeconds: 15, bpm: 120, numClips: 1 })
    expect(result.cutSeconds).toEqual([])
    expect(result.clipDurationsSeconds).toEqual([15])
  })

  it('snaps each cut to a distinct downbeat (no duplicates)', () => {
    const result = planBeatAlignedCuts({ durationSeconds: 20, bpm: 90, numClips: 4 })
    const unique = new Set(result.cutSeconds)
    expect(unique.size).toBe(result.cutSeconds.length)
  })

  it('honours a downbeat offset', () => {
    const result = planBeatAlignedCuts({
      durationSeconds: 20,
      bpm: 90,
      numClips: 3,
      downbeatOffsetSeconds: 0.5,
    })
    const bar = result.barDurationSeconds
    for (const c of result.cutSeconds) {
      const shifted = c - 0.5
      const remainder = shifted % bar
      const aligned = Math.min(remainder, bar - remainder) < 1e-3
      expect(aligned).toBe(true)
    }
  })

  it('supports non-4/4 time signatures via beatsPerBar', () => {
    const fourFour = planBeatAlignedCuts({ durationSeconds: 20, bpm: 120, numClips: 3 })
    const threeFour = planBeatAlignedCuts({ durationSeconds: 20, bpm: 120, beatsPerBar: 3, numClips: 3 })
    expect(fourFour.barDurationSeconds).toBeCloseTo(2, 5)
    expect(threeFour.barDurationSeconds).toBeCloseTo(1.5, 5)
  })

  it('clip durations always sum to hook duration', () => {
    for (const bpm of [85, 90, 100, 120, 140]) {
      for (const numClips of [2, 3, 4, 5]) {
        const result = planBeatAlignedCuts({ durationSeconds: 20, bpm, numClips })
        const total = result.clipDurationsSeconds.reduce((a, b) => a + b, 0)
        expect(total).toBeCloseTo(20, 5)
      }
    }
  })
})
