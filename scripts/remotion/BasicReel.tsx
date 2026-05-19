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
import { type AspectRatio, getAspectRatioConfig } from './aspect-ratios'
import { DISPLAY_FONT, SANS_FONT } from './fonts'
import { type Transition, planTransition } from './transitions'

export type BasicReelProps = {
  audioFile: string
  audioStartSeconds: number
  durationSeconds: number
  clipFiles: string[]
  clipDurationsSeconds?: number[]
  aspectRatio?: AspectRatio
  transition?: Transition
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
  aspectRatio = '9x16',
  transition = 'cut',
  trackTitle,
  artistName = 'illutible',
  ctaText = 'illutible.com',
  wordmarkFile,
}) => {
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const config = getAspectRatioConfig(aspectRatio)
  const transitionPlan = planTransition(transition)
  const transitionFrames = Math.max(0, Math.round(transitionPlan.durationSeconds * fps))

  const slots = computeSlotFrames(clipFiles.length, durationInFrames, clipDurationsSeconds, fps)

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {clipFiles.map((name, i) => {
        const slotStart = slots.slice(0, i).reduce((a, b) => a + b, 0)
        const slotFrames = slots[i]
        const isFirst = i === 0
        const isLast = i === clipFiles.length - 1

        // For an overlapping transition (crossfade), each clip extends past
        // its slot by transitionFrames so the next clip can fade in over the
        // top. The last clip doesn't extend (would push the composition past
        // its declared duration).
        const sequenceFrames =
          transitionPlan.overlapping && !isLast
            ? slotFrames + transitionFrames
            : slotFrames

        return (
          <Sequence key={`${name}-${i}`} from={slotStart} durationInFrames={sequenceFrames}>
            <ClipFrame
              src={name}
              transition={transition}
              transitionFrames={transitionFrames}
              sequenceFrames={sequenceFrames}
              isFirst={isFirst}
              isLast={isLast}
              orientation={config.orientation}
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
          canvasWidth={width}
          canvasHeight={height}
        />
      )}
      <Watermark artistName={artistName} wordmarkFile={wordmarkFile} />
      {ctaText && (
        <EndCTA
          ctaText={ctaText}
          wordmarkFile={wordmarkFile}
          canvasHeight={height}
        />
      )}
    </AbsoluteFill>
  )
}

const ClipFrame: React.FC<{
  src: string
  transition: Transition
  transitionFrames: number
  sequenceFrames: number
  isFirst: boolean
  isLast: boolean
  orientation: 'portrait' | 'square' | 'landscape'
}> = ({ src, transition, transitionFrames, sequenceFrames, isFirst, isLast }) => {
  const frame = useCurrentFrame()

  let opacity = 1
  if (transition === 'crossfade' && transitionFrames > 0) {
    // Fade in over first transitionFrames (unless first clip).
    if (!isFirst && frame < transitionFrames) {
      opacity = frame / transitionFrames
    }
    // Fade out over last transitionFrames (unless last clip — last keeps
    // its visual to the end).
    if (!isLast && frame > sequenceFrames - transitionFrames) {
      opacity = Math.min(opacity, (sequenceFrames - frame) / transitionFrames)
    }
  } else if (transition === 'fade-black' && transitionFrames > 0) {
    const half = Math.max(1, Math.round(transitionFrames / 2))
    // First clip fades in from black at the start of the reel.
    if (frame < half) {
      opacity = frame / half
    }
    // Last clip fades to black at the end of the reel.
    if (frame > sequenceFrames - half) {
      opacity = Math.min(opacity, (sequenceFrames - frame) / half)
    }
  }

  return (
    <OffthreadVideo
      src={staticFile(src)}
      muted
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity: Math.max(0, Math.min(1, opacity)),
      }}
    />
  )
}

const WORDMARK_CENTROID_OFFSET_PCT = 1.11

const TitleOverlay: React.FC<{
  trackTitle: string
  artistName: string
  wordmarkFile?: string
  canvasWidth: number
  canvasHeight: number
}> = ({ trackTitle, artistName, wordmarkFile, canvasWidth, canvasHeight }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = interpolate(
    frame,
    [0, 0.4 * fps, 3 * fps, 4 * fps],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  // Scale title sizing by the canvas's short edge so the same overlay
  // reads well on every aspect ratio. Numbers tuned for 1080 short edge
  // (which is the case for every preset we ship).
  const shortEdge = Math.min(canvasWidth, canvasHeight)
  const titleFontSize = Math.round((84 * shortEdge) / 1080)
  const wordmarkLabelSize = Math.round((28 * shortEdge) / 1080)
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
        paddingTop: '8%',
        color: '#fff',
        pointerEvents: 'none',
      }}
    >
      {wordmarkFile ? (
        <Img
          src={staticFile(wordmarkFile)}
          style={{
            width: '54%',
            maxWidth: 760,
            height: 'auto',
            marginBottom: 24,
            transform: `translateX(${WORDMARK_CENTROID_OFFSET_PCT}%)`,
            filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.6))',
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: SANS_FONT,
            fontSize: wordmarkLabelSize,
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
          fontSize: titleFontSize,
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
          bottom: '5%',
          left: '4.5%',
          width: '22%',
          maxWidth: 320,
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
        bottom: '5%',
        left: '4.5%',
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

const EndCTA: React.FC<{ ctaText: string; wordmarkFile?: string; canvasHeight: number }> = ({
  ctaText,
  wordmarkFile,
  canvasHeight,
}) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const fadeStart = durationInFrames - 3 * fps
  const fadeIn = durationInFrames - 2 * fps
  const opacity = interpolate(frame, [fadeStart, fadeIn], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const ctaFontSize = Math.round((42 * canvasHeight) / 1920)
  const labelFontSize = Math.round((22 * canvasHeight) / 1920)
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
        paddingBottom: '8%',
        color: '#fff',
        fontFamily: SANS_FONT,
        pointerEvents: 'none',
      }}
    >
      {wordmarkFile && (
        <Img
          src={staticFile(wordmarkFile)}
          style={{
            width: '46%',
            maxWidth: 640,
            height: 'auto',
            marginBottom: 24,
            transform: `translateX(${WORDMARK_CENTROID_OFFSET_PCT}%)`,
            filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.6))',
          }}
        />
      )}
      <div
        style={{
          fontSize: labelFontSize,
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
          fontSize: ctaFontSize,
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

function computeSlotFrames(
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
