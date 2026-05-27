import 'server-only'
import { spawn } from 'node:child_process'
import { extname } from 'node:path'

/**
 * Thin server-side wrapper around the `yt-dlp` CLI. Used by the SoundCloud
 * track ingestion path to fetch audio when the artist pastes a URL instead
 * of uploading a file.
 *
 * Requires `yt-dlp` on PATH. On macOS: `brew install yt-dlp`. On Linux:
 * package manager or `pipx install yt-dlp`. On Vercel/Docker: install in
 * the build image (apt/apk or the standalone binary).
 *
 * The URL is passed as a spawn argument (no shell), so the only injection
 * surface is whatever yt-dlp itself does with the string. Callers should
 * still validate the URL upstream (parseSoundCloudUrl) so we don't fire
 * yt-dlp at arbitrary inputs.
 */

export type YtDlpDownloadResult = {
  filePath: string
  extension: string
}

export class YtDlpMissingError extends Error {
  constructor() {
    super(
      'yt-dlp is not installed on the server. Install with `brew install yt-dlp` (macOS) or your platform equivalent.',
    )
    this.name = 'YtDlpMissingError'
  }
}

export class YtDlpFailedError extends Error {
  readonly exitCode: number | null
  readonly stderr: string
  constructor(exitCode: number | null, stderr: string) {
    super(
      `yt-dlp exited with code ${exitCode}: ${stderr.split('\n').slice(-3).join(' ').slice(0, 400)}`,
    )
    this.name = 'YtDlpFailedError'
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

/**
 * Download the best-quality audio stream for a track URL into `outDir`.
 * Returns the absolute path to the resulting file (extension determined
 * by what yt-dlp pulled — usually .mp3 or .m4a for SoundCloud).
 */
export async function downloadAudio(
  url: string,
  outDir: string,
): Promise<YtDlpDownloadResult> {
  // yt-dlp output template: outDir/audio.<ext>. The --print after_move:filepath
  // flag prints the final resolved path on stdout, which avoids guessing
  // the extension by globbing.
  const args = [
    '-f',
    'bestaudio',
    '--no-playlist',
    '--no-progress',
    '-o',
    `${outDir}/audio.%(ext)s`,
    '--print',
    'after_move:filepath',
    url,
  ]

  const filePath = await runYtDlp(args)
  if (filePath.length === 0) {
    throw new YtDlpFailedError(0, 'yt-dlp exited cleanly but printed no file path')
  }
  return { filePath, extension: extname(filePath) }
}

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let proc
    try {
      proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ENOENT') reject(new YtDlpMissingError())
      else reject(err)
      return
    }
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') reject(new YtDlpMissingError())
      else reject(err)
    })
    proc.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new YtDlpFailedError(code, stderr))
    })
  })
}
