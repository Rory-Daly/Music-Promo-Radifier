import 'server-only'
import { createWriteStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { composeReel } from '../../../scripts/lib/compose'
import { markRenderStatus, uploadRenderOutput } from '../../../scripts/lib/persist-render'
import { downloadDriveFile } from '@/lib/gdrive'

export type ClipRef =
  | { source: 'supabase'; bucket: string; path: string }
  | { source: 'gdrive'; fileId: string }

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
  wordmarkPath?: string
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
          : await downloadDriveObjectToFile(clip.fileId, workDir, `clip-${i}`)
      clipLocalPaths.push(path)
    }

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
      wordmarkPath: input.wordmarkPath,
    })

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
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set — cannot resolve Drive clip')
  const { body } = await downloadDriveFile(fileId, apiKey)
  const localPath = join(workDir, `${baseName}.mp4`)
  await pipeline(Readable.fromWeb(body as never), createWriteStream(localPath))
  return localPath
}
