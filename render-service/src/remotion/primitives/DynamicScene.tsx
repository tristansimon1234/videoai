/**
 * DynamicScene — evaluates the per-scene `mockCompiledCode` the
 * architect/designer produced. The main app's mock-code.compiler.ts
 * compiles TSX to ES2020 JS that defines a `MockScene` function
 * component. We wrap that code in `new Function(React, Remotion,
 * branding, body)` and render the returned component.
 *
 * The Remotion namespace exposed to the compiled code must match the
 * whitelist in src/features/marketing-video/mock-code.compiler.ts:
 *   Core:      interpolate, spring, useCurrentFrame, useVideoConfig,
 *              AbsoluteFill, Img, Audio
 *   Design:    MockFrame, Pill, AccentGlow, AnimatedCursor, Icons, Charts
 *   Animation: TypewriterText, FadeInStagger, PulseGlow, BreathingScale,
 *              OrbitingDot, Connector, TravelingPhoton, ParticleField
 *
 * On evaluation failure we render an accent-gradient fallback that
 * preserves the brand colors so the scene at least looks intentional.
 */
import React from 'react'
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { MockFrame } from './MockFrame.js'
import { Pill, AccentGlow, AnimatedCursor } from './basics.js'
import {
  TypewriterText, FadeInStagger, PulseGlow, BreathingScale,
  OrbitingDot, Connector, TravelingPhoton, ParticleField,
} from './animations.js'
import { Icons } from './Icons.js'
import * as Charts from './Charts.js'
import type { MarketingBranding } from '../types.js'

const RemotionNamespace = {
  interpolate, spring, useCurrentFrame, useVideoConfig,
  AbsoluteFill, Img, Audio,
  MockFrame, Pill, AccentGlow, AnimatedCursor, Icons, Charts,
  TypewriterText, FadeInStagger, PulseGlow, BreathingScale,
  OrbitingDot, Connector, TravelingPhoton, ParticleField,
}

interface DynamicSceneProps {
  compiledCode: string
  branding: MarketingBranding
  /** Forwarded to the compiled MockScene so it can show context-aware
   *  copy without re-deriving it from branding. Optional. */
  headline?: string
  subhead?: string
}

export const DynamicScene: React.FC<DynamicSceneProps> = ({ compiledCode, branding, headline, subhead }) => {
  const Component = React.useMemo<React.FC<{
    branding: MarketingBranding
    headline?: string
    subhead?: string
  }> | null>(() => {
    try {
      const factory = new Function(
        'React',
        'Remotion',
        'branding',
        // Esbuild's output declares MockScene at top level. Append the
        // return so the same body can be evaluated as a function expr.
        `${compiledCode};return typeof MockScene !== 'undefined' ? MockScene : null;`,
      ) as (
        React: typeof import('react'),
        Remotion: typeof RemotionNamespace,
        branding: MarketingBranding,
      ) => React.FC<{ branding: MarketingBranding; headline?: string; subhead?: string }> | null
      return factory(React, RemotionNamespace, branding)
    } catch (err) {
      console.warn(`[dynamic-scene] eval failed: ${(err as Error).message}`)
      return null
    }
  }, [compiledCode, branding])

  if (!Component) {
    return <FallbackGradient branding={branding} headline={headline} subhead={subhead} />
  }

  return (
    <SceneErrorBoundary fallback={<FallbackGradient branding={branding} headline={headline} subhead={subhead} />}>
      <Component branding={branding} headline={headline} subhead={subhead} />
    </SceneErrorBoundary>
  )
}

/** Accent-gradient backdrop with the headline + subhead overlaid. Used
 *  when the compiled scene either failed to evaluate or threw at render
 *  time. Same look across both failure modes. */
const FallbackGradient: React.FC<{
  branding: MarketingBranding
  headline?: string
  subhead?: string
}> = ({ branding, headline, subhead }) => (
  <AbsoluteFill
    style={{
      background: `linear-gradient(135deg, ${branding.accentColor}, ${branding.accentSecondary ?? darken(branding.accentColor)})`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8% 10%',
      gap: 24,
    }}
  >
    {headline && (
      <h2 style={{
        fontSize: 'clamp(48px, 6vw, 96px)',
        fontWeight: 800,
        margin: 0,
        color: '#fff',
        textAlign: 'center',
        lineHeight: 1.1,
        letterSpacing: '-0.02em',
        textShadow: '0 4px 30px rgba(0,0,0,0.3)',
      }}>{headline}</h2>
    )}
    {subhead && (
      <p style={{
        fontSize: 'clamp(20px, 2.2vw, 32px)',
        margin: 0,
        color: 'rgba(255,255,255,0.85)',
        textAlign: 'center',
        maxWidth: '70%',
        lineHeight: 1.4,
      }}>{subhead}</p>
    )}
  </AbsoluteFill>
)

class SceneErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }
  componentDidCatch(error: Error): void {
    console.warn(`[dynamic-scene] render threw: ${error.message}`)
  }
  render(): React.ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

function darken(hex: string): string {
  // Crude darken — clamp to a hex 60% of the original components. Good
  // enough for the gradient backdrop; real two-tone uses accentSecondary.
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * 0.55)
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * 0.55)
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * 0.55)
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}
