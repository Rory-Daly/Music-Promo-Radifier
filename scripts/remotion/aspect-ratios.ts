/**
 * Aspect-ratio registry. Shared between the Remotion composition (which
 * needs width/height) and the ffmpeg clip preprocessing in compose.ts
 * (which needs the scale+crop filter for the matching canvas).
 *
 * All canvases use 1080px on the short edge — keeps brand overlay sizing
 * consistent across formats without per-ratio layout work.
 */

export type AspectRatio = '9x16' | '1x1' | '16x9' | '4x5'

export const ASPECT_RATIOS: readonly AspectRatio[] = ['9x16', '1x1', '4x5', '16x9'] as const

export type AspectRatioConfig = {
  ratio: AspectRatio
  width: number
  height: number
  label: string
  /** Where the brand chrome (title overlay / CTA) belongs. */
  orientation: 'portrait' | 'square' | 'landscape'
  /** ffmpeg `-vf` filter that crops a source clip to this canvas. */
  ffmpegCropFilter: string
}

export const ASPECT_RATIO_CONFIGS: Record<AspectRatio, AspectRatioConfig> = {
  '9x16': {
    ratio: '9x16',
    width: 1080,
    height: 1920,
    label: '9:16 · Reel / Short',
    orientation: 'portrait',
    ffmpegCropFilter:
      'scale=-2:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1',
  },
  '4x5': {
    ratio: '4x5',
    width: 1080,
    height: 1350,
    label: '4:5 · Feed portrait',
    orientation: 'portrait',
    ffmpegCropFilter:
      'scale=1080:-2:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1350,setsar=1',
  },
  '1x1': {
    ratio: '1x1',
    width: 1080,
    height: 1080,
    label: '1:1 · Feed square',
    orientation: 'square',
    ffmpegCropFilter:
      'scale=1080:-2:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1080,setsar=1',
  },
  '16x9': {
    ratio: '16x9',
    width: 1920,
    height: 1080,
    label: '16:9 · YouTube / landscape',
    orientation: 'landscape',
    ffmpegCropFilter:
      'scale=1920:-2:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,setsar=1',
  },
}

export function getAspectRatioConfig(ratio: AspectRatio): AspectRatioConfig {
  return ASPECT_RATIO_CONFIGS[ratio]
}

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && value in ASPECT_RATIO_CONFIGS
}
