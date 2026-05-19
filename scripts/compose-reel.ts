import { config as loadEnv } from 'dotenv'
import { basename } from 'node:path'
import { z } from 'zod'
import { composeReel } from './lib/compose'
import {
  createQueuedRender,
  markRenderStatus,
  uploadRenderOutput,
} from './lib/persist-render'
import { ASPECT_RATIOS, type AspectRatio } from './remotion/aspect-ratios'
import { TRANSITIONS, type Transition } from './remotion/transitions'
import { createAdminClient, readAdminConfigFromEnv } from './lib/supabase-admin'

loadEnv({ path: '.env', quiet: true })
loadEnv({ path: '.env.local', override: true, quiet: true })

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
    aspectRatio: z.enum(ASPECT_RATIOS as readonly [AspectRatio, ...AspectRatio[]]).default('9x16'),
    transition: z.enum(TRANSITIONS as readonly [Transition, ...Transition[]]).default('cut'),
    wordmark: z.string().default('assets/illutible-wordmark.png'),
    artistId: z.string().uuid().optional(),
    trackId: z.string().uuid().optional(),
    hookId: z.string().uuid().optional(),
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
  --noAlign=true       Skip beat alignment entirely.
  --title=TEXT         Track title to show at the start.
  --artist=NAME        Artist wordmark text. Default: illutible.
  --cta=TEXT           End-card CTA. Default: illutible.com.
  --noOverlays=true    Skip brand overlays.
  --slowmo=N           Play clips at N times speed. Default: 1.0.
  --aspectRatio=R      Output format: 9x16 | 1x1 | 4x5 | 16x9. Default: 9x16.
  --transition=T       Inter-clip transition: cut | crossfade | fade-black.
                       Default: cut.
  --wordmark=PATH      Path to artist wordmark PNG.

Persistence (optional — needs SUPABASE_SERVICE_ROLE_KEY in env):
  --artistId=UUID      Persist a row in the renders table for this artist.
  --trackId=UUID       Link the render to a track row.
  --hookId=UUID        Link the render to a hook row.

Examples:
  # Explicit clip list
  npm run reel:compose -- --audio=tracks/Hope-v9.wav --hook=2:05-2:30 \\
                          --clips=clips/a.mp4,clips/b.mp4 --output=out/hope.mp4

  # Auto-select from folder, persist to Supabase
  npm run reel:compose -- --audio=tracks/Hope-v9.wav --hook=2:05-2:30 \\
                          --clipsFolder="clips/Drone clips" --output=out/hope.mp4 \\
                          --artistId=$ARTIST_ID
`)
}

async function main(): Promise<void> {
  const args = parseArgs()
  const { start, end } = parseHook(args.hook)

  const explicitClips =
    args.clips
      ?.split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0) ?? []

  const persistence = args.artistId ? preparePersistence(args.artistId) : null

  let renderId: string | undefined
  if (persistence) {
    const created = await createQueuedRender(persistence.client, {
      artistId: persistence.artistId,
      trackId: args.trackId,
      hookId: args.hookId,
      templateId: 'basic-reel',
      aspectRatio: args.aspectRatio,
    })
    renderId = created.id
    await markRenderStatus(persistence.client, renderId, { status: 'rendering' })
    console.log(`Render row created: ${renderId} (status=rendering)`)
  }

  try {
    const result = await composeReel({
      audioPath: args.audio,
      hookStartSeconds: start,
      hookEndSeconds: end,
      outputPath: args.output,
      explicitClipPaths: explicitClips,
      clipsFolder: args.clipsFolder,
      numClips: args.numClips,
      seed: args.seed,
      fps: args.fps,
      bpm: args.bpm,
      beatsPerBar: args.beatsPerBar,
      downbeatOffsetSeconds: args.downbeatOffset,
      noAlign: args.noAlign,
      title: args.title,
      artistName: args.artist,
      cta: args.cta,
      noOverlays: args.noOverlays,
      slowmo: args.slowmo,
      aspectRatio: args.aspectRatio,
      transition: args.transition,
      wordmarkPath: args.wordmark,
      onProgress: ({ stage, pct, message }) => {
        if (pct !== undefined) console.log(`  [${stage}] ${pct}%`)
        else if (message) console.log(`[${stage}] ${message}`)
      },
    })

    console.log(`Rendered ${basename(result.outputPath)} -> ${result.outputPath}`)

    if (persistence && renderId) {
      console.log(`Uploading render to Supabase Storage...`)
      const upload = await uploadRenderOutput(persistence.client, {
        artistId: persistence.artistId,
        renderId,
        outputPath: result.outputPath,
      })
      await markRenderStatus(persistence.client, renderId, {
        status: 'ready',
        output_url: upload.publicUrl,
      })
      console.log(`Render ready: ${upload.publicUrl}`)
    }
  } catch (err) {
    if (persistence && renderId) {
      const message = err instanceof Error ? err.message : String(err)
      await markRenderStatus(persistence.client, renderId, {
        status: 'failed',
        error: message.slice(0, 500),
      }).catch(() => {})
    }
    throw err
  }
}

function preparePersistence(artistId: string) {
  const config = readAdminConfigFromEnv()
  if (!config) {
    throw new Error(
      '--artistId requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
    )
  }
  return { client: createAdminClient(config), artistId }
}

main().catch((err: unknown) => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
