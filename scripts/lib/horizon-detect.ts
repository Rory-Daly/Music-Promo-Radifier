/**
 * Horizon-line detection for drone / landscape footage.
 *
 * Returns a 0..1 ratio of the frame height — 0 = top edge, 1 = bottom
 * edge — representing where the dominant horizontal edge lives. Used at
 * render time to align horizons during crossfade transitions.
 *
 * Algorithm: sample a small number of frames evenly across the clip,
 * scale each down to a low resolution greyscale, compute the per-row
 * mean of |row[y+1] - row[y]| (a cheap proxy for the vertical Sobel
 * response), smooth, then take the argmax row. Median across frames
 * for robustness against transient motion.
 *
 * Cheap and dependency-free — we ask ffmpeg to emit PGM and parse the
 * binary header ourselves. Good enough for drone shots with strong
 * sea/land/sky boundaries. Not a general scene-understanding tool.
 */
import { spawn } from 'node:child_process'

export type HorizonDetectOptions = {
  /** Frames to sample. Default 3. More = slower, marginally more robust. */
  sampleCount?: number
  /** Width to scale each sample to. Default 160 — plenty for row gradients. */
  sampleWidth?: number
  /**
   * Smoothing window for the row-gradient curve before picking the peak.
   * Larger = ignores spiky thin edges (e.g. a single bright kelp line).
   * Default 5.
   */
  smoothingWindow?: number
  /**
   * If the strongest gradient is weaker than the median row gradient by
   * less than this factor, we treat the result as ambiguous and return
   * null. Default 1.6 (peak must be 60% stronger than the median).
   */
  minPeakRatio?: number
}

export type HorizonDetectResult = {
  /** 0..1 = position from top of frame. null = no confident horizon found. */
  ratio: number | null
  /** Sample timestamps that fed into the result (seconds from clip start). */
  sampledAtSeconds: number[]
}

/**
 * Detects horizon Y position in the file at `path`.
 *
 * If the clip's duration is unknown (or < 1s), we still sample at t=0
 * and t=mid as best effort. Failures from ffmpeg propagate.
 */
export async function detectHorizon(
  path: string,
  durationSeconds: number,
  options: HorizonDetectOptions = {},
): Promise<HorizonDetectResult> {
  const sampleCount = Math.max(1, options.sampleCount ?? 3)
  const sampleWidth = Math.max(32, options.sampleWidth ?? 160)
  const smoothingWindow = Math.max(1, options.smoothingWindow ?? 5)
  const minPeakRatio = options.minPeakRatio ?? 1.6

  const sampledAtSeconds = pickSampleTimes(durationSeconds, sampleCount)
  const perFrameRatios: number[] = []
  for (const t of sampledAtSeconds) {
    const frame = await extractFrame(path, t, sampleWidth)
    const ratio = detectHorizonInFrame(frame, smoothingWindow, minPeakRatio)
    if (ratio !== null) perFrameRatios.push(ratio)
  }
  if (perFrameRatios.length === 0) {
    return { ratio: null, sampledAtSeconds }
  }
  const sorted = [...perFrameRatios].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return { ratio: median, sampledAtSeconds }
}

export function pickSampleTimes(durationSeconds: number, count: number): number[] {
  if (durationSeconds <= 0 || !Number.isFinite(durationSeconds)) {
    return Array.from({ length: count }, () => 0)
  }
  if (count === 1) return [durationSeconds / 2]
  // Pad endpoints away from t=0 and t=duration so we avoid black-frame
  // intro/outro artefacts. Spacing covers the middle 90% of the clip.
  const span = durationSeconds * 0.9
  const start = durationSeconds * 0.05
  return Array.from(
    { length: count },
    (_, i) => start + (span * i) / (count - 1),
  )
}

export type GrayscaleFrame = {
  width: number
  height: number
  /** Row-major Uint8 brightness, length = width * height. */
  pixels: Uint8Array
}

/**
 * Detects the dominant horizontal edge in a greyscale frame. Returns a
 * 0..1 ratio of the frame height, or null if no row stands out clearly.
 *
 * Exported for unit tests so we can drive it with synthetic frames.
 */
export function detectHorizonInFrame(
  frame: GrayscaleFrame,
  smoothingWindow: number,
  minPeakRatio: number,
): number | null {
  if (frame.height < 4) return null
  // Per-row mean of |row[y+1,x] - row[y,x]| across x. Cheap vertical
  // gradient — strong horizontal edges (horizon, shoreline) light up.
  const rowGradient = new Float32Array(frame.height - 1)
  for (let y = 0; y < frame.height - 1; y++) {
    let sum = 0
    const rowA = y * frame.width
    const rowB = (y + 1) * frame.width
    for (let x = 0; x < frame.width; x++) {
      const d = frame.pixels[rowB + x] - frame.pixels[rowA + x]
      sum += d < 0 ? -d : d
    }
    rowGradient[y] = sum / frame.width
  }

  const smoothed = smoothBoxcar(rowGradient, smoothingWindow)

  // Argmax — but ignore the top/bottom 5% of rows since those are often
  // letterbox bars or ffmpeg padding artefacts.
  const margin = Math.floor(smoothed.length * 0.05)
  let bestY = -1
  let bestVal = -Infinity
  let sum = 0
  for (let y = margin; y < smoothed.length - margin; y++) {
    sum += smoothed[y]
    if (smoothed[y] > bestVal) {
      bestVal = smoothed[y]
      bestY = y
    }
  }
  const usable = smoothed.length - 2 * margin
  if (bestY < 0 || usable <= 0) return null
  const mean = sum / usable
  if (mean <= 0) return null
  if (bestVal < mean * minPeakRatio) return null

  return bestY / (frame.height - 1)
}

function smoothBoxcar(values: Float32Array, window: number): Float32Array {
  const out = new Float32Array(values.length)
  const half = Math.floor(window / 2)
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(values.length, i + half + 1)
    let s = 0
    for (let j = lo; j < hi; j++) s += values[j]
    out[i] = s / (hi - lo)
  }
  return out
}

/**
 * Asks ffmpeg for a single greyscale frame at time `t`, scaled to
 * `width` pixels, height preserving aspect. Returned as a parsed PGM.
 */
function extractFrame(
  path: string,
  timeSeconds: number,
  width: number,
): Promise<GrayscaleFrame> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', String(timeSeconds),
      '-i', path,
      '-frames:v', '1',
      '-vf', `scale=${width}:-2:flags=area,format=gray`,
      '-f', 'image2pipe',
      '-c:v', 'pgm',
      '-',
    ])
    const chunks: Buffer[] = []
    let stderr = ''
    ff.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    ff.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    ff.on('error', (err) => reject(new Error(`ffmpeg failed to start: ${err.message}`)))
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg frame extract failed (exit ${code}): ${stderr.trim().slice(-200)}`))
        return
      }
      try {
        resolve(parsePgm(Buffer.concat(chunks)))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

/**
 * Minimal binary PGM (P5) parser. Header is ASCII:
 *   P5\n
 *   <width> <height>\n
 *   <maxval>\n
 *   <binary pixels>
 * Comments beginning with `#` may appear between tokens.
 */
export function parsePgm(buffer: Buffer): GrayscaleFrame {
  if (buffer.length < 6) throw new Error('PGM too short')
  if (buffer[0] !== 0x50 || buffer[1] !== 0x35) {
    throw new Error('Not a P5 PGM frame')
  }
  let i = 2
  const tokens: string[] = []
  while (tokens.length < 3 && i < buffer.length) {
    // Skip whitespace
    while (i < buffer.length && isWhitespace(buffer[i])) i++
    // Skip comment line
    if (buffer[i] === 0x23) {
      while (i < buffer.length && buffer[i] !== 0x0a) i++
      continue
    }
    // Read token
    const start = i
    while (i < buffer.length && !isWhitespace(buffer[i])) i++
    if (i > start) tokens.push(buffer.subarray(start, i).toString('ascii'))
  }
  if (tokens.length < 3) throw new Error('PGM header malformed')
  // Skip the single whitespace byte after maxval that separates header
  // from pixel data.
  if (i < buffer.length && isWhitespace(buffer[i])) i++
  const width = Number(tokens[0])
  const height = Number(tokens[1])
  const maxval = Number(tokens[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxval)) {
    throw new Error('PGM header values not numeric')
  }
  if (maxval > 255) {
    // 16-bit PGM is theoretically possible but ffmpeg's `gray` pixfmt
    // always emits 8-bit, so we don't bother handling it.
    throw new Error(`Unsupported PGM maxval ${maxval} (expected ≤ 255)`)
  }
  const expectedBytes = width * height
  const pixels = buffer.subarray(i, i + expectedBytes)
  if (pixels.length < expectedBytes) {
    throw new Error(
      `PGM pixel data truncated: expected ${expectedBytes} bytes, got ${pixels.length}`,
    )
  }
  return {
    width,
    height,
    pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, expectedBytes),
  }
}

function isWhitespace(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d
}
