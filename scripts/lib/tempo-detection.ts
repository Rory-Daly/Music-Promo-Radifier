import { spawn } from 'node:child_process'
import FFT from 'fft.js'

export type TempoResult = {
  bpm: number
  bpmAlternates: number[]
  downbeatOffsetSeconds: number
  confidence: number
  topPeaks: { bpm: number; rawCorrelation: number; weightedScore: number }[]
}

export type TempoOptions = {
  resolutionSeconds?: number
  minBpm?: number
  maxBpm?: number
  beatsPerBar?: number
  preferredBpm?: number
  preferredWidth?: number
}

export async function detectTempo(
  audioFile: string,
  startSeconds: number,
  endSeconds: number,
  options: TempoOptions = {},
): Promise<TempoResult> {
  const minBpm = options.minBpm ?? 80
  const maxBpm = options.maxBpm ?? 180
  const beatsPerBar = options.beatsPerBar ?? 4
  const preferredBpm = options.preferredBpm ?? 120
  const preferredWidth = options.preferredWidth ?? 60

  const { fullOdf, lowOdf, resolutionSeconds } = await computeSpectralFluxOdfBands(
    audioFile,
    startSeconds,
    endSeconds,
  )

  const tempo = detectTempoFromOdf(fullOdf, resolutionSeconds, {
    minBpm,
    maxBpm,
    beatsPerBar,
    preferredBpm,
    preferredWidth,
  })

  const beatLagSamples = 60 / tempo.bpm / resolutionSeconds
  const beatPhaseSamples = findBeatPhase(fullOdf, beatLagSamples)
  const downbeatPhase = findDownbeatPhase(lowOdf, beatLagSamples, beatPhaseSamples, beatsPerBar)
  const downbeatOffsetSeconds =
    (beatPhaseSamples + downbeatPhase * beatLagSamples) * resolutionSeconds

  return { ...tempo, downbeatOffsetSeconds }
}

function findBeatPhase(odf: number[], beatLagSamples: number): number {
  const lag = Math.max(1, Math.round(beatLagSamples))
  let bestPhase = 0
  let bestScore = -Infinity
  for (let phase = 0; phase < lag; phase++) {
    let score = 0
    let count = 0
    for (let pos = phase; pos < odf.length; pos += lag) {
      score += odf[pos]
      count++
    }
    if (count > 0) score /= count
    if (score > bestScore) {
      bestScore = score
      bestPhase = phase
    }
  }
  return bestPhase
}

function findDownbeatPhase(
  lowOdf: number[],
  beatLagSamples: number,
  beatPhaseSamples: number,
  beatsPerBar: number,
): number {
  let bestDownbeat = 0
  let bestScore = -Infinity
  for (let dbPhase = 0; dbPhase < beatsPerBar; dbPhase++) {
    let score = 0
    let count = 0
    const start = beatPhaseSamples + dbPhase * beatLagSamples
    const stride = beatLagSamples * beatsPerBar
    for (let pos = start; pos < lowOdf.length; pos += stride) {
      const idx = Math.round(pos)
      if (idx >= 0 && idx < lowOdf.length) {
        score += lowOdf[idx]
        count++
      }
    }
    if (count > 0) score /= count
    if (score > bestScore) {
      bestScore = score
      bestDownbeat = dbPhase
    }
  }
  return bestDownbeat
}

export async function computeSpectralFluxOdfBands(
  audioFile: string,
  startSeconds: number,
  endSeconds: number,
  options: {
    sampleRate?: number
    windowSize?: number
    hopSize?: number
    lowBandHz?: number
  } = {},
): Promise<{ fullOdf: number[]; lowOdf: number[]; resolutionSeconds: number }> {
  const sampleRate = options.sampleRate ?? 22050
  const windowSize = options.windowSize ?? 1024
  const hopSize = options.hopSize ?? 256
  const lowBandHz = options.lowBandHz ?? 250
  const resolutionSeconds = hopSize / sampleRate
  const lowBandCutoffBin = Math.max(1, Math.ceil((lowBandHz / sampleRate) * windowSize))

  const pcm = await decodePcm(audioFile, startSeconds, endSeconds, sampleRate)
  if (pcm.length < windowSize) {
    throw new Error('Audio segment too short for spectral analysis')
  }

  const fft = new FFT(windowSize)
  const fftInput = fft.createComplexArray()
  const fftOutput = fft.createComplexArray()

  const hann = new Float32Array(windowSize)
  for (let i = 0; i < windowSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)))
  }

  const numBins = windowSize / 2
  const prevMag = new Float32Array(numBins)
  let isFirstFrame = true
  const fullOdf: number[] = []
  const lowOdf: number[] = []

  for (let start = 0; start + windowSize <= pcm.length; start += hopSize) {
    for (let i = 0; i < windowSize; i++) {
      fftInput[2 * i] = pcm[start + i] * hann[i]
      fftInput[2 * i + 1] = 0
    }
    fft.transform(fftOutput, fftInput)

    let fullFlux = 0
    let lowFlux = 0
    for (let k = 1; k < numBins; k++) {
      const re = fftOutput[2 * k]
      const im = fftOutput[2 * k + 1]
      const mag = Math.sqrt(re * re + im * im)
      if (!isFirstFrame) {
        const diff = mag - prevMag[k]
        if (diff > 0) {
          fullFlux += diff
          if (k <= lowBandCutoffBin) lowFlux += diff
        }
      }
      prevMag[k] = mag
    }
    if (!isFirstFrame) {
      fullOdf.push(fullFlux)
      lowOdf.push(lowFlux)
    }
    isFirstFrame = false
  }

  const normalize = (arr: number[]): number[] => {
    const max = arr.reduce((m, v) => (v > m ? v : m), 0)
    return max > 0 ? arr.map((v) => v / max) : arr
  }

  return {
    fullOdf: normalize(fullOdf),
    lowOdf: normalize(lowOdf),
    resolutionSeconds,
  }
}

export async function computeSpectralFluxOdf(
  audioFile: string,
  startSeconds: number,
  endSeconds: number,
  options: { sampleRate?: number; windowSize?: number; hopSize?: number } = {},
): Promise<{ odf: number[]; resolutionSeconds: number }> {
  const { fullOdf, resolutionSeconds } = await computeSpectralFluxOdfBands(
    audioFile,
    startSeconds,
    endSeconds,
    options,
  )
  return { odf: fullOdf, resolutionSeconds }
}

async function decodePcm(
  audioFile: string,
  startSeconds: number,
  endSeconds: number,
  sampleRate: number,
): Promise<Float32Array> {
  const duration = endSeconds - startSeconds
  return new Promise<Float32Array>((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-ss',
      String(startSeconds),
      '-i',
      audioFile,
      '-t',
      String(duration),
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      '-loglevel',
      'error',
      'pipe:1',
    ])
    const chunks: Buffer[] = []
    let stderr = ''
    ff.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    ff.stdout.on('data', (c: Buffer) => {
      chunks.push(c)
    })
    ff.on('error', (err) => reject(new Error(`ffmpeg failed to start: ${err.message}`)))
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`))
        return
      }
      const buf = Buffer.concat(chunks)
      const samples = new Float32Array(buf.byteLength / 4)
      for (let i = 0; i < samples.length; i++) {
        samples[i] = buf.readFloatLE(i * 4)
      }
      resolve(samples)
    })
  })
}

export function detectTempoFromOdf(
  odf: number[],
  resolutionSeconds: number,
  options: { minBpm: number; maxBpm: number; beatsPerBar: number; preferredBpm?: number; preferredWidth?: number },
): TempoResult {
  const { minBpm, maxBpm, beatsPerBar } = options
  const preferredBpm = options.preferredBpm ?? 120
  const preferredWidth = options.preferredWidth ?? 60
  const minLag = Math.max(1, Math.floor(60 / maxBpm / resolutionSeconds))
  const maxLag = Math.min(odf.length - 1, Math.ceil(60 / minBpm / resolutionSeconds))

  if (maxLag <= minLag) {
    throw new Error('Audio is too short for tempo detection at the requested BPM range.')
  }

  const rawCorr: number[] = new Array(maxLag - minLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    for (let i = 0; i + lag < odf.length; i++) {
      corr += odf[i] * odf[i + lag]
    }
    rawCorr[lag - minLag] = corr
  }

  const weighted: number[] = rawCorr.map((c, i) => {
    const lag = minLag + i
    const bpmAtLag = 60 / (lag * resolutionSeconds)
    const w = 1 / (1 + Math.abs(bpmAtLag - preferredBpm) / preferredWidth)
    return c * w
  })

  let bestIdx = 0
  for (let i = 1; i < weighted.length; i++) {
    if (weighted[i] > weighted[bestIdx]) bestIdx = i
  }
  const bestRaw = rawCorr[bestIdx]

  let refinedLag = minLag + bestIdx
  if (bestIdx > 0 && bestIdx < rawCorr.length - 1) {
    const y0 = rawCorr[bestIdx - 1]
    const y1 = rawCorr[bestIdx]
    const y2 = rawCorr[bestIdx + 1]
    const denom = y0 - 2 * y1 + y2
    if (Math.abs(denom) > 1e-9) {
      const offset = (0.5 * (y0 - y2)) / denom
      if (Math.abs(offset) < 1) {
        refinedLag = minLag + bestIdx + offset
      }
    }
  }
  const bestLag = refinedLag

  const peakIndices = findPeakIndices(weighted, 6)
  const topPeaks = peakIndices.map((idx) => ({
    bpm: 60 / ((minLag + idx) * resolutionSeconds),
    rawCorrelation: rawCorr[idx],
    weightedScore: weighted[idx],
  }))

  let rawSum = 0
  for (const c of rawCorr) rawSum += c
  const rawMean = rawSum / rawCorr.length
  const confidence = bestRaw > 0 ? (bestRaw - rawMean) / bestRaw : 0

  const alternates: number[] = []
  for (const mult of [0.5, 2]) {
    const lag = Math.round(bestLag / mult)
    if (lag >= minLag && lag <= maxLag) {
      alternates.push(60 / (lag * resolutionSeconds))
    }
  }

  const bpm = 60 / (bestLag * resolutionSeconds)
  const barSamples = bestLag * beatsPerBar

  let strongestIdx = 0
  let strongestVal = -Infinity
  const scanEnd = Math.min(barSamples, odf.length)
  for (let i = 0; i < scanEnd; i++) {
    if (odf[i] > strongestVal) {
      strongestVal = odf[i]
      strongestIdx = i
    }
  }

  const phaseInBar = strongestIdx % barSamples
  const downbeatOffsetSeconds = phaseInBar * resolutionSeconds

  return {
    bpm,
    bpmAlternates: alternates,
    downbeatOffsetSeconds,
    confidence,
    topPeaks,
  }
}

function findPeakIndices(values: number[], count: number): number[] {
  const indexed = values.map((v, i) => ({ v, i }))
  indexed.sort((a, b) => b.v - a.v)
  const picked: number[] = []
  const minSeparation = Math.max(1, Math.floor(values.length / 30))
  for (const { i } of indexed) {
    if (picked.length >= count) break
    const tooClose = picked.some((p) => Math.abs(p - i) < minSeparation)
    if (!tooClose) picked.push(i)
  }
  return picked.sort((a, b) => values[b] - values[a])
}

function computeOnsetFunction(energy: number[]): number[] {
  const odf = new Array<number>(energy.length).fill(0)
  for (let i = 1; i < energy.length; i++) {
    const diff = energy[i] - energy[i - 1]
    odf[i] = diff > 0 ? diff : 0
  }
  return odf
}

async function extractEnergyCurve(
  audioFile: string,
  startSeconds: number,
  endSeconds: number,
  resolution: number,
): Promise<number[]> {
  const sampleRate = 22050
  const samplesPerWindow = Math.max(1, Math.floor(sampleRate * resolution))
  const bytesPerWindow = samplesPerWindow * 2
  const duration = endSeconds - startSeconds

  return new Promise<number[]>((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-ss',
      String(startSeconds),
      '-i',
      audioFile,
      '-t',
      String(duration),
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      '-loglevel',
      'error',
      'pipe:1',
    ])
    const chunks: Buffer[] = []
    let stderr = ''
    ff.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    ff.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    ff.on('error', (err) => reject(new Error(`ffmpeg failed to start: ${err.message}`)))
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed (${code}): ${stderr.trim()}`))
        return
      }
      const pcm = Buffer.concat(chunks)
      const totalWindows = Math.floor(pcm.length / bytesPerWindow)
      if (totalWindows === 0) {
        reject(new Error('No audio samples extracted for tempo detection'))
        return
      }
      const energies = new Array<number>(totalWindows)
      for (let w = 0; w < totalWindows; w++) {
        const off = w * bytesPerWindow
        let sumSquares = 0
        for (let i = 0; i < bytesPerWindow; i += 2) {
          const s = pcm.readInt16LE(off + i)
          const n = s / 32768
          sumSquares += n * n
        }
        energies[w] = Math.sqrt(sumSquares / samplesPerWindow)
      }
      const max = energies.reduce((m, e) => (e > m ? e : m), 0)
      const normalized = max > 0 ? energies.map((e) => e / max) : energies
      resolve(normalized)
    })
  })
}
