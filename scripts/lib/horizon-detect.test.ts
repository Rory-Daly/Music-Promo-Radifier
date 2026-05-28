import { describe, expect, it } from 'vitest'
import {
  detectHorizonInFrame,
  parsePgm,
  pickSampleTimes,
  type GrayscaleFrame,
} from './horizon-detect'

function makeFrame(
  width: number,
  height: number,
  fill: (x: number, y: number) => number,
): GrayscaleFrame {
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels[y * width + x] = Math.max(0, Math.min(255, Math.round(fill(x, y))))
    }
  }
  return { width, height, pixels }
}

describe('detectHorizonInFrame', () => {
  it('finds a strong horizon line at the expected row', () => {
    // Sky (200) on top, sea (60) on bottom, sharp horizon at y=40 out of 100.
    const frame = makeFrame(100, 100, (_x, y) => (y < 40 ? 200 : 60))
    const ratio = detectHorizonInFrame(frame, 5, 1.6)
    expect(ratio).not.toBeNull()
    expect(ratio!).toBeGreaterThan(0.35)
    expect(ratio!).toBeLessThan(0.45)
  })

  it('finds a low horizon (closer to bottom)', () => {
    const frame = makeFrame(100, 100, (_x, y) => (y < 75 ? 180 : 50))
    const ratio = detectHorizonInFrame(frame, 5, 1.6)
    expect(ratio).not.toBeNull()
    expect(ratio!).toBeGreaterThan(0.7)
    expect(ratio!).toBeLessThan(0.8)
  })

  it('returns null when the frame is uniform (no horizon)', () => {
    const frame = makeFrame(100, 100, () => 128)
    expect(detectHorizonInFrame(frame, 5, 1.6)).toBeNull()
  })

  it('returns null when no row stands out (gentle gradient)', () => {
    // Smooth top-to-bottom ramp — no single horizontal edge.
    const frame = makeFrame(100, 100, (_x, y) => 50 + (y * 150) / 99)
    // All rows share the same small gradient, so the peak shouldn't
    // outpace the mean by minPeakRatio.
    expect(detectHorizonInFrame(frame, 5, 1.6)).toBeNull()
  })

  it('ignores edges at the very top/bottom (letterbox guard)', () => {
    // Strong edge at y=2 (top margin region), gentle horizon at y=50.
    const frame = makeFrame(100, 100, (_x, y) => {
      if (y === 2) return 250
      return y < 50 ? 180 : 80
    })
    const ratio = detectHorizonInFrame(frame, 5, 1.6)
    expect(ratio).not.toBeNull()
    // Margin-guard should keep us in the middle 90%; horizon ~50%.
    expect(ratio!).toBeGreaterThan(0.4)
    expect(ratio!).toBeLessThan(0.6)
  })

  it('handles tiny frames gracefully', () => {
    const frame = makeFrame(10, 3, () => 100)
    expect(detectHorizonInFrame(frame, 3, 1.6)).toBeNull()
  })
})

describe('parsePgm', () => {
  function pgm(header: string, pixels: number[]): Buffer {
    return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(pixels)])
  }

  it('parses a minimal P5 PGM', () => {
    const buf = pgm('P5\n4 2\n255\n', [10, 20, 30, 40, 50, 60, 70, 80])
    const frame = parsePgm(buf)
    expect(frame.width).toBe(4)
    expect(frame.height).toBe(2)
    expect(Array.from(frame.pixels)).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
  })

  it('skips comment lines in the header', () => {
    const buf = pgm('P5\n# created by ffmpeg\n3 1\n# another\n255\n', [1, 2, 3])
    const frame = parsePgm(buf)
    expect(frame.width).toBe(3)
    expect(Array.from(frame.pixels)).toEqual([1, 2, 3])
  })

  it('rejects non-P5 magic', () => {
    const buf = Buffer.from('P6\n2 2\n255\n\0\0\0\0', 'ascii')
    expect(() => parsePgm(buf)).toThrow(/P5/)
  })

  it('rejects truncated pixel data', () => {
    const buf = pgm('P5\n4 4\n255\n', [1, 2, 3])
    expect(() => parsePgm(buf)).toThrow(/truncated/)
  })

  it('rejects 16-bit PGM (unsupported maxval)', () => {
    const buf = pgm('P5\n2 1\n65535\n', [0, 0, 0, 0])
    expect(() => parsePgm(buf)).toThrow(/maxval/)
  })
})

describe('pickSampleTimes', () => {
  it('spans the middle of the clip when count > 1', () => {
    const times = pickSampleTimes(10, 3)
    expect(times[0]).toBeGreaterThan(0)
    expect(times[0]).toBeLessThan(1)
    expect(times[2]).toBeGreaterThan(8)
    expect(times[2]).toBeLessThan(10)
    expect(times[1]).toBeGreaterThan(times[0])
    expect(times[1]).toBeLessThan(times[2])
  })

  it('picks the midpoint when count = 1', () => {
    expect(pickSampleTimes(10, 1)).toEqual([5])
  })

  it('falls back to all-zeros when duration is unknown', () => {
    expect(pickSampleTimes(0, 3)).toEqual([0, 0, 0])
    expect(pickSampleTimes(Number.NaN, 2)).toEqual([0, 0])
  })
})
