import React from 'react'
import { Composition } from 'remotion'
import { ASPECT_RATIO_CONFIGS, isAspectRatio } from './aspect-ratios'
import { BasicReel, type BasicReelProps } from './BasicReel'
import { installCustomFonts } from './fonts'

installCustomFonts()

const FPS = 30
const DEFAULT_CONFIG = ASPECT_RATIO_CONFIGS['9x16']

export const Root: React.FC = () => {
  return (
    <Composition
      id="BasicReel"
      component={BasicReel}
      fps={FPS}
      width={DEFAULT_CONFIG.width}
      height={DEFAULT_CONFIG.height}
      durationInFrames={FPS * 20}
      defaultProps={
        {
          audioFile: 'audio.wav',
          audioStartSeconds: 0,
          durationSeconds: 20,
          clipFiles: [],
          aspectRatio: '9x16',
          transition: 'cut',
          trackTitle: '',
          artistName: 'illutible',
          ctaText: 'illutible.com',
        } satisfies BasicReelProps
      }
      calculateMetadata={({ props }) => {
        const aspect = isAspectRatio(props.aspectRatio)
          ? props.aspectRatio
          : '9x16'
        const config = ASPECT_RATIO_CONFIGS[aspect]
        return {
          durationInFrames: Math.max(1, Math.round(props.durationSeconds * FPS)),
          width: config.width,
          height: config.height,
        }
      }}
    />
  )
}
