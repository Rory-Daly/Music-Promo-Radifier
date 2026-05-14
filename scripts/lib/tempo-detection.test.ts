import { describe, expect, it } from 'vitest'
import { detectTempoFromOdf } from './tempo-detection'

function makeBeatOdf(bpm: number, durationSeconds: number, resolutionSeconds: number): number[] {
  const beatPeriod = 60 / bpm
  const totalSamples = Math.floor(durationSeconds / resolutionSeconds)
  const odf = new Array<number>(totalSamples).fill(0)
  for (let t = 0; t < durationSeconds; t += beatPeriod) {
    const idx = Math.floor(t / resolutionSeconds)
    if (idx < totalSamples) odf[idx] = 1
  }
  return odf
}

describe('detectTempoFromOdf', () => {
  it('recovers a clean 120 BPM signal', () => {
    const odf = makeBeatOdf(120, 20, 0.005)
    const result = detectTempoFromOdf(odf, 0.005, { minBpm: 70, maxBpm: 200, beatsPerBar: 4 })
    expect(result.bpm).toBeGreaterThan(115)
    expect(result.bpm).toBeLessThan(125)
  })

  it('recovers a 113 BPM signal (Breathing bees territory)', () => {
    const odf = makeBeatOdf(113, 20, 0.005)
    const result = detectTempoFromOdf(odf, 0.005, { minBpm: 70, maxBpm: 200, beatsPerBar: 4 })
    expect(result.bpm).toBeGreaterThan(110)
    expect(result.bpm).toBeLessThan(116)
  })

  it('reports alternates at double and half tempo', () => {
    const odf = makeBeatOdf(120, 20, 0.005)
    const result = detectTempoFromOdf(odf, 0.005, { minBpm: 50, maxBpm: 250, beatsPerBar: 4 })
    expect(result.bpmAlternates.length).toBeGreaterThan(0)
  })

  it('detects downbeat offset for an offset signal', () => {
    const baseOdf = makeBeatOdf(120, 20, 0.005)
    const shifted = new Array<number>(baseOdf.length).fill(0)
    const shiftSamples = Math.floor(0.15 / 0.005)
    for (let i = 0; i < baseOdf.length; i++) {
      const src = i + shiftSamples
      if (src < baseOdf.length) shifted[i] = baseOdf[src]
    }
    // Make every 4th beat (downbeats) twice as strong so detection picks them
    const beatPeriod = 60 / 120
    const beatSamples = Math.floor(beatPeriod / 0.005)
    for (let i = 0; i < shifted.length; i += beatSamples * 4) {
      if (i < shifted.length) shifted[i] = 2
    }
    const result = detectTempoFromOdf(shifted, 0.005, { minBpm: 70, maxBpm: 200, beatsPerBar: 4 })
    expect(result.downbeatOffsetSeconds).toBeLessThan(0.1)
  })

  it('throws on audio shorter than minimum lag', () => {
    const odf = new Array<number>(20).fill(0)
    expect(() => detectTempoFromOdf(odf, 0.005, { minBpm: 70, maxBpm: 200, beatsPerBar: 4 })).toThrow()
  })
})
