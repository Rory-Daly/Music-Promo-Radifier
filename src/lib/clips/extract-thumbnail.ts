import 'server-only'
import { spawn } from 'node:child_process'
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { downloadDriveFile } from '@/lib/gdrive'

/**
 * Pulls the first ~30 MB of a Drive file with a Range request and extracts
 * a JPEG thumbnail with ffmpeg. Returns null if either step fails — the
 * caller treats that as "no thumbnail" (clip still works for rendering;
 * just shows the "thumbnail unavailable" placeholder).
 *
 * Why partial download: drone clips are often multi-GB; downloading the
 * full file just to grab a frame would dominate import time. The first
 * 30 MB is enough for any faststart MP4/MOV. Containers with metadata at
 * the tail (some non-faststart MP4, older MOV) will fail to decode from
 * the prefix — those clips fall back to the "thumbnail unavailable" UI.
 *
 * Returns the JPEG bytes scaled to 320px wide.
 */
const HEAD_BYTES = 30 * 1024 * 1024 // 30 MB
const FRAME_TIMESTAMP = '00:00:01' // skip black/leader frames at the very start

export async function extractDriveThumbnail(
  fileId: string,
  apiKey: string,
): Promise<Buffer | null> {
  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-thumb-'))
  const tempInput = join(workDir, 'input.bin')
  try {
    const { body } = await downloadDriveFile(fileId, apiKey)
    const stream = Readable.fromWeb(body as never)
    let bytes = 0
    const writer = createWriteStream(tempInput)
    const limited = new Readable({
      read() {},
    })
    stream.on('data', (chunk: Buffer) => {
      const remaining = HEAD_BYTES - bytes
      if (remaining <= 0) {
        stream.destroy()
        limited.push(null)
        return
      }
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      bytes += slice.length
      limited.push(slice)
      if (bytes >= HEAD_BYTES) {
        stream.destroy()
        limited.push(null)
      }
    })
    stream.on('end', () => limited.push(null))
    stream.on('error', (err) => limited.destroy(err))

    await pipeline(limited, writer)
    return await runFfmpeg(tempInput)
  } catch {
    return null
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function runFfmpeg(inputPath: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-ss', FRAME_TIMESTAMP,
      '-i', inputPath,
      '-vframes', '1',
      '-vf', "scale='if(gt(iw,320),320,iw)':-2",
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1',
    ])
    const chunks: Buffer[] = []
    let stderr = ''
    ff.stdout.on('data', (c: Buffer) => chunks.push(c))
    ff.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    ff.on('error', () => resolve(null))
    ff.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks))
      } else {
        // Caller doesn't need the stderr — just log via the silent fail path.
        // (Uncomment for local debugging.)
        // console.error('ffmpeg thumbnail failed:', stderr.slice(-300))
        void stderr
        resolve(null)
      }
    })
  })
}
