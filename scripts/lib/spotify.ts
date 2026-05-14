import type { EnergyCurve } from './scoring'

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_API = 'https://api.spotify.com/v1'

export type SpotifyAudioAnalysis = {
  track: { duration: number; tempo: number; loudness: number; key: number; mode: number }
  sections: Array<{
    start: number
    duration: number
    loudness: number
    tempo: number
    confidence: number
  }>
  segments: Array<{
    start: number
    duration: number
    loudness_max: number
    loudness_start: number
  }>
}

export async function getSpotifyToken(clientId: string, clientSecret: string): Promise<string> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Spotify token request failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

export async function fetchAudioAnalysis(
  trackId: string,
  token: string,
): Promise<SpotifyAudioAnalysis> {
  const res = await fetch(`${SPOTIFY_API}/audio-analysis/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Spotify audio-analysis request failed (${res.status}): ${text}`)
  }
  return (await res.json()) as SpotifyAudioAnalysis
}

export function analysisToEnergyCurve(
  analysis: SpotifyAudioAnalysis,
  resolutionSeconds = 0.5,
): EnergyCurve {
  const duration = analysis.track.duration
  const totalFrames = Math.max(1, Math.ceil(duration / resolutionSeconds))
  const dbFloor = -60
  const samples = new Array<number>(totalFrames).fill(dbFloor)

  for (const seg of analysis.segments) {
    const startFrame = Math.floor(seg.start / resolutionSeconds)
    const endFrame = Math.min(totalFrames, Math.ceil((seg.start + seg.duration) / resolutionSeconds))
    for (let i = startFrame; i < endFrame; i++) {
      if (seg.loudness_max > samples[i]) samples[i] = seg.loudness_max
    }
  }

  const normalized = samples.map((db) => {
    const clamped = Math.max(dbFloor, Math.min(0, db))
    return (clamped - dbFloor) / -dbFloor
  })

  return {
    durationSeconds: duration,
    resolutionSeconds,
    samples: normalized,
  }
}

export function extractTrackId(input: string): string {
  const urlMatch = input.match(/track\/([A-Za-z0-9]+)/)
  if (urlMatch) return urlMatch[1]
  const uriMatch = input.match(/^spotify:track:([A-Za-z0-9]+)$/)
  if (uriMatch) return uriMatch[1]
  if (/^[A-Za-z0-9]{22}$/.test(input)) return input
  throw new Error(`Could not extract Spotify track ID from: ${input}`)
}
