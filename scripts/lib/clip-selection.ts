import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
  '.mxf',
  '.mts',
  '.m2ts',
])

export type ClipCandidate = {
  path: string
  durationSeconds: number
}

export type SelectedClip = {
  path: string
  sourceStartSeconds: number
  outputDurationSeconds: number
}

export type SelectClipsOptions = {
  outputDurationsSeconds: number[]
  slowmo?: number
  random?: () => number
  reuseAllowed?: boolean
}

export async function discoverClips(folder: string): Promise<ClipCandidate[]> {
  const absFolder = resolve(folder)
  const files = await listVideoFilesRecursive(absFolder)
  const probed = await Promise.all(
    files.map(async (path) => {
      const duration = await probeDurationSeconds(path)
      return duration !== null ? { path, durationSeconds: duration } : null
    }),
  )
  return probed.filter((c): c is ClipCandidate => c !== null).sort((a, b) => a.path.localeCompare(b.path))
}

async function listVideoFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const result: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await listVideoFilesRecursive(full)
      result.push(...nested)
    } else if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      result.push(full)
    }
  }
  return result
}

async function probeDurationSeconds(path: string): Promise<number | null> {
  return new Promise<number | null>((resolveProbe) => {
    const ff = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ])
    let stdout = ''
    ff.stdout.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    ff.on('error', () => resolveProbe(null))
    ff.on('close', (code) => {
      if (code !== 0) return resolveProbe(null)
      const value = parseFloat(stdout.trim())
      resolveProbe(Number.isFinite(value) && value > 0 ? value : null)
    })
  })
}

export function selectClips(
  candidates: ClipCandidate[],
  options: SelectClipsOptions,
): SelectedClip[] {
  const slowmo = options.slowmo ?? 1
  const random = options.random ?? Math.random
  const reuseAllowed = options.reuseAllowed ?? true

  const slotsNeeded = options.outputDurationsSeconds.map((d) => d * slowmo)

  const unused = [...candidates].sort(() => random() - 0.5)
  const selected: SelectedClip[] = []
  const exhausted = new Set<string>()

  for (let slotIndex = 0; slotIndex < slotsNeeded.length; slotIndex++) {
    const sourceNeeded = slotsNeeded[slotIndex]
    let pick: ClipCandidate | null = null

    for (let i = 0; i < unused.length; i++) {
      if (unused[i].durationSeconds >= sourceNeeded && !exhausted.has(unused[i].path)) {
        pick = unused[i]
        unused.splice(i, 1)
        break
      }
    }

    if (!pick && reuseAllowed) {
      const fallback = candidates
        .filter((c) => c.durationSeconds >= sourceNeeded)
        .sort(() => random() - 0.5)[0]
      if (fallback) pick = fallback
    }

    if (!pick) {
      const longest = candidates.reduce(
        (best, c) => (c.durationSeconds > best.durationSeconds ? c : best),
        candidates[0],
      )
      throw new Error(
        `No clip is long enough for slot ${slotIndex + 1} (needs ${sourceNeeded.toFixed(2)}s of source; ` +
          `longest available is ${longest?.path ?? '<none>'} at ${longest?.durationSeconds.toFixed(2) ?? 0}s).`,
      )
    }

    const headroom = Math.max(0, pick.durationSeconds - sourceNeeded)
    const sourceStartSeconds = headroom > 0 ? random() * headroom : 0
    selected.push({
      path: pick.path,
      sourceStartSeconds,
      outputDurationSeconds: options.outputDurationsSeconds[slotIndex],
    })

    if (!reuseAllowed) exhausted.add(pick.path)
  }

  return selected
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
