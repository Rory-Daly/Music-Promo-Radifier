import React from 'react'
import { Composition } from 'remotion'
import { BasicReel, type BasicReelProps } from './BasicReel'

const FPS = 30

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="BasicReel"
        component={BasicReel}
        fps={FPS}
        width={1080}
        height={1920}
        durationInFrames={FPS * 20}
        defaultProps={
          {
            audioFile: 'audio.wav',
            audioStartSeconds: 0,
            durationSeconds: 20,
            clipFiles: [],
          } satisfies BasicReelProps
        }
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.round(props.durationSeconds * FPS)),
        })}
      />
    </>
  )
}
