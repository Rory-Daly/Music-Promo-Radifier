import 'server-only'
import { createWriteStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { composeReel } from '../../../scripts/lib/compose'
import { markRenderStatus, uploadRenderOutput } from '../../../scripts/lib/persist-render'
import { type AspectRatio } from '../../../scripts/remotion/aspect-ratios'
import { type Transition } from '../../../scripts/remotion/transitions'
import { downloadDriveFile, type DriveAuth } from '@/lib/gdrive'

type ClipRefBase = {
  /** Clip row id — used to cache the detected horizon back to the DB. */
  id?: string
  /** Cached horizon Y ratio (0..1) from a prior render or backfill. */
  horizonYRatio?: number | null
}
export type ClipRef = ClipRefBase &
  (
    | { source: 'supabase'; bucket: string; path: string }
    | { source: 'gdrive'; fileId: string }
  )

export type RunRenderInput = {
  renderId: string
  artistId: string
  audioBucket: string
  audioPath: string
  hookStartSeconds: number
  hookEndSeconds: number
  clips: ClipRef[]
  title?: string
  cta?: string
  artistName?: string
  slowmo?: number
  noOverlays?: boolean
  aspectRatio?: AspectRatio
  transition?: Transition
  wordmarkPath?: string
  audioFadeInSeconds?: number
  audioFadeOutSeconds?: number
  videoFadeInSeconds?: number
  videoFadeOutSeconds?: number
  outroTailSeconds?: number
  driveAuth?: DriveAuth | null
}

/**
 * Runs the full render pipeline for a queued renders row:
 *   download → composeReel → upload → mark ready.
 * Updates the row to 'failed' on any error.
 *
 * Requires ffmpeg + Remotion bundling in-process — works on a Node runtime
 * (local dev, self-hosted, or a dedicated worker). Vercel hobby/serverless
 * is not currently a viable host for this end-to-end path; route this from
 * a queue worker in production.
 */
export async function runRender(client: SupabaseClient, input: RunRenderInput): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-render-'))
  try {
    await markRenderStatus(client, input.renderId, { status: 'rendering' })

    const audioLocalPath = await downloadSupabaseObjectToFile(
      client,
      input.audioBucket,
      input.audioPath,
      workDir,
      'audio',
    )

    const clipLocalPaths: string[] = []
    for (let i = 0; i < input.clips.length; i++) {
      const clip = input.clips[i]
      const path =
        clip.source === 'supabase'
          ? await downloadSupabaseObjectToFile(
              client,
              clip.bucket,
              clip.path,
              workDir,
              `clip-${i}`,
            )
          : await downloadDriveObjectToFile(
              clip.fileId,
              workDir,
              `clip-${i}`,
              input.driveAuth ?? null,
            )
      clipLocalPaths.push(path)
    }

    const cachedHorizons: (number | null)[] = input.clips.map((c) =>
      typeof c.horizonYRatio === 'number' ? c.horizonYRatio : null,
    )

    const outputPath = join(workDir, `output.mp4`)
    const result = await composeReel({
      audioPath: audioLocalPath,
      hookStartSeconds: input.hookStartSeconds,
      hookEndSeconds: input.hookEndSeconds,
      outputPath,
      explicitClipPaths: clipLocalPaths,
      title: input.title,
      cta: input.cta,
      artistName: input.artistName,
      slowmo: input.slowmo,
      noOverlays: input.noOverlays,
      aspectRatio: input.aspectRatio,
      transition: input.transition,
      wordmarkPath: input.wordmarkPath,
      audioFadeInSeconds: input.audioFadeInSeconds,
      audioFadeOutSeconds: input.audioFadeOutSeconds,
      videoFadeInSeconds: input.videoFadeInSeconds,
      videoFadeOutSeconds: input.videoFadeOutSeconds,
      outroTailSeconds: input.outroTailSeconds,
      clipHorizonRatios: cachedHorizons,
    })

    // Persist any newly-detected horizons back to the clips table so
    // the next render with the same clip uses the cache. Best-effort —
    // failures here don't fail the render.
    if (result.clipHorizonRatios) {
      await persistHorizonRatios(client, input.clips, cachedHorizons, result.clipHorizonRatios)
    }

    const upload = await uploadRenderOutput(client, {
      artistId: input.artistId,
      renderId: input.renderId,
      outputPath: result.outputPath,
    })

    await markRenderStatus(client, input.renderId, {
      status: 'ready',
      output_url: upload.publicUrl,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markRenderStatus(client, input.renderId, {
      status: 'failed',
      error: message.slice(0, 500),
    }).catch(() => {})
    throw err
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

async function downloadSupabaseObjectToFile(
  client: SupabaseClient,
  bucket: string,
  path: string,
  workDir: string,
  baseName: string,
): Promise<string> {
  const { data, error } = await client.storage.from(bucket).download(path)
  if (error || !data) {
    throw new Error(`Download ${bucket}/${path} failed: ${error?.message ?? 'no data'}`)
  }
  const buffer = Buffer.from(await data.arrayBuffer())
  const ext = path.match(/\.[^.]+$/)?.[0] ?? ''
  const localPath = join(workDir, `${baseName}${ext}`)
  writeFileSync(localPath, buffer)
  return localPath
}

async function downloadDriveObjectToFile(
  fileId: string,
  workDir: string,
  baseName: string,
  preferredAuth: DriveAuth | null,
): Promise<string> {
  const auth = preferredAuth ?? readApiKeyAuthFromEnv()
  if (!auth) {
    throw new Error(
      'No Drive auth available — set GOOGLE_API_KEY or connect the artist via OAuth',
    )
  }
  const { body } = await downloadDriveFile(fileId, auth)
  const localPath = join(workDir, `${baseName}.mp4`)
  await pipeline(Readable.fromWeb(body as never), createWriteStream(localPath))
  return localPath
}

function readApiKeyAuthFromEnv(): DriveAuth | null {
  const key = process.env.GOOGLE_API_KEY
  return key ? { kind: 'apiKey', apiKey: key } : null
}

/**
 * Best-effort: writes any newly-detected horizon_y_ratio values back to
 * the clips table. Skips entries that were either already cached or
 * couldn't be detected (null). Failures are swallowed — the render
 * succeeded, and the next render will just re-detect.
 */
async function persistHorizonRatios(
  client: SupabaseClient,
  clips: ClipRef[],
  beforeCache: (number | null)[],
  afterDetect: (number | null)[],
): Promise<void> {
  const updates: Array<{ id: string; ratio: number }> = []
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    if (!clip.id) continue
    if (beforeCache[i] != null) continue
    const detected = afterDetect[i]
    if (detected == null) continue
    if (detected < 0 || detected > 1) continue
    updates.push({ id: clip.id, ratio: detected })
  }
  if (updates.length === 0) return
  await Promise.all(
    updates.map((u) =>
      client.from('clips').update({ horizon_y_ratio: u.ratio }).eq('id', u.id),
    ),
  ).catch(() => {
    // Already best-effort — explicit catch silences unhandled rejection
    // warnings if one of the updates throws.
  })
}
