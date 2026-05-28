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
import { computeHorizonShifts } from './horizon-shifts'
import { type Transition, planTransition } from './transitions'

export type BasicReelProps = {
  audioFile: string
  audioStartSeconds: number
  /** Audio playback duration (hook length). Composition is longer by outroTailSeconds. */
  durationSeconds: number
  clipFiles: string[]
  clipDurationsSeconds?: number[]
  /**
   * Per-clip horizon Y as a 0..1 ratio of the source frame height
   * (0 = top, 1 = bottom). null entries are treated as "unknown" and
   * disable alignment for transitions touching that clip.
   */
  clipHorizonRatios?: (number | null)[]
  aspectRatio?: AspectRatio
  transition?: Transition
  trackTitle?: string
  artistName?: string
  ctaText?: string
  wordmarkFile?: string
  /** Audio fade-in length at the start of the reel. */
  audioFadeInSeconds?: number
  /** Audio fade-out length at the end of audio playback (before outro tail). */
  audioFadeOutSeconds?: number
  /** Video fade-in from black at the start of the reel. */
  videoFadeInSeconds?: number
  /** Video fade-out to black, ending when audio ends. */
  videoFadeOutSeconds?: number
  /** Pure black + CTA hold after audio finishes. */
  outroTailSeconds?: number
}

const DEFAULT_AUDIO_FADE_IN = 1.5
const DEFAULT_AUDIO_FADE_OUT = 6
const DEFAULT_VIDEO_FADE_IN = 1
const DEFAULT_VIDEO_FADE_OUT = 3

export const BasicReel: React.FC<BasicReelProps> = ({
  audioFile,
  audioStartSeconds,
  durationSeconds,
  clipFiles,
  clipDurationsSeconds,
  clipHorizonRatios,
  aspectRatio = '9x16',
  transition = 'cut',
  trackTitle,
  artistName = 'illutible',
  ctaText = 'illutible.com',
  wordmarkFile,
  audioFadeInSeconds = DEFAULT_AUDIO_FADE_IN,
  audioFadeOutSeconds = DEFAULT_AUDIO_FADE_OUT,
  videoFadeInSeconds = DEFAULT_VIDEO_FADE_IN,
  videoFadeOutSeconds = DEFAULT_VIDEO_FADE_OUT,
  // outroTailSeconds is consumed by Root.calculateMetadata to size the
  // overall composition. Inside this component we just trust that
  // durationInFrames is larger than audioFrames and clamp clip layout
  // accordingly.
}) => {
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const config = getAspectRatioConfig(aspectRatio)
  const transitionPlan = planTransition(transition)
  const transitionFrames = Math.max(0, Math.round(transitionPlan.durationSeconds * fps))

  const audioFrames = Math.round(durationSeconds * fps)
  // Composition lives slightly longer than the audio so the CTA can hold
  // on pure black after the music ends. Root.calculateMetadata is what
  // actually sets durationInFrames; if it forgot to add outroTailSeconds
  // we just clamp clip layout to whatever was given.
  const clipLayoutFrames = Math.min(audioFrames, durationInFrames)

  const slots = computeSlotFrames(clipFiles.length, clipLayoutFrames, clipDurationsSeconds, fps)

  const audioFadeInFrames = Math.max(0, Math.round(audioFadeInSeconds * fps))
  const audioFadeOutFrames = Math.max(0, Math.round(audioFadeOutSeconds * fps))
  const videoFadeInFrames = Math.max(0, Math.round(videoFadeInSeconds * fps))
  const videoFadeOutFrames = Math.max(0, Math.round(videoFadeOutSeconds * fps))

  const horizonShifts = computeHorizonShifts({
    horizons: clipHorizonRatios,
    clipCount: clipFiles.length,
    canvasHeight: height,
    isCrossfade: transition === 'crossfade',
  })

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {clipFiles.map((name, i) => {
        const slotStart = slots.slice(0, i).reduce((a, b) => a + b, 0)
        const slotFrames = slots[i]
        const isFirst = i === 0
        const isLast = i === clipFiles.length - 1

        // For overlapping transitions (crossfade), every non-last clip
        // extends past its slot so the next clip can fade in over the top.
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
              incomingShiftPx={horizonShifts[i]?.incomingShiftPx ?? 0}
              outgoingShiftPx={horizonShifts[i]?.outgoingShiftPx ?? 0}
            />
          </Sequence>
        )
      })}

      <Audio
        src={staticFile(audioFile)}
        startFrom={Math.round(audioStartSeconds * fps)}
        endAt={Math.round(audioStartSeconds * fps) + audioFrames}
        volume={(frame) =>
          audioVolume(frame, audioFrames, audioFadeInFrames, audioFadeOutFrames)
        }
      />

      {/* Reel-wide soft start (fade in from black) and soft end (fade out
          to black ending exactly when audio ends). Runs regardless of the
          inter-clip transition choice. */}
      <ReelFadeOverlay
        audioFrames={audioFrames}
        videoFadeInFrames={videoFadeInFrames}
        videoFadeOutFrames={videoFadeOutFrames}
      />

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
          audioFrames={audioFrames}
          videoFadeOutFrames={videoFadeOutFrames}
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
  /** translateY applied when this clip is the *incoming* side of a crossfade. */
  incomingShiftPx: number
  /** translateY applied when this clip is the *outgoing* side of a crossfade. */
  outgoingShiftPx: number
}> = ({
  src,
  transition,
  transitionFrames,
  sequenceFrames,
  isFirst,
  isLast,
  incomingShiftPx,
  outgoingShiftPx,
}) => {
  const frame = useCurrentFrame()

  let opacity = 1
  let translateYPx = 0
  if (transition === 'crossfade' && transitionFrames > 0) {
    // Incoming crossfade (this clip fades in over the previous one).
    if (!isFirst && frame < transitionFrames) {
      const t = frame / transitionFrames
      opacity = t
      // Animate from incomingShiftPx (offset to match outgoing horizon)
      // back to 0 (this clip's natural position) over the crossfade.
      translateYPx = incomingShiftPx * (1 - t)
    }
    // Outgoing crossfade (this clip fades out as the next one fades in).
    if (!isLast && frame > sequenceFrames - transitionFrames) {
      const t = (sequenceFrames - frame) / transitionFrames
      opacity = Math.min(opacity, t)
      // Animate from 0 (natural) to outgoingShiftPx (so the midpoint
      // sees this clip's horizon meet the incoming clip's horizon).
      translateYPx = outgoingShiftPx * (1 - t)
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
        transform: translateYPx !== 0 ? `translateY(${translateYPx}px)` : undefined,
      }}
    />
  )
}

const ReelFadeOverlay: React.FC<{
  audioFrames: number
  videoFadeInFrames: number
  videoFadeOutFrames: number
}> = ({ audioFrames, videoFadeInFrames, videoFadeOutFrames }) => {
  const frame = useCurrentFrame()
  // 1 = fully black overlay, 0 = transparent.
  let alpha = 0
  if (videoFadeInFrames > 0 && frame < videoFadeInFrames) {
    alpha = 1 - frame / videoFadeInFrames
  }
  const fadeOutStart = audioFrames - videoFadeOutFrames
  if (videoFadeOutFrames > 0 && frame >= fadeOutStart) {
    // Beyond audioFrames we keep the overlay fully opaque — the outro
    // tail is meant to be pure black with only the CTA showing.
    const into = Math.min(videoFadeOutFrames, frame - fadeOutStart)
    alpha = Math.max(alpha, into / videoFadeOutFrames)
  }
  if (alpha <= 0) return null
  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#000',
        opacity: Math.max(0, Math.min(1, alpha)),
        pointerEvents: 'none',
      }}
    />
  )
}

function audioVolume(
  frame: number,
  audioFrames: number,
  fadeInFrames: number,
  fadeOutFrames: number,
): number {
  if (frame < 0 || frame >= audioFrames) return 0
  let v = 1
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    v = frame / fadeInFrames
  }
  if (fadeOutFrames > 0 && frame > audioFrames - fadeOutFrames) {
    v = Math.min(v, (audioFrames - frame) / fadeOutFrames)
  }
  return Math.max(0, Math.min(1, v))
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

const EndCTA: React.FC<{
  ctaText: string
  wordmarkFile?: string
  canvasHeight: number
  audioFrames: number
  videoFadeOutFrames: number
}> = ({ ctaText, wordmarkFile, canvasHeight, audioFrames, videoFadeOutFrames }) => {
  const frame = useCurrentFrame()
  // CTA starts fading in when video starts fading to black, hits full
  // opacity when audio ends / video is fully black, and holds at full
  // opacity through the outro tail until the composition ends.
  const fadeStart = Math.max(0, audioFrames - videoFadeOutFrames)
  const fadeEnd = audioFrames
  const opacity = interpolate(frame, [fadeStart, fadeEnd], [0, 1], {
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
