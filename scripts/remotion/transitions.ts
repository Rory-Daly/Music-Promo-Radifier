/**
 * Inter-clip transitions. Shared between the Remotion composition (which
 * renders the opacity ramps) and the ffmpeg preprocessing (which needs
 * to know how much extra video tail to keep for an overlapping fade).
 *
 * - cut: hard cut on the beat. No overlap, no opacity work.
 * - crossfade: clip N's tail and clip N+1's head play simultaneously,
 *   blended via opacity. Slot durations stay on-beat; the visual
 *   transition centres on the cut point.
 * - fade-black: clip N fades to black at the end of its slot, clip N+1
 *   fades in from black at the start of its slot. No overlap. Slot
 *   durations stay on-beat.
 */

export type Transition = 'cut' | 'crossfade' | 'fade-black'

export const TRANSITIONS: readonly Transition[] = ['cut', 'crossfade', 'fade-black'] as const

export type TransitionPlan = {
  type: Transition
  /** Total duration of the inter-clip transition, in seconds. */
  durationSeconds: number
  /** Whether neighbouring clips overlap in time (true) or play sequentially (false). */
  overlapping: boolean
}

export const DEFAULT_TRANSITION: Transition = 'cut'

const CROSSFADE_SECONDS = 0.3
const FADE_BLACK_SECONDS = 0.4

export function planTransition(type: Transition): TransitionPlan {
  switch (type) {
    case 'crossfade':
      return { type, durationSeconds: CROSSFADE_SECONDS, overlapping: true }
    case 'fade-black':
      return { type, durationSeconds: FADE_BLACK_SECONDS, overlapping: false }
    case 'cut':
      return { type, durationSeconds: 0, overlapping: false }
  }
}

export const TRANSITION_LABELS: Record<Transition, string> = {
  cut: 'Hard cut (on beat)',
  crossfade: 'Crossfade (0.3s)',
  'fade-black': 'Fade through black (0.4s)',
}

export function isTransition(value: unknown): value is Transition {
  return typeof value === 'string' && (TRANSITIONS as readonly string[]).includes(value)
}
