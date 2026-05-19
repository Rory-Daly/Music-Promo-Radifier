import { describe, expect, it } from 'vitest'
import {
  ASPECT_RATIO_CONFIGS,
  ASPECT_RATIOS,
  getAspectRatioConfig,
  isAspectRatio,
} from './aspect-ratios'

describe('ASPECT_RATIO_CONFIGS', () => {
  it('declares the four expected ratios with matching width/height', () => {
    expect(ASPECT_RATIOS).toEqual(['9x16', '1x1', '4x5', '16x9'])
    expect(ASPECT_RATIO_CONFIGS['9x16'].width).toBe(1080)
    expect(ASPECT_RATIO_CONFIGS['9x16'].height).toBe(1920)
    expect(ASPECT_RATIO_CONFIGS['1x1'].width).toBe(1080)
    expect(ASPECT_RATIO_CONFIGS['1x1'].height).toBe(1080)
    expect(ASPECT_RATIO_CONFIGS['4x5'].width).toBe(1080)
    expect(ASPECT_RATIO_CONFIGS['4x5'].height).toBe(1350)
    expect(ASPECT_RATIO_CONFIGS['16x9'].width).toBe(1920)
    expect(ASPECT_RATIO_CONFIGS['16x9'].height).toBe(1080)
  })

  it('every config has a crop filter that scales + crops to the canvas', () => {
    for (const ratio of ASPECT_RATIOS) {
      const cfg = ASPECT_RATIO_CONFIGS[ratio]
      expect(cfg.ffmpegCropFilter).toContain('scale=')
      expect(cfg.ffmpegCropFilter).toContain(`crop=${cfg.width}:${cfg.height}`)
      expect(cfg.ffmpegCropFilter).toContain('setsar=1')
    }
  })

  it('canvases all share a 1080px short edge', () => {
    for (const ratio of ASPECT_RATIOS) {
      const cfg = ASPECT_RATIO_CONFIGS[ratio]
      expect(Math.min(cfg.width, cfg.height)).toBe(1080)
    }
  })
})

describe('getAspectRatioConfig', () => {
  it('returns the registered config for each ratio', () => {
    expect(getAspectRatioConfig('9x16').ratio).toBe('9x16')
    expect(getAspectRatioConfig('16x9').orientation).toBe('landscape')
    expect(getAspectRatioConfig('1x1').orientation).toBe('square')
    expect(getAspectRatioConfig('4x5').orientation).toBe('portrait')
  })
})

describe('isAspectRatio', () => {
  it('accepts every registered ratio', () => {
    for (const r of ASPECT_RATIOS) expect(isAspectRatio(r)).toBe(true)
  })

  it('rejects junk values', () => {
    expect(isAspectRatio('')).toBe(false)
    expect(isAspectRatio('square')).toBe(false)
    expect(isAspectRatio(undefined)).toBe(false)
    expect(isAspectRatio(42)).toBe(false)
    expect(isAspectRatio('9:16')).toBe(false) // wrong separator
  })
})
