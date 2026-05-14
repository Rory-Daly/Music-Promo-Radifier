import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { z } from 'zod'

loadEnv({ path: '.env', quiet: true })
loadEnv({ path: '.env.local', override: true, quiet: true })
import {
  analysisToEnergyCurve,
  extractTrackId,
  fetchAudioAnalysis,
  getSpotifyToken,
} from './lib/spotify'
import { analyseLocalAudio } from './lib/local-analysis'
import { findTopHooks, type EnergyCurve } from './lib/scoring'

const argsSchema = z.object({
  input: z.string().min(1),
  source: z.enum(['spotify', 'local']).optional(),
  count: z.coerce.number().int().positive().max(20).default(5),
  minDuration: z.coerce.number().positive().default(15),
  maxDuration: z.coerce.number().positive().default(30),
})

type Args = z.infer<typeof argsSchema>

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage()
    process.exit(argv.length === 0 ? 1 : 0)
  }
  const raw: Record<string, string> = { input: argv[0] }
  for (const arg of argv.slice(1)) {
    const match = arg.match(/^--([^=]+)=(.+)$/)
    if (match) raw[match[1]] = match[2]
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
  console.log(`Detect the most reel-worthy hooks in a track.

Usage:
  npm run hooks:detect -- <spotify-id|spotify-url|path-to-audio> [flags]

Flags:
  --source=spotify|local   Force source. Default: auto-detect (path → local, otherwise → spotify).
  --count=N                Number of hook candidates to return. Default: 5.
  --minDuration=SECONDS    Minimum hook duration. Default: 15.
  --maxDuration=SECONDS    Maximum hook duration. Default: 30.

Examples:
  npm run hooks:detect -- https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh
  npm run hooks:detect -- ./tracks/forgotten-man.wav --count=3
`)
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function inferSource(input: string): 'spotify' | 'local' {
  return existsSync(resolvePath(input)) ? 'local' : 'spotify'
}

async function loadCurve(args: Args): Promise<{ curve: EnergyCurve; meta: string }> {
  const source = args.source ?? inferSource(args.input)
  if (source === 'spotify') {
    const clientId = process.env.SPOTIFY_CLIENT_ID
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error(
        'SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env.local (see .env.example).',
      )
    }
    const trackId = extractTrackId(args.input)
    const token = await getSpotifyToken(clientId, clientSecret)
    const analysis = await fetchAudioAnalysis(trackId, token)
    const curve = analysisToEnergyCurve(analysis)
    return {
      curve,
      meta: `Spotify ${trackId} — ${formatTime(analysis.track.duration)} @ ${analysis.track.tempo.toFixed(1)} BPM`,
    }
  }
  const path = resolvePath(args.input)
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`)
  }
  const curve = await analyseLocalAudio(path)
  return { curve, meta: `Local file — ${formatTime(curve.durationSeconds)}` }
}

async function main(): Promise<void> {
  const args = parseArgs()
  const { curve, meta } = await loadCurve(args)

  const hooks = findTopHooks(curve, {
    count: args.count,
    minDuration: args.minDuration,
    maxDuration: args.maxDuration,
  })

  console.log(meta)
  console.log('')

  if (hooks.length === 0) {
    console.log('No hook candidates found (track too short for the configured min/max duration).')
    return
  }

  console.log(`Top ${hooks.length} hook candidates:`)
  console.log('')
  for (const [i, h] of hooks.entries()) {
    const sign = h.contrast >= 0 ? '+' : ''
    console.log(
      `${String(i + 1).padStart(2)}. ${formatTime(h.startSeconds)}–${formatTime(h.endSeconds)} ` +
        `(${h.durationSeconds.toFixed(0)}s) — ${h.label.padEnd(14)} ` +
        `score=${h.score.toFixed(3)}  energy=${h.meanEnergy.toFixed(3)}  contrast=${sign}${h.contrast.toFixed(3)}`,
    )
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
