import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from 'remotion'
import type { MarketingManifest, MarketingScene, MarketingBranding } from './types.js'
import { DynamicScene } from './primitives/DynamicScene.js'
import { AccentGlow } from './primitives/basics.js'

/**
 * Top-level composition. Plays the voice-over across the entire
 * timeline, ducks music underneath, and renders hook → each scene → cta
 * in a Sequence. Per-scene visual content comes from
 * `mockCompiledCode` evaluated by DynamicScene; scenes without that
 * field fall back to the accent-gradient backdrop.
 */
export const MarketingVideo: React.FC<{ manifest: MarketingManifest }> = ({ manifest }) => {
  const { fps } = useVideoConfig()
  const { script, branding, voiceoverUrl, musicUrl, musicVolume } = manifest

  const segments: Array<{
    kind: 'hook' | 'scene' | 'cta'
    durationSeconds: number
    sceneIndex: number
  }> = [
    { kind: 'hook', durationSeconds: script.hook.durationSeconds, sceneIndex: -1 },
    ...script.scenes.map((s, i) => ({ kind: 'scene' as const, durationSeconds: s.durationSeconds, sceneIndex: i })),
    { kind: 'cta', durationSeconds: script.cta.durationSeconds, sceneIndex: -1 },
  ]

  let cursor = 0
  return (
    <AbsoluteFill style={{ background: branding.bgColor, fontFamily: branding.fontFamily, color: branding.textColor }}>
      {voiceoverUrl && <Audio src={voiceoverUrl} />}
      {musicUrl && <Audio src={musicUrl} volume={musicVolume ?? 0.15} />}

      {segments.map((seg, i) => {
        const fromFrame = Math.round(cursor * fps)
        const durationInFrames = Math.max(1, Math.round(seg.durationSeconds * fps))
        cursor += seg.durationSeconds
        return (
          <Sequence key={i} from={fromFrame} durationInFrames={durationInFrames}>
            {seg.kind === 'hook' && <HookSegment script={script} branding={branding} />}
            {seg.kind === 'scene' && (
              <SceneSegment
                scene={script.scenes[seg.sceneIndex]!}
                branding={branding}
                screenshot={
                  script.scenes[seg.sceneIndex]!.screenshotIndex !== null
                    ? manifest.screenshots[script.scenes[seg.sceneIndex]!.screenshotIndex!] ?? null
                    : null
                }
              />
            )}
            {seg.kind === 'cta' && <CtaSegment script={script} branding={branding} />}
          </Sequence>
        )
      })}

      <BrandMark branding={branding} />
    </AbsoluteFill>
  )
}

const FadeInUp: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0,
  children,
  style,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = spring({ frame: frame - delay * fps, fps, config: { damping: 18, stiffness: 90 } })
  const translateY = interpolate(progress, [0, 1], [40, 0])
  const opacity = interpolate(progress, [0, 1], [0, 1])
  return <div style={{ opacity, transform: `translateY(${translateY}px)`, ...style }}>{children}</div>
}

const HookSegment: React.FC<{
  script: MarketingManifest['script']
  branding: MarketingBranding
}> = ({ script, branding }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '8% 10%' }}>
    <AccentGlow color={branding.accentColor} size={900} opacity={0.25} style={{ top: '-10%', left: '50%', transform: 'translateX(-50%)' }} />
    <FadeInUp>
      <h1 style={{
        fontSize: 'clamp(56px, 8vw, 140px)',
        fontWeight: 800,
        margin: 0,
        textAlign: 'center',
        lineHeight: 1.05,
        letterSpacing: '-0.03em',
        color: branding.textColor,
      }}>
        {script.hook.headline}
      </h1>
    </FadeInUp>
    <FadeInUp delay={0.4}>
      <div style={{
        marginTop: 36,
        width: 96,
        height: 4,
        borderRadius: 4,
        background: branding.accentColor,
        boxShadow: `0 0 24px ${branding.accentColor}`,
      }} />
    </FadeInUp>
  </AbsoluteFill>
)

/**
 * Renders a scene. Layout decision tree:
 *   - mockCompiledCode + headlinePanel=false → full-bleed mock
 *   - mockCompiledCode + headlinePanel=true|undefined → headline panel
 *     on left, mock on right
 *   - no mockCompiledCode → simple text-only layout (with optional
 *     screenshot)
 */
const SceneSegment: React.FC<{
  scene: MarketingScene
  branding: MarketingBranding
  screenshot: MarketingManifest['screenshots'][number] | null
}> = ({ scene, branding, screenshot }) => {
  const hasMock = !!scene.mockCompiledCode
  const showHeadlinePanel = scene.headlinePanel !== false

  if (hasMock && !showHeadlinePanel) {
    // Full-bleed mock — voice-over carries the story.
    return (
      <AbsoluteFill>
        <DynamicScene
          compiledCode={scene.mockCompiledCode!}
          branding={branding}
          headline={scene.headline}
          subhead={scene.subhead}
        />
      </AbsoluteFill>
    )
  }

  if (hasMock) {
    // Split: headline panel + mock area.
    return (
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'row' }}>
        <div style={{
          width: '38%',
          padding: '6% 4% 6% 6%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 28,
        }}>
          <FadeInUp>
            <h2 style={{
              fontSize: 'clamp(40px, 4.4vw, 80px)',
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              color: branding.textColor,
            }}>{scene.headline}</h2>
          </FadeInUp>
          {scene.subhead && (
            <FadeInUp delay={0.25}>
              <p style={{
                fontSize: 'clamp(20px, 2vw, 32px)',
                fontWeight: 400,
                margin: 0,
                lineHeight: 1.45,
                opacity: 0.72,
                color: branding.textColor,
              }}>{scene.subhead}</p>
            </FadeInUp>
          )}
        </div>
        <div style={{ flex: 1, position: 'relative', padding: '4% 6% 4% 0' }}>
          <FadeInUp delay={0.3} style={{ width: '100%', height: '100%' }}>
            <DynamicScene
              compiledCode={scene.mockCompiledCode!}
              branding={branding}
              headline={scene.headline}
              subhead={scene.subhead}
            />
          </FadeInUp>
        </div>
      </AbsoluteFill>
    )
  }

  // No compiled mock — simple text layout.
  return (
    <AbsoluteFill style={{ padding: '6% 8%', flexDirection: 'column', justifyContent: 'center', gap: 40 }}>
      <FadeInUp>
        <h2 style={{
          fontSize: 'clamp(40px, 5.5vw, 96px)',
          fontWeight: 700,
          margin: 0,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          color: branding.textColor,
        }}>{scene.headline}</h2>
      </FadeInUp>
      {scene.subhead && (
        <FadeInUp delay={0.3}>
          <p style={{
            fontSize: 'clamp(22px, 2.4vw, 38px)',
            fontWeight: 400,
            margin: 0,
            lineHeight: 1.4,
            opacity: 0.75,
            color: branding.textColor,
            maxWidth: '80%',
          }}>{scene.subhead}</p>
        </FadeInUp>
      )}
      {screenshot && (
        <FadeInUp delay={0.5}>
          <div style={{
            marginTop: 24,
            padding: 12,
            background: branding.accentColor + '22',
            border: `1px solid ${branding.accentColor}44`,
            borderRadius: branding.radius ?? 14,
            maxWidth: '90%',
            alignSelf: 'flex-start',
          }}>
            <Img src={screenshot.url} style={{ width: '100%', borderRadius: (branding.radius ?? 14) - 4 }} />
          </div>
        </FadeInUp>
      )}
    </AbsoluteFill>
  )
}

const CtaSegment: React.FC<{
  script: MarketingManifest['script']
  branding: MarketingBranding
}> = ({ script, branding }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: '8% 10%', gap: 40 }}>
    <AccentGlow color={branding.accentColor} size={1100} opacity={0.3} style={{ bottom: '-15%', left: '50%', transform: 'translateX(-50%)' }} />
    <FadeInUp>
      <h1 style={{
        fontSize: 'clamp(44px, 6vw, 108px)',
        fontWeight: 800,
        margin: 0,
        textAlign: 'center',
        lineHeight: 1.05,
        letterSpacing: '-0.03em',
        color: branding.textColor,
      }}>{script.cta.headline}</h1>
    </FadeInUp>
    <FadeInUp delay={0.4}>
      <button style={{
        padding: '20px 40px',
        fontSize: 30,
        fontWeight: 600,
        background: branding.accentColor,
        color: '#fff',
        border: 'none',
        borderRadius: branding.radius ?? 14,
        boxShadow: `0 12px 50px ${branding.accentColor}77`,
        fontFamily: 'inherit',
      }}>{script.cta.buttonLabel}</button>
    </FadeInUp>
    {branding.websiteUrl && (
      <FadeInUp delay={0.6}>
        <p style={{ margin: 0, opacity: 0.6, fontSize: 22, color: branding.textColor }}>
          {branding.websiteUrl.replace(/^https?:\/\//, '')}
        </p>
      </FadeInUp>
    )}
  </AbsoluteFill>
)

const BrandMark: React.FC<{ branding: MarketingBranding }> = ({ branding }) => (
  <AbsoluteFill style={{ pointerEvents: 'none' }}>
    <div style={{
      position: 'absolute', top: 40, left: 48,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {branding.logoUrl && (
        <Img src={branding.logoUrl} style={{ height: 44, width: 'auto', maxWidth: 180, objectFit: 'contain' }} />
      )}
      <span style={{ fontWeight: 700, fontSize: 20, color: branding.textColor, opacity: 0.85 }}>
        {branding.productName}
      </span>
    </div>
  </AbsoluteFill>
)
