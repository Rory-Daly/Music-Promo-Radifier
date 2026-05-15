import 'server-only'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDriveDownloadRequest, type DriveAuth } from '@/lib/gdrive'

/**
 * Downloads enough of a Drive file to extract a thumbnail with ffmpeg.
 * Returns either { ok: true, buffer } (a JPEG scaled to <=320px wide)
 * or { ok: false, error } with an attributable failure reason.
 *
 * Why head+tail and not just head: MP4 files store playback metadata
 * (the "moov atom") in one of two places — the front of the file
 * (faststart, what editing software produces) or the back (raw camera
 * output, like DJI drones). Without the moov, ffmpeg has no idea where
 * any frame lives in the mdat stream, so a head-only download fails on
 * camera-original files with "Invalid data found when processing input".
 *
 * The fix: fetch the first 50 MB (covers ftyp + first ~5 s of mdat at
 * 4K bitrates) AND the last 16 MB (covers moov), write them to a single
 * sparse file at their correct byte offsets, and let ffmpeg seek between
 * them. The middle is filesystem-zero; ffmpeg never needs to read it
 * because it only wants the first frame's bytes, which are in the head.
 */
const HEAD_BYTES = 50 * 1024 * 1024
const TAIL_BYTES = 16 * 1024 * 1024
const FRAME_TIMESTAMP = '00:00:01'
const FFMPEG_PROBE_BYTES = '100M'

export type ThumbnailResult =
  | { ok: true; buffer: Buffer; bytesDownloaded: number }
  | { ok: false; error: string }

export async function extractDriveThumbnail(
  fileId: string,
  auth: DriveAuth,
  fileSize: number,
): Promise<ThumbnailResult> {
  const workDir = mkdtempSync(join(tmpdir(), 'legatograph-thumb-'))
  const tempInput = join(workDir, 'input.bin')
  try {
    const bytesDownloaded = await downloadDriveForThumbnail(
      fileId,
      auth,
      fileSize,
      tempInput,
    )
    const onDiskSize = statSync(tempInput).size
    if (onDiskSize === 0) {
      return { ok: false, error: 'Empty input from Drive' }
    }
    return await runFfmpeg(tempInput, bytesDownloaded)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

async function downloadDriveForThumbnail(
  fileId: string,
  auth: DriveAuth,
  fileSize: number,
  tempPath: string,
): Promise<number> {
  const { url, headers: authHeaders } = buildDriveDownloadRequest(fileId, auth)

  if (fileSize === 0 || fileSize <= HEAD_BYTES + TAIL_BYTES) {
    const end = fileSize > 0 ? fileSize - 1 : HEAD_BYTES - 1
    const res = await fetch(url, {
      headers: { ...authHeaders, Range: `bytes=0-${end}` },
    })
    if (!res.ok && res.status !== 206) {
      throw new Error(await driveHttpError(res))
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const fd = await open(tempPath, 'w')
    try {
      await fd.write(buf, 0, buf.length, 0)
    } finally {
      await fd.close()
    }
    return buf.length
  }

  const fd = await open(tempPath, 'w')
  try {
    const headRes = await fetch(url, {
      headers: { ...authHeaders, Range: `bytes=0-${HEAD_BYTES - 1}` },
    })
    if (!headRes.ok && headRes.status !== 206) {
      throw new Error('Head: ' + (await driveHttpError(headRes)))
    }
    const headBuf = Buffer.from(await headRes.arrayBuffer())
    await fd.write(headBuf, 0, headBuf.length, 0)

    const tailStart = fileSize - TAIL_BYTES
    const tailRes = await fetch(url, {
      headers: { ...authHeaders, Range: `bytes=${tailStart}-${fileSize - 1}` },
    })
    if (!tailRes.ok && tailRes.status !== 206) {
      throw new Error('Tail: ' + (await driveHttpError(tailRes)))
    }
    const tailBuf = Buffer.from(await tailRes.arrayBuffer())
    await fd.write(tailBuf, 0, tailBuf.length, tailStart)

    await fd.truncate(fileSize)

    return headBuf.length + tailBuf.length
  } finally {
    await fd.close()
  }
}

async function driveHttpError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    if (parsed.error?.message) {
      let reason = `Drive ${res.status}: ${parsed.error.message}`
      if (/download quota/i.test(parsed.error.message)) {
        reason += ' (resets in ~24h, or sign in with Google for higher limits)'
      }
      return reason
    }
  } catch {
    // not JSON
  }
  return `Drive HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`
}

function runFfmpeg(inputPath: string, bytesDownloaded: number): Promise<ThumbnailResult> {
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
        resolve({ ok: true, buffer: Buffer.concat(chunks), bytesDownloaded })
      } else {
        const tail = stderr.split('\n').filter((l) => l.trim()).slice(-3).join(' | ')
        resolve({
          ok: false,
          error: `ffmpeg exit=${code} (${bytesDownloaded} bytes downloaded) — ${tail.slice(-250)}`,
        })
      }
    })
  })
}
