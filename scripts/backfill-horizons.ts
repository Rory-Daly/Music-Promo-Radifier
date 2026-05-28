/**
 * One-shot backfill: detect the horizon Y ratio for every clip in the
 * clips table whose horizon_y_ratio is still null, and write the result
 * back to the row.
 *
 * Usage:
 *   npx tsx scripts/backfill-horizons.ts                 # all artists, all sources
 *   npx tsx scripts/backfill-horizons.ts --artist=<uuid> # one artist
 *   npx tsx scripts/backfill-horizons.ts --limit=20      # cap how many we process
 *   npx tsx scripts/backfill-horizons.ts --source=gdrive # only drive clips (or 'upload')
 *
 * Required env (loaded from .env / .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   GOOGLE_API_KEY  (optional — only for public Drive folders)
 *
 * Drive clips with no API key and no per-artist OAuth token are skipped
 * with a warning rather than failing the whole run.
 */
import { config as loadEnv } from 'dotenv'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

loadEnv({ path: '.env', quiet: true })
loadEnv({ path: '.env.local', override: true, quiet: true })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { detectHorizon } from './lib/horizon-detect'
import { downloadDriveFile, type DriveAuth } from '../src/lib/gdrive/api'

const argsSchema = z.object({
  artist: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  source: z.enum(['upload', 'gdrive']).optional(),
})

type ClipRow = {
  id: string
  artist_id: string
  source: 'upload' | 'gdrive'
  storage_url: string | null
  gdrive_file_id: string | null
  duration_seconds: number | null
  name: string | null
}

function parseArgs(): z.infer<typeof argsSchema> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`See file header for usage.\n`)
    process.exit(0)
  }
  const raw: Record<string, string> = {}
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.+)$/)
    if (m) raw[m[1]] = m[2]
  }
  const parsed = argsSchema.safeParse(raw)
  if (!parsed.success) {
    process.stderr.write('Invalid arguments:\n')
    for (const issue of parsed.error.issues) {
      process.stderr.write(`  - ${issue.path.join('.')}: ${issue.message}\n`)
    }
    process.exit(1)
  }
  return parsed.data
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    process.stderr.write(`Missing required env: ${name}\n`)
    process.exit(1)
  }
  return v
}

function parseStoragePath(value: string | null): { bucket: string; path: string } | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.startsWith('http')) {
    const m = trimmed.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/)
    return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
  }
  const slash = trimmed.indexOf('/')
  return slash > 0
    ? { bucket: trimmed.slice(0, slash), path: trimmed.slice(slash + 1) }
    : null
}

async function downloadSupabaseClip(
  client: SupabaseClient,
  storageUrl: string | null,
  workDir: string,
  baseName: string,
): Promise<string | null> {
  const ref = parseStoragePath(storageUrl)
  if (!ref) return null
  const { data, error } = await client.storage.from(ref.bucket).download(ref.path)
  if (error || !data) return null
  const buffer = Buffer.from(await data.arrayBuffer())
  const ext = ref.path.match(/\.[^.]+$/)?.[0] ?? '.mp4'
  const out = join(workDir, `${baseName}${ext}`)
  writeFileSync(out, buffer)
  return out
}

async function downloadDriveClip(
  fileId: string,
  auth: DriveAuth,
  workDir: string,
  baseName: string,
): Promise<string> {
  const { body } = await downloadDriveFile(fileId, auth)
  const out = join(workDir, `${baseName}.mp4`)
  // Pipe the web stream into a file. Buffering the whole clip in memory
  // is fine here — backfill is a one-shot batch job, not a hot path.
  const reader = body.getReader()
  const chunks: Buffer[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(Buffer.from(value))
  }
  writeFileSync(out, Buffer.concat(chunks))
  return out
}

async function main(): Promise<void> {
  const args = parseArgs()
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const apiKey = process.env.GOOGLE_API_KEY ?? null
  const driveAuth: DriveAuth | null = apiKey ? { kind: 'apiKey', apiKey } : null

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let query = client
    .from('clips')
    .select('id, artist_id, source, storage_url, gdrive_file_id, duration_seconds, name')
    .is('horizon_y_ratio', null)
    .order('created_at', { ascending: true })

  if (args.artist) query = query.eq('artist_id', args.artist)
  if (args.source) query = query.eq('source', args.source)
  if (args.limit) query = query.limit(args.limit)

  const { data: rows, error } = await query
  if (error) {
    process.stderr.write(`Query failed: ${error.message}\n`)
    process.exit(1)
  }
  const clips = (rows ?? []) as ClipRow[]
  if (clips.length === 0) {
    process.stdout.write('No clips need horizon backfill.\n')
    return
  }

  process.stdout.write(`Backfilling ${clips.length} clip(s)…\n`)

  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-horizon-backfill-'))
  let success = 0
  let skipped = 0
  let failed = 0
  try {
    for (const clip of clips) {
      const label = clip.name ?? clip.id.slice(0, 8)
      try {
        let localPath: string | null = null
        if (clip.source === 'upload') {
          localPath = await downloadSupabaseClip(client, clip.storage_url, workDir, clip.id)
          if (!localPath) {
            process.stdout.write(`  skip: ${label} — no storage_url\n`)
            skipped++
            continue
          }
        } else {
          if (!clip.gdrive_file_id) {
            process.stdout.write(`  skip: ${label} — no gdrive_file_id\n`)
            skipped++
            continue
          }
          if (!driveAuth) {
            process.stdout.write(
              `  skip: ${label} — no GOOGLE_API_KEY in env (drive clip)\n`,
            )
            skipped++
            continue
          }
          localPath = await downloadDriveClip(clip.gdrive_file_id, driveAuth, workDir, clip.id)
        }

        const duration = clip.duration_seconds ?? 0
        const result = await detectHorizon(localPath, duration)
        if (result.ratio == null) {
          process.stdout.write(`  skip: ${label} — no confident horizon\n`)
          skipped++
        } else {
          const { error: updateError } = await client
            .from('clips')
            .update({ horizon_y_ratio: result.ratio })
            .eq('id', clip.id)
          if (updateError) {
            process.stdout.write(`  fail: ${label} — update: ${updateError.message}\n`)
            failed++
          } else {
            process.stdout.write(`  ok:   ${label} → ${result.ratio.toFixed(3)}\n`)
            success++
          }
        }

        if (existsSync(localPath)) rmSync(localPath, { force: true })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        process.stdout.write(`  fail: ${label} — ${message}\n`)
        failed++
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }

  process.stdout.write(
    `Done. ${success} updated, ${skipped} skipped, ${failed} failed.\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
