import { describe, expect, it } from 'vitest'
import { analysisToEnergyCurve, extractTrackId, type SpotifyAudioAnalysis } from './spotify'

describe('extractTrackId', () => {
  it('returns a raw 22-char ID unchanged', () => {
    expect(extractTrackId('4iV5W9uYEdYUVa79Axb7Rh')).toBe('4iV5W9uYEdYUVa79Axb7Rh')
  })

  it('extracts the ID from an open.spotify.com URL', () => {
    expect(extractTrackId('https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=abc')).toBe(
      '4iV5W9uYEdYUVa79Axb7Rh',
    )
  })

  it('extracts the ID from a spotify: URI', () => {
    expect(extractTrackId('spotify:track:4iV5W9uYEdYUVa79Axb7Rh')).toBe('4iV5W9uYEdYUVa79Axb7Rh')
  })

  it('throws on garbage input', () => {
    expect(() => extractTrackId('not-a-track')).toThrow(/Could not extract/)
  })
})

describe('analysisToEnergyCurve', () => {
  const baseAnalysis: SpotifyAudioAnalysis = {
    track: { duration: 10, tempo: 120, loudness: -10, key: 0, mode: 1 },
    sections: [],
    segments: [
      { start: 0, duration: 5, loudness_max: -60, loudness_start: -60 },
      { start: 5, duration: 5, loudness_max: 0, loudness_start: -10 },
    ],
  }

  it('produces samples covering the full track duration', () => {
    const curve = analysisToEnergyCurve(baseAnalysis, 0.5)
    expect(curve.durationSeconds).toBe(10)
    expect(curve.resolutionSeconds).toBe(0.5)
    expect(curve.samples).toHaveLength(20)
  })

  it('maps dB loudness to a 0..1 normalised value', () => {
    const curve = analysisToEnergyCurve(baseAnalysis, 0.5)
    expect(curve.samples[0]).toBeCloseTo(0, 5)
    expect(curve.samples[19]).toBeCloseTo(1, 5)
  })

  it('takes the peak loudness when segments overlap a frame', () => {
    const overlapping: SpotifyAudioAnalysis = {
      track: { duration: 1, tempo: 120, loudness: -10, key: 0, mode: 1 },
      sections: [],
      segments: [
        { start: 0, duration: 1, loudness_max: -30, loudness_start: -30 },
        { start: 0.25, duration: 0.5, loudness_max: -6, loudness_start: -10 },
      ],
    }
    const curve = analysisToEnergyCurve(overlapping, 0.5)
    expect(curve.samples[0]).toBeCloseTo((-6 + 60) / 60, 5)
  })
})
