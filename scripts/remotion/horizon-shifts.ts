/**
 * Pure horizon-alignment math used by the BasicReel crossfade. Kept
 * separate from BasicReel.tsx so the math is unit-testable without
 * pulling in Remotion (which loads fonts at import time).
 */

// Max translateY applied for horizon alignment, as a fraction of the
// canvas's short edge. Beyond this we leave the horizons mismatched
// rather than introduce obvious vertical motion.
export const HORIZON_MAX_SHIFT_RATIO = 0.15

export type HorizonShift = {
  /** Shift applied when this clip is fading IN as the new clip. */
  incomingShiftPx: number
  /** Shift applied when this clip is fading OUT to the next clip. */
  outgoingShiftPx: number
}

/**
 * Given the horizons for every clip, compute the translateY each clip
 * applies as it enters/leaves a crossfade so the horizons meet at the
 * midpoint of the overlap. Skipped entirely for non-crossfade
 * transitions, and per-pair when either horizon is unknown or the
 * required shift exceeds HORIZON_MAX_SHIFT_RATIO of the canvas height.
 */
export function computeHorizonShifts(opts: {
  horizons: (number | null)[] | undefined
  clipCount: number
  canvasHeight: number
  isCrossfade: boolean
}): HorizonShift[] {
  const shifts: HorizonShift[] = Array.from({ length: opts.clipCount }, () => ({
    incomingShiftPx: 0,
    outgoingShiftPx: 0,
  }))
  if (!opts.isCrossfade || !opts.horizons) return shifts
  const maxShift = opts.canvasHeight * HORIZON_MAX_SHIFT_RATIO
  for (let i = 0; i < opts.clipCount - 1; i++) {
    const a = opts.horizons[i]
    const b = opts.horizons[i + 1]
    if (a == null || b == null) continue
    const deltaPx = (b - a) * opts.canvasHeight
    if (Math.abs(deltaPx) > maxShift * 2) continue
    // Outgoing clip (i): animate 0 → +deltaPx/2 during crossfade.
    // Incoming clip (i+1): start at -deltaPx/2, return to 0.
    // Horizons meet at the midpoint of the crossfade.
    shifts[i].outgoingShiftPx = deltaPx / 2
    shifts[i + 1].incomingShiftPx = -deltaPx / 2
  }
  return shifts
}
