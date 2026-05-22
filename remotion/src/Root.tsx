import React from 'react'
import { Composition } from 'remotion'
import { MarketingVideo, totalDurationInFrames } from './MarketingVideo.js'
import { resolveFormatDimensions } from './manifest.js'
import { SAMPLE_MANIFEST } from './sample-manifest.js'

const FPS = 30
// Default canvas (16:9). calculateMetadata overrides this from the manifest.
const DEFAULT = resolveFormatDimensions('16:9')

/**
 * The composition uses the bundled SAMPLE_MANIFEST as defaultProps so the
 * template is always renderable cold. Real-data preview locally:
 *   npm run marketing:preview <runId>            # writes remotion/manifest.json
 *   npm run remotion:preview                     # passes --props=manifest.json
 * Real-data render in production: the video-service passes the manifest as
 * inputProps to selectComposition + renderMedia, and `calculateMetadata`
 * recomputes durationInFrames + width/height from those props.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MarketingVideo"
        component={MarketingVideo}
        durationInFrames={Math.max(1, totalDurationInFrames(SAMPLE_MANIFEST, FPS))}
        fps={FPS}
        width={DEFAULT.width}
        height={DEFAULT.height}
        defaultProps={{ manifest: SAMPLE_MANIFEST }}
        calculateMetadata={({ props }) => {
          const dims = resolveFormatDimensions(props.manifest.format)
          return {
            durationInFrames: Math.max(1, totalDurationInFrames(props.manifest, FPS)),
            width: dims.width,
            height: dims.height,
          }
        }}
      />
    </>
  )
}
