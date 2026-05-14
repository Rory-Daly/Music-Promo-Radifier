export type EnergyCurve = {
  durationSeconds: number
  resolutionSeconds: number
  samples: number[]
}

export type HookCandidate = {
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  score: number
  meanEnergy: number
  contrast: number
  positionFraction: number
  label: string
}

export type FindHooksOptions = {
  minDuration?: number
  maxDuration?: number
  durationStep?: number
  startStride?: number
  count?: number
}

export function findTopHooks(curve: EnergyCurve, options: FindHooksOptions = {}): HookCandidate[] {
  const minDuration = options.minDuration ?? 15
  const maxDuration = options.maxDuration ?? 30
  const durationStep = options.durationStep ?? 5
  const startStride = options.startStride ?? 1
  const count = options.count ?? 5

  if (curve.durationSeconds < minDuration) {
    return []
  }

  const effectiveMaxDuration = Math.min(maxDuration, curve.durationSeconds)

  const candidates: HookCandidate[] = []
  for (let dur = minDuration; dur <= effectiveMaxDuration; dur += durationStep) {
    for (let start = 0; start + dur <= curve.durationSeconds; start += startStride) {
      const end = start + dur
      const meanEnergy = energyInRange(curve, start, end)
      const before = energyInRange(curve, Math.max(0, start - 10), start)
      const contrast = meanEnergy - before
      const positionFraction = start / curve.durationSeconds
      const positionWeight = positionPenalty(positionFraction, dur, curve.durationSeconds)
      const score = meanEnergy * (1 + Math.max(0, contrast)) * positionWeight
      candidates.push({
        startSeconds: start,
        endSeconds: end,
        durationSeconds: dur,
        score,
        meanEnergy,
        contrast,
        positionFraction,
        label: labelFromMetrics(meanEnergy, contrast),
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)

  const picked: HookCandidate[] = []
  for (const c of candidates) {
    if (picked.length >= count) break
    const overlaps = picked.some(
      (p) => Math.max(p.startSeconds, c.startSeconds) < Math.min(p.endSeconds, c.endSeconds),
    )
    if (!overlaps) picked.push(c)
  }
  return picked
}

function energyInRange(curve: EnergyCurve, startSec: number, endSec: number): number {
  const startIdx = Math.max(0, Math.floor(startSec / curve.resolutionSeconds))
  const endIdx = Math.min(curve.samples.length, Math.ceil(endSec / curve.resolutionSeconds))
  if (endIdx <= startIdx) return 0
  let sum = 0
  for (let i = startIdx; i < endIdx; i++) sum += curve.samples[i]
  return sum / (endIdx - startIdx)
}

function positionPenalty(fraction: number, dur: number, total: number): number {
  const endFraction = (fraction * total + dur) / total
  let weight = 1
  if (fraction < 0.08) weight *= 0.6 + (fraction / 0.08) * 0.4
  if (endFraction > 0.97) weight *= 0.6
  return weight
}

function labelFromMetrics(meanEnergy: number, contrast: number): string {
  if (contrast > 0.2 && meanEnergy > 0.5) return 'drop'
  if (contrast > 0.08) return 'build → main'
  if (meanEnergy > 0.7) return 'main hook'
  return 'section'
}
