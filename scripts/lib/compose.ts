import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve as resolvePath } from 'node:path'
import { planBeatAlignedCuts } from './beat-alignment'
import { discoverClips, mulberry32, selectClips, type SelectedClip } from './clip-selection'
import { detectTempo } from './tempo-detection'
import {
  type AspectRatio,
  getAspectRatioConfig,
} from '../remotion/aspect-ratios'
import type { BasicReelProps } from '../remotion/BasicReel'
import { DEFAULT_TRANSITION, planTransition, type Transition } from '../remotion/transitions'

export type ComposeReelOptions = {
  audioPath: string
  hookStartSeconds: number
  hookEndSeconds: number
  outputPath: string
  explicitClipPaths?: string[]
  clipsFolder?: string
  numClips?: number
  seed?: number
  fps?: number
  bpm?: number
  beatsPerBar?: number
  downbeatOffsetSeconds?: number
  noAlign?: boolean
  title?: string
  artistName?: string
  cta?: string
  noOverlays?: boolean
  slowmo?: number
  aspectRatio?: AspectRatio
  transition?: Transition
  wordmarkPath?: string
  fontsDir?: string
  onProgress?: (info: { stage: string; pct?: number; message?: string }) => void
}

export type ComposeReelResult = {
  outputPath: string
  durationSeconds: number
  width: number
  height: number
  fps: number
  bpm?: number
}

export async function composeReel(opts: ComposeReelOptions): Promise<ComposeReelResult> {
  const fps = opts.fps ?? 30
  const beatsPerBar = opts.beatsPerBar ?? 4
  const slowmo = opts.slowmo ?? 1
  const noAlign = opts.noAlign ?? false
  const noOverlays = opts.noOverlays ?? false
  const artistName = opts.artistName ?? 'illutible'
  const cta = opts.cta ?? 'illutible.com'
  const aspectRatio = opts.aspectRatio ?? '9x16'
  const transition = opts.transition ?? DEFAULT_TRANSITION
  const aspectConfig = getAspectRatioConfig(aspectRatio)
  const transitionPlan = planTransition(transition)
  const progress = opts.onProgress ?? (() => {})

  const audioAbs = resolvePath(opts.audioPath)
  if (!existsSync(audioAbs)) throw new Error(`Audio not found: ${audioAbs}`)

  const start = opts.hookStartSeconds
  const end = opts.hookEndSeconds
  if (end <= start) throw new Error(`Hook end (${end}) must be after start (${start})`)
  const durationSeconds = end - start

  const explicitClipPaths = (opts.explicitClipPaths ?? []).map((c) => resolvePath(c))
  for (const c of explicitClipPaths) {
    if (!existsSync(c)) throw new Error(`Clip not found: ${c}`)
  }

  const outputAbs = resolvePath(opts.outputPath)
  mkdirSync(dirname(outputAbs), { recursive: true })

  const publicDir = mkdtempSync(join(tmpdir(), 'legatograph-remotion-'))
  let detectedBpm: number | undefined
  try {
    const audioName = `audio${extname(audioAbs) || '.wav'}`
    copyFileSync(audioAbs, join(publicDir, audioName))

    const numClipsTarget = opts.numClips ?? Math.max(3, Math.round(durationSeconds / 7))
    const intendedNumClips =
      explicitClipPaths.length > 0 ? explicitClipPaths.length : numClipsTarget

    let clipDurationsSeconds: number[]
    if (noAlign) {
      const even = durationSeconds / intendedNumClips
      clipDurationsSeconds = Array.from({ length: intendedNumClips }, () => even)
      progress({ stage: 'plan', message: 'Beat alignment disabled (noAlign).' })
    } else {
      let bpm = opts.bpm
      let downbeatOffset = opts.downbeatOffsetSeconds ?? 0
      if (bpm === undefined || opts.downbeatOffsetSeconds === undefined) {
        progress({ stage: 'tempo', message: 'Detecting tempo from hook range...' })
        const detected = await detectTempo(audioAbs, start, end, { beatsPerBar })
        if (bpm === undefined) bpm = detected.bpm
        if (opts.downbeatOffsetSeconds === undefined) {
          downbeatOffset = detected.downbeatOffsetSeconds
        }
      }
      detectedBpm = bpm
      const plan = planBeatAlignedCuts({
        durationSeconds,
        bpm,
        beatsPerBar,
        downbeatOffsetSeconds: downbeatOffset,
        numClips: intendedNumClips,
      })
      clipDurationsSeconds = plan.clipDurationsSeconds
      progress({
        stage: 'plan',
        message: `BPM ${bpm.toFixed(1)}, downbeat offset ${downbeatOffset.toFixed(3)}s`,
      })
    }

    const selections: SelectedClip[] = await resolveClipSelections({
      explicitClips: explicitClipPaths,
      clipsFolder: opts.clipsFolder,
      outputDurationsSeconds: clipDurationsSeconds,
      slowmo,
      seed: opts.seed,
      progress,
    })

    progress({
      stage: 'preprocess',
      message: `Pre-processing ${selections.length} clip(s) to ${aspectConfig.width}x${aspectConfig.height} @ ${fps}fps (${aspectRatio}, ${transition})`,
    })
    const clipNames: string[] = []
    // For overlapping transitions (crossfade), every non-last clip needs an
    // extra `transition.durationSeconds` of footage at its tail so the next
    // clip can fade in over the top. Last clip is exactly its slot length.
    const tailExtensionSeconds = transitionPlan.overlapping
      ? transitionPlan.durationSeconds
      : 0
    for (let i = 0; i < selections.length; i++) {
      const sel = selections[i]
      const isLast = i === selections.length - 1
      const extension = isLast ? 0 : tailExtensionSeconds
      const outName = `clip${i}.mp4`
      const outPath = join(publicDir, outName)
      await preprocessClip(
        sel.path,
        outPath,
        sel.outputDurationSeconds + extension,
        fps,
        slowmo,
        sel.sourceStartSeconds,
        aspectConfig.ffmpegCropFilter,
      )
      clipNames.push(outName)
    }

    let wordmarkName: string | undefined
    if (!noOverlays && opts.wordmarkPath) {
      const wordmarkPath = resolvePath(opts.wordmarkPath)
      if (existsSync(wordmarkPath)) {
        wordmarkName = 'wordmark.png'
        copyFileSync(wordmarkPath, join(publicDir, wordmarkName))
      }
    }

    const fontsDir = opts.fontsDir ? resolvePath(opts.fontsDir) : resolvePath('assets/fonts')
    if (existsSync(fontsDir)) {
      const fontFiles = readdirSync(fontsDir).filter(
        (f) => /\.(ttf|otf|woff2?)$/i.test(f) && !f.startsWith('.'),
      )
      for (const f of fontFiles) copyFileSync(join(fontsDir, f), join(publicDir, f))
    }

    const inputProps: BasicReelProps = {
      audioFile: audioName,
      audioStartSeconds: start,
      durationSeconds,
      clipFiles: clipNames,
      clipDurationsSeconds,
      aspectRatio,
      transition,
      trackTitle: noOverlays ? '' : (opts.title ?? deriveTitle(opts.audioPath)),
      artistName,
      ctaText: noOverlays ? '' : cta,
      wordmarkFile: wordmarkName,
    }

    progress({ stage: 'bundle', message: 'Bundling Remotion project...' })
    const bundleLocation = await bundle({
      entryPoint: resolvePath('scripts/remotion/index.ts'),
      publicDir,
    })

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'BasicReel',
      inputProps,
    })

    progress({
      stage: 'render',
      message: `Rendering ${composition.width}x${composition.height} @ ${composition.fps}fps`,
    })

    let lastPercent = -1
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      // CRF 23 is the standard web sweet spot — visually lossless for the
      // resolutions we target (1080×1920 etc.) but ~5× smaller than the
      // Remotion default of CRF ~18, which was producing >1 GB files for
      // even short reels and tripping the renders bucket cap.
      crf: 23,
      outputLocation: outputAbs,
      inputProps,
      onProgress: ({ progress: p }) => {
        const pct = Math.floor(p * 100)
        if (pct !== lastPercent && pct % 5 === 0) {
          progress({ stage: 'render', pct })
          lastPercent = pct
        }
      },
    })

    return {
      outputPath: outputAbs,
      durationSeconds,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      bpm: detectedBpm,
    }
  } finally {
    rmSync(publicDir, { recursive: true, force: true })
  }
}

export function deriveTitle(audioPath: string): string {
  const base = basename(audioPath)
  const withoutExt = base.replace(/\.[^.]+$/, '')
  const withoutVersion = withoutExt.replace(/-v\d+$/i, '')
  const cleaned = withoutVersion.replace(/[-_]+/g, ' ').trim()
  return toTitleCase(cleaned)
}

const TITLE_CASE_LOWERCASE = new Set([
  'a', 'an', 'the',
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up', 'via', 'with', 'from', 'into', 'onto', 'over',
])

function toTitleCase(s: string): string {
  const words = s.split(/\s+/)
  return words
    .map((word, i) => {
      if (word.length === 0) return word
      const lower = word.toLowerCase()
      const isFirst = i === 0
      const isLast = i === words.length - 1
      if (!isFirst && !isLast && TITLE_CASE_LOWERCASE.has(lower)) return lower
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

async function resolveClipSelections(opts: {
  explicitClips: string[]
  clipsFolder: string | undefined
  outputDurationsSeconds: number[]
  slowmo: number
  seed: number | undefined
  progress: (info: { stage: string; message?: string }) => void
}): Promise<SelectedClip[]> {
  if (opts.explicitClips.length > 0) {
    if (opts.explicitClips.length !== opts.outputDurationsSeconds.length) {
      throw new Error(
        `Explicit clip count (${opts.explicitClips.length}) does not match number of slots ` +
          `(${opts.outputDurationsSeconds.length}). Adjust clips or numClips.`,
      )
    }
    return opts.explicitClips.map((path, i) => ({
      path,
      sourceStartSeconds: 0,
      outputDurationSeconds: opts.outputDurationsSeconds[i],
    }))
  }
  if (!opts.clipsFolder) {
    throw new Error('Either explicitClipPaths or clipsFolder must be provided.')
  }
  opts.progress({ stage: 'select', message: `Auto-selecting clips from "${opts.clipsFolder}"...` })
  const candidates = await discoverClips(opts.clipsFolder)
  if (candidates.length === 0) {
    throw new Error(`No video files found in ${opts.clipsFolder}`)
  }
  const random = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random
  return selectClips(candidates, {
    outputDurationsSeconds: opts.outputDurationsSeconds,
    slowmo: opts.slowmo,
    random,
  })
}

function preprocessClip(
  sourcePath: string,
  outputPath: string,
  outputDurationSeconds: number,
  fps: number,
  slowmo: number,
  sourceStartSeconds: number,
  cropFilter: string,
): Promise<void> {
  const sourceDurationSeconds = outputDurationSeconds * slowmo
  const setptsFactor = 1 / slowmo
  const setptsFilter = slowmo === 1 ? '' : `setpts=${setptsFactor}*PTS,`
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-ss', String(sourceStartSeconds),
      '-t', String(sourceDurationSeconds),
      '-i', sourcePath,
      '-vf', `${setptsFilter}${cropFilter}`,
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-an',
      '-movflags', '+faststart',
      outputPath,
    ])
    let stderr = ''
    ff.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    ff.on('error', (err) => reject(new Error(`ffmpeg failed to start: ${err.message}`)))
    ff.on('close', (code) => {
      if (code === 0) resolve()
      else {
        const tail = stderr.trim().split('\n').slice(-4).join(' | ')
        reject(new Error(`ffmpeg pre-processing failed (exit ${code}): ${tail}`))
      }
    })
  })
}
