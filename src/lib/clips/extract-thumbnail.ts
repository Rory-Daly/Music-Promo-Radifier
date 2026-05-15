import 'server-only'
import { spawn } from 'node:child_process'
import { createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * Downloads up to HEAD_BYTES of a Drive file (via the API's Range support)
 * and asks ffmpeg for the first decodable frame after FRAME_TIMESTAMP.
 * Returns either { buffer } (success — JPEG bytes scaled to <=320px wide)
 * or { error } (an attributable failure reason so callers can surface it
 * in their response).
 *
 * The HEAD_BYTES window must be large enough to contain the moov atom for
 * faststart MP4s — drone cameras and most editing software produce
 * faststart output, where the atom lives near the start of the file. For
 * non-faststart MP4/MOV the moov is at the tail of the file and no
 * head-only download will decode; those clips currently fall back to the
 * "thumbnail unavailable" UI with a "moov atom not found" failure reason.
 */
const HEAD_BYTES = 128 * 1024 * 1024 // 128 MB
const FRAME_TIMESTAMP = '00:00:01'
const FFMPEG_PROBE_BYTES = '100M'

export type ThumbnailResult =
  | { ok: true; buffer: Buffer; bytesRead: number }
  | { ok: false; error: string }

export async function extractDriveThumbnail(
  fileId: string,
  apiKey: string,
): Promise<ThumbnailResult> {
  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-thumb-'))
  const tempInput = join(workDir, 'input.bin')
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
    })
    if (!res.ok && res.status !== 206) {
      const body = (await res.text().catch(() => '')).slice(0, 200)
      return { ok: false, error: `Drive HTTP ${res.status}${body ? ` — ${body}` : ''}` }
    }
    if (!res.body) {
      return { ok: false, error: 'Drive returned no body' }
    }
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tempInput))

    const bytes = statSync(tempInput).size
    if (bytes === 0) {
      return { ok: false, error: 'Empty body from Drive' }
    }
    return await runFfmpeg(tempInput, bytes)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function runFfmpeg(inputPath: string, bytes: number): Promise<ThumbnailResult> {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-probesize', FFMPEG_PROBE_BYTES,
      '-analyzeduration', FFMPEG_PROBE_BYTES,
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
    ff.on('error', (err) => {
      resolve({ ok: false, error: `ffmpeg spawn failed: ${err.message}` })
    })
    ff.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve({ ok: true, buffer: Buffer.concat(chunks), bytesRead: bytes })
      } else {
        const tail = stderr.split('\n').filter((l) => l.trim()).slice(-3).join(' | ')
        resolve({
          ok: false,
          error: `ffmpeg exit=${code} (${bytes} bytes downloaded) — ${tail.slice(-250)}`,
        })
      }
    })
  })
}
