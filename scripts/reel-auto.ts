import { config as loadEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { analyseLocalAudio } from './lib/local-analysis'
import { findTopHooks } from './lib/scoring'

loadEnv({ path: '.env', quiet: true })
loadEnv({ path: '.env.local', override: true, quiet: true })

const ownArgsSchema = z.object({
  audio: z.string().min(1),
  hookIndex: z.coerce.number().int().min(0).max(10).default(0),
  hookMin: z.coerce.number().positive().default(45),
  hookMax: z.coerce.number().positive().default(75),
})

type OwnArgs = z.infer<typeof ownArgsSchema>

const OWN_FLAGS = new Set(['hookIndex', 'hookMin', 'hookMax'])

function parseOwnAndPassthrough(): { own: OwnArgs; passthrough: string[] } {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage()
    process.exit(argv.length === 0 ? 1 : 0)
  }
  const raw: Record<string, string> = {}
  const passthrough: string[] = []
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.+)$/)
    if (!match) {
      passthrough.push(arg)
      continue
    }
    const [, key, value] = match
    if (OWN_FLAGS.has(key)) {
      raw[key] = value
    } else if (key === 'audio') {
      raw[key] = value
      passthrough.push(arg)
    } else if (key === 'hook') {
      console.error('reel:auto detects the hook itself; use `npm run reel:compose` for manual --hook.')
      process.exit(1)
    } else {
      passthrough.push(arg)
    }
  }
  const parsed = ownArgsSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('Invalid arguments:')
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }
  return { own: parsed.data, passthrough }
}

function printUsage(): void {
  console.log(`Auto-compose: detect the top hook in a track, then render the reel.

Usage:
  npm run reel:auto -- --audio=PATH --output=PATH [--clipsFolder=PATH | --clips=PATHS] [...]

Required:
  --audio=PATH         Path to the source audio file.
  --output=PATH        Output MP4 path.

Auto-hook flags (this script):
  --hookIndex=N        Pick the Nth-best hook (0=top). Default: 0.
  --hookMin=SECONDS    Minimum hook duration. Default: 45.
  --hookMax=SECONDS    Maximum hook duration. Default: 75.

All other reel:compose flags are forwarded unchanged. See
\`npm run reel:compose -- --help\` for the full list (clips selection,
slowmo, BPM, brand overlays, font, etc.).

Example:
  npm run reel:auto -- --audio=tracks/Hope-v9.wav \\
                       --clipsFolder="clips/Drone clips" \\
                       --output=out/hope-auto.mp4 \\
                       --slowmo=0.5 --seed=1
`)
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

async function main(): Promise<void> {
  const { own, passthrough } = parseOwnAndPassthrough()

  const audioAbs = resolvePath(own.audio)
  if (!existsSync(audioAbs)) {
    throw new Error(`Audio not found: ${audioAbs}`)
  }

  console.log(`Detecting hooks in ${own.audio}...`)
  const curve = await analyseLocalAudio(audioAbs)
  const hooks = findTopHooks(curve, {
    count: own.hookIndex + 3,
    minDuration: own.hookMin,
    maxDuration: own.hookMax,
  })
  if (hooks.length === 0) {
    throw new Error('No hooks detected — track may be too short or have no contrast.')
  }
  if (own.hookIndex >= hooks.length) {
    throw new Error(
      `Only ${hooks.length} candidate hook(s) found; --hookIndex=${own.hookIndex} is out of range.`,
    )
  }
  const chosen = hooks[own.hookIndex]
  console.log(
    `  Selected hook #${own.hookIndex + 1}: ` +
      `${formatTime(chosen.startSeconds)}–${formatTime(chosen.endSeconds)} ` +
      `(${chosen.durationSeconds.toFixed(0)}s, ${chosen.label}, score=${chosen.score.toFixed(3)})`,
  )

  const hookArg = `--hook=${chosen.startSeconds.toFixed(2)}-${chosen.endSeconds.toFixed(2)}`
  const composeArgs = ['scripts/compose-reel.ts', ...passthrough, hookArg]

  const child = spawn('tsx', composeArgs, { stdio: 'inherit' })
  child.on('error', (err) => {
    console.error('Failed to launch reel:compose:', err.message)
    process.exit(1)
  })
  child.on('close', (code) => process.exit(code ?? 0))
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
