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
 * Returns the JPEG bytes, scaled to <=320px wide.
 *
 * Returns null on any failure (caller treats as "no thumbnail" and falls
 * back to Drive's lh3 URL / "thumbnail unavailable" placeholder).
 *
 * The HEAD_BYTES window must be large enough to contain the moov atom for
 * faststart MP4s — drone cameras and most editing software produce
 * faststart output, where the atom lives near the start of the file. For
 * non-faststart MP4/MOV the moov is at the tail of the file and no
 * head-only download will decode; those clips currently fall back to the
 * "thumbnail unavailable" UI.
 */
const HEAD_BYTES = 128 * 1024 * 1024 // 128 MB
const FRAME_TIMESTAMP = '00:00:01'
const FFMPEG_PROBE_BYTES = '100M'

export async function extractDriveThumbnail(
  fileId: string,
  apiKey: string,
): Promise<Buffer | null> {
  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-thumb-'))
  const tempInput = join(workDir, 'input.bin')
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
    })
    if (!res.ok && res.status !== 206) {
      console.error(
        `[thumbnail] Drive range fetch ${fileId} → HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`,
      )
      return null
    }
    if (!res.body) {
      console.error(`[thumbnail] Drive range fetch ${fileId} → no body`)
      return null
    }
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tempInput))

    const bytes = statSync(tempInput).size
    return await runFfmpeg(tempInput, fileId, bytes)
  } catch (err) {
    console.error(
      `[thumbnail] ${fileId} threw:`,
      err instanceof Error ? err.message : String(err),
    )
    return null
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function runFfmpeg(inputPath: string, fileId: string, bytes: number): Promise<Buffer | null> {
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
      console.error(`[thumbnail] ffmpeg ${fileId} spawn error:`, err.message)
      resolve(null)
    })
    ff.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks))
      } else {
        console.error(
          `[thumbnail] ffmpeg ${fileId} exit=${code} bytes=${bytes} stderr=${stderr.slice(-400).trim()}`,
        )
        resolve(null)
      }
    })
  })
}
