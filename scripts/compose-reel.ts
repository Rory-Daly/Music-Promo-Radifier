import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve as resolvePath } from 'node:path'
import { z } from 'zod'
import { planBeatAlignedCuts } from './lib/beat-alignment'
import { detectTempo } from './lib/tempo-detection'
import type { BasicReelProps } from './remotion/BasicReel'

const argsSchema = z.object({
  audio: z.string().min(1),
  hook: z.string().regex(/^(\d+:\d{1,2}|\d+(?:\.\d+)?)-(\d+:\d{1,2}|\d+(?:\.\d+)?)$/, {
    message: 'Format: "MM:SS-MM:SS" or "SS-SS"',
  }),
  clips: z.string().min(1),
  output: z.string().min(1),
  fps: z.coerce.number().int().positive().default(30),
  bpm: z.coerce.number().positive().optional(),
  beatsPerBar: z.coerce.number().int().positive().default(4),
  downbeatOffset: z.coerce.number().min(0).optional(),
  noAlign: z.coerce.boolean().default(false),
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

Required flags:
  --audio=PATH         Path to the source audio file.
  --hook=START-END     Hook range, e.g. 2:05-2:30 or 125-150 (seconds).
  --clips=PATHS        Comma-separated list of clip paths.
  --output=PATH        Output MP4 path.

Optional:
  --fps=N              Render frame rate. Default: 30.
  --bpm=N              Beats per minute. Overrides auto-detection.
  --beatsPerBar=N      Time signature beats per bar. Default: 4.
  --downbeatOffset=S   Seconds from hook start to first downbeat.
                       Overrides auto-detection.
  --noAlign=true       Skip beat alignment entirely (even-distribution cuts).

Beat alignment is on by default. BPM and downbeat phase are auto-detected
from the hook range. Use --bpm and --downbeatOffset to override.

Example:
  npm run reel:compose -- --audio=tracks/Hope-v9.wav --hook=2:05-2:30 \\
                          --clips=clips/a.mp4,clips/b.mp4 --output=out/hope.mp4
`)
}

async function main(): Promise<void> {
  const args = parseArgs()
  const { start, end } = parseHook(args.hook)
  const durationSeconds = end - start

  const audioAbs = resolvePath(args.audio)
  if (!existsSync(audioAbs)) throw new Error(`Audio not found: ${audioAbs}`)

  const clipAbsList = args.clips.split(',').map((c) => resolvePath(c.trim())).filter((c) => c.length > 0)
  if (clipAbsList.length === 0) throw new Error('No clips provided.')
  for (const c of clipAbsList) {
    if (!existsSync(c)) throw new Error(`Clip not found: ${c}`)
  }

  const outputAbs = resolvePath(args.output)
  mkdirSync(dirname(outputAbs), { recursive: true })

  const publicDir = mkdtempSync(join(tmpdir(), 'mpr-remotion-'))
  try {
    const audioName = `audio${extname(audioAbs) || '.wav'}`
    copyFileSync(audioAbs, join(publicDir, audioName))

    let clipDurationsSeconds: number[]
    if (args.noAlign) {
      const even = durationSeconds / clipAbsList.length
      clipDurationsSeconds = clipAbsList.map(() => even)
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
        numClips: clipAbsList.length,
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

    console.log(`Pre-processing ${clipAbsList.length} clip(s) to 1080x1920 @ ${args.fps}fps...`)
    const clipNames: string[] = []
    for (let i = 0; i < clipAbsList.length; i++) {
      const sourcePath = clipAbsList[i]
      const outName = `clip${i}.mp4`
      const outPath = join(publicDir, outName)
      const startMs = Date.now()
      await preprocessClip(sourcePath, outPath, clipDurationsSeconds[i], args.fps)
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
      console.log(
        `  [${i + 1}/${clipAbsList.length}] ${basename(sourcePath)} -> ${outName} ` +
          `(${clipDurationsSeconds[i].toFixed(2)}s, ${elapsed}s real)`,
      )
      clipNames.push(outName)
    }

    const inputProps: BasicReelProps = {
      audioFile: audioName,
      audioStartSeconds: start,
      durationSeconds,
      clipFiles: clipNames,
      clipDurationsSeconds,
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

function preprocessClip(
  sourcePath: string,
  outputPath: string,
  durationSeconds: number,
  fps: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-ss', '0',
      '-i', sourcePath,
      '-t', String(durationSeconds),
      '-vf', `scale=-2:1920:flags=lanczos,crop=1080:1920,setsar=1`,
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
