import { Composition, registerRoot } from 'remotion'
import { MarketingVideo } from './MarketingVideo.js'
import type { MarketingManifest, VideoFormat } from './types.js'

/**
 * Remotion entrypoint. Registers a single composition "MarketingVideo"
 * which the render service drives with width/height/fps/durationInFrames
 * derived from the manifest at render time (the API passes them).
 *
 * The defaults below are only used during interactive `npx remotion
 * preview` — real renders override them via selectComposition + the
 * width/height/fps the API sends.
 */

const FORMAT_DIMENSIONS: Record<VideoFormat, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1':  { width: 1080, height: 1080 },
}

const DEFAULT_PROPS: MarketingManifest = {
  videoId: 'preview',
  generatedAt: new Date().toISOString(),
  script: {
    hook: { voiceover: '', headline: 'Your headline here', durationSeconds: 4 },
    scenes: [{
      voiceover: '',
      headline: 'A scene',
      subhead: 'Something the product does',
      screenshotIndex: null,
      durationSeconds: 5,
    }],
    cta: { voiceover: '', headline: 'Start today', buttonLabel: 'Get started', durationSeconds: 3 },
    totalDurationSeconds: 12,
  },
  screenshots: [],
  branding: {
    productName: 'Preview',
    accentColor: '#2563eb',
    bgColor: '#0b0d12',
    textColor: '#f8fafc',
    fontFamily: 'Inter, system-ui, sans-serif',
    logoUrl: null,
  },
  voiceoverUrl: null,
  voiceoverPath: null,
  format: '16:9',
}

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {(Object.keys(FORMAT_DIMENSIONS) as VideoFormat[]).map((fmt) => {
        const { width, height } = FORMAT_DIMENSIONS[fmt]
        return (
          <Composition
            key={fmt}
            id={`MarketingVideo-${fmt}`}
            component={MarketingVideo}
            width={width}
            height={height}
            fps={30}
            durationInFrames={Math.round((DEFAULT_PROPS.script.totalDurationSeconds ?? 12) * 30)}
            defaultProps={{ manifest: DEFAULT_PROPS }}
            calculateMetadata={({ props }) => {
              const m = props.manifest
              const total =
                m.script.hook.durationSeconds +
                m.script.scenes.reduce((acc, s) => acc + s.durationSeconds, 0) +
                m.script.cta.durationSeconds
              const fmt = m.format ?? '16:9'
              const dim = FORMAT_DIMENSIONS[fmt]
              return {
                durationInFrames: Math.max(1, Math.round(total * 30)),
                width: dim.width,
                height: dim.height,
                fps: 30,
              }
            }}
          />
        )
      })}
      <Composition
        id="MarketingVideo"
        component={MarketingVideo}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={360}
        defaultProps={{ manifest: DEFAULT_PROPS }}
        calculateMetadata={({ props }) => {
          const m = props.manifest
          const total =
            m.script.hook.durationSeconds +
            m.script.scenes.reduce((acc, s) => acc + s.durationSeconds, 0) +
            m.script.cta.durationSeconds
          const fmt = m.format ?? '16:9'
          const dim = FORMAT_DIMENSIONS[fmt]
          return {
            durationInFrames: Math.max(1, Math.round(total * 30)),
            width: dim.width,
            height: dim.height,
            fps: 30,
          }
        }}
      />
    </>
  )
}

registerRoot(RemotionRoot)
