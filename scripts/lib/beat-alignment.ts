export type AlignmentInput = {
  durationSeconds: number
  bpm: number
  beatsPerBar?: number
  downbeatOffsetSeconds?: number
  numClips: number
}

export type AlignmentResult = {
  cutSeconds: number[]
  clipDurationsSeconds: number[]
  downbeats: number[]
  barDurationSeconds: number
}

export function planBeatAlignedCuts(input: AlignmentInput): AlignmentResult {
  const beatsPerBar = input.beatsPerBar ?? 4
  const offset = input.downbeatOffsetSeconds ?? 0
  const barDurationSeconds = (60 / input.bpm) * beatsPerBar

  const downbeats: number[] = []
  for (let t = offset; t < input.durationSeconds + 1e-6; t += barDurationSeconds) {
    if (t > 0) downbeats.push(t)
  }

  const internalCutCount = Math.max(0, input.numClips - 1)
  const cutSeconds: number[] = []
  const used = new Set<number>()
  for (let i = 1; i <= internalCutCount; i++) {
    const ideal = (i * input.durationSeconds) / input.numClips
    let best = -1
    let bestDist = Infinity
    for (let j = 0; j < downbeats.length; j++) {
      if (used.has(j)) continue
      const d = downbeats[j]
      if (d <= 0 || d >= input.durationSeconds) continue
      const dist = Math.abs(d - ideal)
      if (dist < bestDist) {
        bestDist = dist
        best = j
      }
    }
    if (best === -1) break
    used.add(best)
    cutSeconds.push(downbeats[best])
  }

  cutSeconds.sort((a, b) => a - b)

  const boundaries = [0, ...cutSeconds, input.durationSeconds]
  const clipDurationsSeconds: number[] = []
  for (let i = 1; i < boundaries.length; i++) {
    clipDurationsSeconds.push(boundaries[i] - boundaries[i - 1])
  }

  return { cutSeconds, clipDurationsSeconds, downbeats, barDurationSeconds }
}
