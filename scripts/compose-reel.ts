import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve as resolvePath } from 'node:path'
import { z } from 'zod'
import { planBeatAlignedCuts } from './lib/beat-alignment'
import { discoverClips, mulberry32, selectClips, type SelectedClip } from './lib/clip-selection'
import { detectTempo } from './lib/tempo-detection'
import type { BasicReelProps } from './remotion/BasicReel'

const argsSchema = z
  .object({
    audio: z.string().min(1),
    hook: z.string().regex(/^(\d+:\d{1,2}|\d+(?:\.\d+)?)-(\d+:\d{1,2}|\d+(?:\.\d+)?)$/, {
      message: 'Format: "MM:SS-MM:SS" or "SS-SS"',
    }),
    clips: z.string().optional(),
    clipsFolder: z.string().optional(),
    numClips: z.coerce.number().int().positive().max(20).optional(),
    seed: z.coerce.number().int().optional(),
    output: z.string().min(1),
    fps: z.coerce.number().int().positive().default(30),
    bpm: z.coerce.number().positive().optional(),
    beatsPerBar: z.coerce.number().int().positive().default(4),
    downbeatOffset: z.coerce.number().min(0).optional(),
    noAlign: z.coerce.boolean().default(false),
    title: z.string().optional(),
    artist: z.string().default('illutible'),
    cta: z.string().default('illutible.com'),
    noOverlays: z.coerce.boolean().default(false),
    slowmo: z.coerce.number().positive().max(2).default(1),
    wordmark: z.string().default('assets/illutible-wordmark.png'),
  })
  .refine((v) => v.clips || v.clipsFolder, {
    message: 'Provide either --clips=<paths> or --clipsFolder=<folder>',
  })

type Args = z.infer<typeof argsSchema>

function parseTime(s: string): number {
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(Number)
    return m * 60 + sec
  }
  return Number(s)
}

function parseHook(s: string): { start: number; end: number } {
  const [startStr, endStr] = s.split('-')
  const start = parseTime(startStr)
  const end = parseTime(endStr)
  if (end <= start) {
    throw new Error(`Hook end (${endStr}) must be after start (${startStr})`)
  }
  return { start, end }
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage()
    process.exit(argv.length === 0 ? 1 : 0)
  }
  const raw: Record<string, string> = {}
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.+)$/)
    if (m) raw[m[1]] = m[2]
  }
  const parsed = argsSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('Invalid arguments:')
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }
  return parsed.data
}

function printUsage(): void {
  console.log(`Compose a 9:16 reel from a track hook + drone clips.

Usage:
  npm run reel:compose -- --audio=<path> --hook=<MM:SS-MM:SS> --clips=<paths> --output=<path>

Required:
  --audio=PATH         Path to the source audio file.
  --hook=START-END     Hook range, e.g. 2:05-2:30 or 125-150 (seconds).
  --output=PATH        Output MP4 path.

Clips (one of):
  --clips=PATHS        Comma-separated list of clip paths (explicit).
  --clipsFolder=PATH   Folder to auto-select clips from (recursive).
  --numClips=N         Number of clips to auto-select. Default: based on
                       hook duration (~1 clip per 7s, min 3).
  --seed=N             RNG seed for reproducible auto-selection.

Optional:
  --fps=N              Render frame rate. Default: 30.
  --bpm=N              Beats per minute. Overrides auto-detection.
  --beatsPerBar=N      Time signature beats per bar. Default: 4.
  --downbeatOffset=S   Seconds from hook start to first downbeat.
                       Overrides auto-detection.
  --noAlign=true       Skip beat alignment entirely (even-distribution cuts).
  --title=TEXT         Track title to show at the start. Auto-derived from
                       audio filename if omitted (e.g. Hope-v9.wav -> Hope).
  --artist=NAME        Artist wordmark text. Default: illutible.
  --cta=TEXT           End-card call-to-action text. Default: illutible.com.
  --noOverlays=true    Skip brand overlays entirely (clean footage only).
  --slowmo=N           Play clips at N times speed. 1.0 = normal, 0.5 = half
                       speed (good for 60fps source). Default: 1.0.
  --wordmark=PATH      Path to artist wordmark PNG (transparent background).
                       Default: assets/illutible-wordmark.png.

Beat alignment is on by default. BPM and downbeat phase are auto-detected
from the hook range. Use --bpm and --downbeatOffset to override.

Examples:
  # Explicit clip list
  npm run reel:compose -- --audio=tracks/Hope-v9.wav --hook=2:05-2:30 \\
                          --clips=clips/a.mp4,clips/b.mp4 --output=out/hope.mp4

  # Auto-select from folder
  npm run reel:compose -- --audio=tracks/Hope-v9.wav --hook=2:05-2:30 \\
                          --clipsFolder="clips/Drone clips" --output=out/hope.mp4
`)
}

async function main(): Promise<void> {
  const args = parseArgs()
  const { start, end } = parseHook(args.hook)
  const durationSeconds = end - start

  const audioAbs = resolvePath(args.audio)
  if (!existsSync(audioAbs)) throw new Error(`Audio not found: ${audioAbs}`)

  const explicitClips =
    args.clips
      ?.split(',')
      .map((c) => resolvePath(c.trim()))
      .filter((c) => c.length > 0) ?? []
  for (const c of explicitClips) {
    if (!existsSync(c)) throw new Error(`Clip not found: ${c}`)
  }

  const outputAbs = resolvePath(args.output)
  mkdirSync(dirname(outputAbs), { recursive: true })

  const publicDir = mkdtempSync(join(tmpdir(), 'legatograph-remotion-'))
  try {
    const audioName = `audio${extname(audioAbs) || '.wav'}`
    copyFileSync(audioAbs, join(publicDir, audioName))

    let clipDurationsSeconds: number[]
    const numClipsTarget =
      args.numClips ?? Math.max(3, Math.round(durationSeconds / 7))
    const intendedNumClips = explicitClips.length > 0 ? explicitClips.length : numClipsTarget

    if (args.noAlign) {
      const even = durationSeconds / intendedNumClips
      clipDurationsSeconds = Array.from({ length: intendedNumClips }, () => even)
      console.log(`Beat alignment disabled (--noAlign).`)
    } else {
      let bpm = args.bpm
      let downbeatOffset = args.downbeatOffset ?? 0
      const bpmSource: string[] = []
      const offsetSource: string[] = []

      if (bpm === undefined || args.downbeatOffset === undefined) {
        console.log(`Detecting tempo from hook range...`)
        const detected = await detectTempo(audioAbs, start, end, {
          beatsPerBar: args.beatsPerBar,
        })
        if (bpm === undefined) {
          bpm = detected.bpm
          bpmSource.push(`auto (${detected.bpm.toFixed(1)})`)
          if (detected.bpmAlternates.length > 0) {
            const alts = detected.bpmAlternates.map((b) => b.toFixed(0)).join(', ')
            bpmSource.push(`alternates: ${alts}`)
          }
          bpmSource.push(`confidence: ${(detected.confidence * 100).toFixed(0)}%`)
          const peaks = detected.topPeaks
            .slice(0, 5)
            .map((p) => `${p.bpm.toFixed(1)}`)
            .join(', ')
          console.log(`  Top tempo candidates: ${peaks}`)
        } else {
          bpmSource.push(`manual (${bpm})`)
        }
        if (args.downbeatOffset === undefined) {
          downbeatOffset = detected.downbeatOffsetSeconds
          offsetSource.push(`auto (${detected.downbeatOffsetSeconds.toFixed(3)}s)`)
        } else {
          offsetSource.push(`manual (${args.downbeatOffset}s)`)
        }
      } else {
        bpmSource.push(`manual (${bpm})`)
        offsetSource.push(`manual (${args.downbeatOffset}s)`)
      }

      const plan = planBeatAlignedCuts({
        durationSeconds,
        bpm,
        beatsPerBar: args.beatsPerBar,
        downbeatOffsetSeconds: downbeatOffset,
        numClips: intendedNumClips,
      })
      clipDurationsSeconds = plan.clipDurationsSeconds
      console.log(`BPM: ${bpmSource.join(', ')}`)
      console.log(`Downbeat offset: ${offsetSource.join(', ')}`)
      console.log(
        `Bar duration: ${plan.barDurationSeconds.toFixed(3)}s (${args.beatsPerBar}/4 @ ${bpm.toFixed(1)} BPM)`,
      )
      if (plan.cutSeconds.length > 0) {
        console.log(`Cuts at: ${plan.cutSeconds.map((c) => `${c.toFixed(2)}s`).join(', ')}`)
      }
      console.log(
        `Clip durations: ${clipDurationsSeconds.map((d) => `${d.toFixed(2)}s`).join(', ')}`,
      )
    }

    const selections: SelectedClip[] = await resolveClipSelections({
      explicitClips,
      clipsFolder: args.clipsFolder,
      outputDurationsSeconds: clipDurationsSeconds,
      slowmo: args.slowmo,
      seed: args.seed,
    })

    const speedDescription = args.slowmo === 1 ? '' : ` (${args.slowmo}x speed)`
    console.log(
      `Pre-processing ${selections.length} clip(s) to 1080x1920 @ ${args.fps}fps${speedDescription}...`,
    )
    const clipNames: string[] = []
    for (let i = 0; i < selections.length; i++) {
      const sel = selections[i]
      const outName = `clip${i}.mp4`
      const outPath = join(publicDir, outName)
      const startMs = Date.now()
      await preprocessClip(
        sel.path,
        outPath,
        sel.outputDurationSeconds,
        args.fps,
        args.slowmo,
        sel.sourceStartSeconds,
      )
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
      const startNote =
        sel.sourceStartSeconds > 0 ? ` from ${formatSeconds(sel.sourceStartSeconds)}` : ''
      console.log(
        `  [${i + 1}/${selections.length}] ${basename(sel.path)}${startNote} -> ${outName} ` +
          `(${sel.outputDurationSeconds.toFixed(2)}s output, ${elapsed}s real)`,
      )
      clipNames.push(outName)
    }

    let wordmarkName: string | undefined
    if (!args.noOverlays) {
      const wordmarkPath = resolvePath(args.wordmark)
      if (existsSync(wordmarkPath)) {
        wordmarkName = 'wordmark.png'
        copyFileSync(wordmarkPath, join(publicDir, wordmarkName))
        console.log(`Brand: using wordmark ${basename(wordmarkPath)}`)
      } else {
        console.log(`Brand: wordmark not found at ${wordmarkPath}, falling back to text`)
      }
    }

    const fontsDir = resolvePath('assets/fonts')
    if (existsSync(fontsDir)) {
      const { readdirSync } = await import('node:fs')
      const fontFiles = readdirSync(fontsDir).filter((f) =>
        /\.(ttf|otf|woff2?)$/i.test(f) && !f.startsWith('.'),
      )
      for (const f of fontFiles) {
        copyFileSync(join(fontsDir, f), join(publicDir, f))
      }
      if (fontFiles.length > 0) {
        console.log(`Brand: copied ${fontFiles.length} font file(s) from assets/fonts`)
      }
    }

    const inputProps: BasicReelProps = {
      audioFile: audioName,
      audioStartSeconds: start,
      durationSeconds,
      clipFiles: clipNames,
      clipDurationsSeconds,
      trackTitle: args.noOverlays ? '' : (args.title ?? deriveTitle(args.audio)),
      artistName: args.artist,
      ctaText: args.noOverlays ? '' : args.cta,
      wordmarkFile: wordmarkName,
    }

    console.log(`Bundling Remotion project...`)
    const bundleLocation = await bundle({
      entryPoint: resolvePath('scripts/remotion/index.ts'),
      publicDir,
    })

    console.log(`Selecting composition...`)
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'BasicReel',
      inputProps,
    })

    console.log(
      `Rendering ${composition.width}x${composition.height} ` +
        `@ ${composition.fps}fps for ${composition.durationInFrames} frames ` +
        `(${(composition.durationInFrames / composition.fps).toFixed(1)}s)...`,
    )

    const startMs = Date.now()
    let lastPercent = -1
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputAbs,
      inputProps,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100)
        if (pct !== lastPercent && pct % 5 === 0) {
          console.log(`  ${pct}%`)
          lastPercent = pct
        }
      },
    })
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
    console.log(`Rendered ${basename(outputAbs)} in ${elapsed}s -> ${outputAbs}`)
  } finally {
    rmSync(publicDir, { recursive: true, force: true })
  }
}

function deriveTitle(audioPath: string): string {
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

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

async function resolveClipSelections(opts: {
  explicitClips: string[]
  clipsFolder: string | undefined
  outputDurationsSeconds: number[]
  slowmo: number
  seed: number | undefined
}): Promise<SelectedClip[]> {
  if (opts.explicitClips.length > 0) {
    if (opts.explicitClips.length !== opts.outputDurationsSeconds.length) {
      throw new Error(
        `Explicit clip count (${opts.explicitClips.length}) does not match number of slots ` +
          `(${opts.outputDurationsSeconds.length}). Adjust --clips or --numClips.`,
      )
    }
    return opts.explicitClips.map((path, i) => ({
      path,
      sourceStartSeconds: 0,
      outputDurationSeconds: opts.outputDurationsSeconds[i],
    }))
  }
  if (!opts.clipsFolder) {
    throw new Error('Either --clips or --clipsFolder must be provided.')
  }
  console.log(`Auto-selecting clips from "${opts.clipsFolder}"...`)
  const candidates = await discoverClips(opts.clipsFolder)
  if (candidates.length === 0) {
    throw new Error(`No video files found in ${opts.clipsFolder}`)
  }
  console.log(
    `  Found ${candidates.length} candidate clip(s) (longest: ${Math.max(
      ...candidates.map((c) => c.durationSeconds),
    ).toFixed(1)}s, shortest: ${Math.min(...candidates.map((c) => c.durationSeconds)).toFixed(1)}s)`,
  )
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
  slowmo: number = 1,
  sourceStartSeconds: number = 0,
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
      '-vf', `${setptsFilter}scale=-2:1920:flags=lanczos,crop=1080:1920,setsar=1`,
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

main().catch((err: unknown) => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
