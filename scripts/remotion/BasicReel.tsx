import React from 'react'
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useVideoConfig } from 'remotion'

export type BasicReelProps = {
  audioFile: string
  audioStartSeconds: number
  durationSeconds: number
  clipFiles: string[]
  clipDurationsSeconds?: number[]
}

export const BasicReel: React.FC<BasicReelProps> = ({
  audioFile,
  audioStartSeconds,
  clipFiles,
  clipDurationsSeconds,
}) => {
  const { fps, durationInFrames } = useVideoConfig()

  const clipFrames = computeClipFrames(clipFiles.length, durationInFrames, clipDurationsSeconds, fps)

  let runningFrom = 0
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {clipFiles.map((name, i) => {
        const from = runningFrom
        const dur = clipFrames[i]
        runningFrom += dur
        return (
          <Sequence key={`${name}-${i}`} from={from} durationInFrames={dur}>
            <OffthreadVideo
              src={staticFile(name)}
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Sequence>
        )
      })}
      <Audio src={staticFile(audioFile)} startFrom={Math.round(audioStartSeconds * fps)} />
    </AbsoluteFill>
  )
}

function computeClipFrames(
  clipCount: number,
  totalFrames: number,
  perClipSeconds: number[] | undefined,
  fps: number,
): number[] {
  if (!perClipSeconds || perClipSeconds.length !== clipCount) {
    const even = Math.floor(totalFrames / Math.max(1, clipCount))
    const out = Array.from({ length: clipCount }, () => even)
    out[clipCount - 1] = totalFrames - even * (clipCount - 1)
    return out
  }
  const raw = perClipSeconds.map((s) => Math.max(1, Math.round(s * fps)))
  const sum = raw.reduce((a, b) => a + b, 0)
  raw[raw.length - 1] += totalFrames - sum
  return raw
}
