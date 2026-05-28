import { describe, expect, it } from 'vitest'
import { computeHorizonShifts } from './horizon-shifts'

describe('computeHorizonShifts', () => {
  it('returns zeroed shifts when not crossfading', () => {
    const shifts = computeHorizonShifts({
      horizons: [0.3, 0.6],
      clipCount: 2,
      canvasHeight: 1000,
      isCrossfade: false,
    })
    expect(shifts).toEqual([
      { incomingShiftPx: 0, outgoingShiftPx: 0 },
      { incomingShiftPx: 0, outgoingShiftPx: 0 },
    ])
  })

  it('shifts adjacent clips so horizons meet at the midpoint', () => {
    // Clip A horizon at 0.4 * 1000 = 400px from top.
    // Clip B horizon at 0.6 * 1000 = 600px from top.
    // Midpoint target = 500px.
    // A should slide down by +100px during its tail; B starts -100px
    // up and returns to natural during its head.
    const shifts = computeHorizonShifts({
      horizons: [0.4, 0.6],
      clipCount: 2,
      canvasHeight: 1000,
      isCrossfade: true,
    })
    expect(shifts[0].outgoingShiftPx).toBeCloseTo(100, 5)
    expect(shifts[1].incomingShiftPx).toBeCloseTo(-100, 5)
    // No outgoing for the last clip, no incoming for the first.
    expect(shifts[0].incomingShiftPx).toBe(0)
    expect(shifts[1].outgoingShiftPx).toBe(0)
  })

  it('skips alignment when a clip horizon is unknown', () => {
    const shifts = computeHorizonShifts({
      horizons: [0.4, null, 0.5],
      clipCount: 3,
      canvasHeight: 1000,
      isCrossfade: true,
    })
    // Pair 0->1: skipped (null on the right).
    expect(shifts[0].outgoingShiftPx).toBe(0)
    expect(shifts[1].incomingShiftPx).toBe(0)
    // Pair 1->2: skipped (null on the left).
    expect(shifts[1].outgoingShiftPx).toBe(0)
    expect(shifts[2].incomingShiftPx).toBe(0)
  })

  it('skips alignment when the required shift exceeds the safety cap', () => {
    // 0.05 → 0.95 = 900px delta on a 1000px canvas. Cap is 0.15 * 1000
    // = 150px per clip; total shift across the pair would be 900px,
    // far above 2 * cap. Should bail.
    const shifts = computeHorizonShifts({
      horizons: [0.05, 0.95],
      clipCount: 2,
      canvasHeight: 1000,
      isCrossfade: true,
    })
    expect(shifts[0].outgoingShiftPx).toBe(0)
    expect(shifts[1].incomingShiftPx).toBe(0)
  })

  it('chains shifts across three clips when each adjacent pair is in range', () => {
    const shifts = computeHorizonShifts({
      horizons: [0.4, 0.5, 0.6],
      clipCount: 3,
      canvasHeight: 1000,
      isCrossfade: true,
    })
    expect(shifts[0].outgoingShiftPx).toBeCloseTo(50, 5)
    expect(shifts[1].incomingShiftPx).toBeCloseTo(-50, 5)
    expect(shifts[1].outgoingShiftPx).toBeCloseTo(50, 5)
    expect(shifts[2].incomingShiftPx).toBeCloseTo(-50, 5)
  })

  it('returns zeroed shifts when horizons array is missing', () => {
    const shifts = computeHorizonShifts({
      horizons: undefined,
      clipCount: 2,
      canvasHeight: 1000,
      isCrossfade: true,
    })
    expect(shifts).toEqual([
      { incomingShiftPx: 0, outgoingShiftPx: 0 },
      { incomingShiftPx: 0, outgoingShiftPx: 0 },
    ])
  })
})
