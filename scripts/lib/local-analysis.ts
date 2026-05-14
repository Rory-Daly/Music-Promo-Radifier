import { spawn } from 'node:child_process'
import type { EnergyCurve } from './scoring'

export type LocalAnalysisOptions = {
  resolutionSeconds?: number
  sampleRate?: number
}

export function analyseLocalAudio(
  filePath: string,
  options: LocalAnalysisOptions = {},
): Promise<EnergyCurve> {
  const resolution = options.resolutionSeconds ?? 0.5
  const sampleRate = options.sampleRate ?? 22050
  const samplesPerWindow = Math.max(1, Math.floor(sampleRate * resolution))
  const bytesPerWindow = samplesPerWindow * 2

  return new Promise<EnergyCurve>((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      'pipe:1',
    ])

    const chunks: Buffer[] = []
    let stderrText = ''

    ff.stderr.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString()
    })

    ff.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    ff.on('error', (err) => reject(new Error(`ffmpeg failed to start: ${err.message}`)))
    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderrText.trim()}`))
        return
      }
      const pcm = Buffer.concat(chunks)
      if (pcm.length < bytesPerWindow) {
        reject(new Error('ffmpeg produced no audio samples — check input file format'))
        return
      }
      const totalWindows = Math.floor(pcm.length / bytesPerWindow)
      const energies = new Array<number>(totalWindows)
      for (let w = 0; w < totalWindows; w++) {
        const offset = w * bytesPerWindow
        let sumSquares = 0
        for (let i = 0; i < bytesPerWindow; i += 2) {
          const sample = pcm.readInt16LE(offset + i)
          const normalized = sample / 32768
          sumSquares += normalized * normalized
        }
        energies[w] = Math.sqrt(sumSquares / samplesPerWindow)
      }
      const maxEnergy = energies.reduce((m, e) => (e > m ? e : m), 0)
      const samples = maxEnergy > 0 ? energies.map((e) => e / maxEnergy) : energies
      resolve({
        durationSeconds: totalWindows * resolution,
        resolutionSeconds: resolution,
        samples,
      })
    })
  })
}
