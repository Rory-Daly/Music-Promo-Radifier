import React from 'react'
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion'
import { DISPLAY_FONT, SANS_FONT } from './fonts'

export type BasicReelProps = {
  audioFile: string
  audioStartSeconds: number
  durationSeconds: number
  clipFiles: string[]
  clipDurationsSeconds?: number[]
  trackTitle?: string
  artistName?: string
  ctaText?: string
  wordmarkFile?: string
}

export const BasicReel: React.FC<BasicReelProps> = ({
  audioFile,
  audioStartSeconds,
  clipFiles,
  clipDurationsSeconds,
  trackTitle,
  artistName = 'illutible',
  ctaText = 'illutible.com',
  wordmarkFile,
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
      {trackTitle && (
        <TitleOverlay
          trackTitle={trackTitle}
          artistName={artistName}
          wordmarkFile={wordmarkFile}
        />
      )}
      <Watermark artistName={artistName} wordmarkFile={wordmarkFile} />
      {ctaText && <EndCTA ctaText={ctaText} wordmarkFile={wordmarkFile} />}
    </AbsoluteFill>
  )
}

const WORDMARK_CENTROID_OFFSET_PCT = 1.11

const TitleOverlay: React.FC<{
  trackTitle: string
  artistName: string
  wordmarkFile?: string
}> = ({ trackTitle, artistName, wordmarkFile }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = interpolate(
    frame,
    [0, 0.4 * fps, 3 * fps, 4 * fps],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '50%',
        background:
          'linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.4) 55%, rgba(0,0,0,0) 100%)',
        opacity,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '14%',
        color: '#fff',
        pointerEvents: 'none',
      }}
    >
      {wordmarkFile ? (
        <Img
          src={staticFile(wordmarkFile)}
          style={{
            width: '70%',
            height: 'auto',
            marginBottom: 28,
            transform: `translateX(${WORDMARK_CENTROID_OFFSET_PCT}%)`,
            filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.6))',
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: SANS_FONT,
            fontSize: 28,
            letterSpacing: '0.42em',
            fontWeight: 300,
            opacity: 0.75,
            textTransform: 'uppercase',
            marginBottom: 24,
            textShadow: '0 2px 12px rgba(0,0,0,0.6)',
          }}
        >
          {artistName}
        </div>
      )}
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 84,
          fontWeight: 500,
          letterSpacing: '0.02em',
          textAlign: 'center',
          maxWidth: '88%',
          lineHeight: 1.05,
          textShadow: '0 4px 24px rgba(0,0,0,0.75)',
        }}
      >
        {trackTitle}
      </div>
    </div>
  )
}

const Watermark: React.FC<{ artistName: string; wordmarkFile?: string }> = ({
  artistName,
  wordmarkFile,
}) => {
  if (wordmarkFile) {
    return (
      <Img
        src={staticFile(wordmarkFile)}
        style={{
          position: 'absolute',
          bottom: 56,
          left: 48,
          width: 280,
          height: 'auto',
          opacity: 0.55,
          transform: `translateX(${WORDMARK_CENTROID_OFFSET_PCT}%)`,
          filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.8))',
          pointerEvents: 'none',
        }}
      />
    )
  }
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 56,
        left: 48,
        color: '#fff',
        fontFamily: SANS_FONT,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: '0.42em',
        textTransform: 'uppercase',
        opacity: 0.45,
        textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        pointerEvents: 'none',
      }}
    >
      {artistName}
    </div>
  )
}

const EndCTA: React.FC<{ ctaText: string; wordmarkFile?: string }> = ({
  ctaText,
  wordmarkFile,
}) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const fadeStart = durationInFrames - 3 * fps
  const fadeIn = durationInFrames - 2 * fps
  const opacity = interpolate(frame, [fadeStart, fadeIn], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '50%',
        background:
          'linear-gradient(0deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.4) 55%, rgba(0,0,0,0) 100%)',
        opacity,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: '14%',
        color: '#fff',
        fontFamily: SANS_FONT,
        pointerEvents: 'none',
      }}
    >
      {wordmarkFile && (
        <Img
          src={staticFile(wordmarkFile)}
          style={{
            width: '60%',
            height: 'auto',
            marginBottom: 26,
            transform: `translateX(${WORDMARK_CENTROID_OFFSET_PCT}%)`,
            filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.6))',
          }}
        />
      )}
      <div
        style={{
          fontSize: 22,
          letterSpacing: '0.42em',
          fontWeight: 500,
          opacity: 0.85,
          marginBottom: 14,
          textTransform: 'uppercase',
          textShadow: '0 2px 8px rgba(0,0,0,0.6)',
        }}
      >
        Listen now
      </div>
      <div
        style={{
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          textShadow: '0 4px 18px rgba(0,0,0,0.7)',
        }}
      >
        {ctaText}
      </div>
    </div>
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
