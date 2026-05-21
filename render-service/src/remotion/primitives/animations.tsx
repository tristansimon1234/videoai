/**
 * Animation primitives the architect/designer can call from compiled
 * mock scenes. Each one reads the current frame via Remotion hooks
 * and renders timing-driven JSX. Names + prop shapes match what the
 * mock-code.compiler.ts whitelist allows.
 */
import React from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

/** Text that types out character by character. */
export const TypewriterText: React.FC<{
  text: string
  startFrame?: number
  charsPerSecond?: number
  style?: React.CSSProperties
  showCursor?: boolean
}> = ({ text, startFrame = 0, charsPerSecond = 40, style, showCursor = true }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const elapsed = Math.max(0, frame - startFrame) / fps
  const charsRevealed = Math.min(text.length, Math.floor(elapsed * charsPerSecond))
  const visible = text.slice(0, charsRevealed)
  const cursorBlink = Math.floor(frame / (fps / 2)) % 2 === 0
  return (
    <span style={style}>
      {visible}
      {showCursor && charsRevealed < text.length && (
        <span style={{ opacity: cursorBlink ? 1 : 0 }}>▍</span>
      )}
    </span>
  )
}

/** Stagger children fade-in by `delayBetween` seconds. */
export const FadeInStagger: React.FC<{
  children: React.ReactNode
  startFrame?: number
  delayBetween?: number
  style?: React.CSSProperties
}> = ({ children, startFrame = 0, delayBetween = 0.15, style }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <div style={style}>
      {React.Children.toArray(children).map((child, i) => {
        const localFrame = frame - startFrame - i * delayBetween * fps
        const progress = spring({
          frame: localFrame,
          fps,
          config: { damping: 18, stiffness: 90, mass: 0.8 },
        })
        const translateY = interpolate(progress, [0, 1], [24, 0])
        const opacity = interpolate(progress, [0, 1], [0, 1])
        return (
          <div key={i} style={{ opacity, transform: `translateY(${translateY}px)` }}>
            {child}
          </div>
        )
      })}
    </div>
  )
}

/** Glow that pulses at `period` seconds. Wraps children unchanged and
 *  paints a soft halo behind them. */
export const PulseGlow: React.FC<{
  color: string
  period?: number
  intensity?: number
  size?: number
  children?: React.ReactNode
  style?: React.CSSProperties
}> = ({ color, period = 2.4, intensity = 0.6, size = 120, children, style }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const phase = (frame / fps) % period / period
  const opacity = (Math.sin(phase * Math.PI * 2) + 1) / 2 * intensity
  return (
    <div style={{ position: 'relative', display: 'inline-flex', ...style }}>
      <div
        style={{
          position: 'absolute',
          inset: -size / 2,
          background: `radial-gradient(circle, ${color}${alpha(opacity)} 0%, transparent 70%)`,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  )
}

/** Children breathe in/out (1 → 1.05 → 1) at `period` seconds. */
export const BreathingScale: React.FC<{
  period?: number
  amplitude?: number
  children: React.ReactNode
  style?: React.CSSProperties
}> = ({ period = 3.2, amplitude = 0.04, children, style }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const phase = (frame / fps) % period / period
  const scale = 1 + Math.sin(phase * Math.PI * 2) * amplitude
  return <div style={{ transform: `scale(${scale})`, ...style }}>{children}</div>
}

/** Dot that orbits a center point. Positioned absolutely; the parent
 *  should be `position: relative`. */
export const OrbitingDot: React.FC<{
  radius: number
  period?: number
  size?: number
  color: string
  phaseOffset?: number
}> = ({ radius, period = 4, size = 12, color, phaseOffset = 0 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = (frame / fps) / period + phaseOffset
  const x = Math.cos(t * Math.PI * 2) * radius
  const y = Math.sin(t * Math.PI * 2) * radius
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        transform: `translate(${x - size / 2}px, ${y - size / 2}px)`,
        boxShadow: `0 0 24px ${color}88`,
      }}
    />
  )
}

/** Straight line connector between two anchors (percentages 0-100 of
 *  the parent box). Animated dash on draw. */
export const Connector: React.FC<{
  from: { xPct: number; yPct: number }
  to: { xPct: number; yPct: number }
  color: string
  width?: number
  startFrame?: number
  drawDuration?: number
}> = ({ from, to, color, width = 2, startFrame = 0, drawDuration = 0.8 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = interpolate(
    frame,
    [startFrame, startFrame + drawDuration * fps],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <line
        x1={from.xPct}
        y1={from.yPct}
        x2={from.xPct + (to.xPct - from.xPct) * easeOut(progress)}
        y2={from.yPct + (to.yPct - from.yPct) * easeOut(progress)}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** A bright particle that travels from `from` to `to`. Loops every
 *  `period` seconds. Use for "data flow" illustrations. */
export const TravelingPhoton: React.FC<{
  from: { xPct: number; yPct: number }
  to: { xPct: number; yPct: number }
  color: string
  period?: number
  size?: number
}> = ({ from, to, color, period = 2.5, size = 14 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const phase = ((frame / fps) % period) / period
  const x = from.xPct + (to.xPct - from.xPct) * phase
  const y = from.yPct + (to.yPct - from.yPct) * phase
  const opacity = phase < 0.15 ? phase / 0.15 : phase > 0.85 ? (1 - phase) / 0.15 : 1
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 ${size * 2}px ${color}, 0 0 ${size}px ${color}`,
        opacity,
        pointerEvents: 'none',
      }}
    />
  )
}

/** Field of slowly drifting dots — ambient texture. */
export const ParticleField: React.FC<{
  count?: number
  color: string
  size?: number
  speed?: number
  style?: React.CSSProperties
}> = ({ count = 30, color, size = 3, speed = 0.06, style }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Deterministic seeded particles so the layout is stable across renders.
  const particles = React.useMemo(() => {
    const arr: { x: number; y: number; phase: number }[] = []
    for (let i = 0; i < count; i++) {
      const seed = i * 9301 + 49297
      arr.push({
        x: (seed % 1000) / 10,
        y: ((seed * 7) % 1000) / 10,
        phase: (i % 7) / 7,
      })
    }
    return arr
  }, [count])
  const t = frame / fps * speed
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', ...style }}>
      {particles.map((p, i) => {
        const yOffset = ((p.y + t * 100 + p.phase * 30) % 110) - 5
        const opacity = 0.3 + Math.sin((t + p.phase) * Math.PI * 2) * 0.2
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${p.x}%`,
              top: `${yOffset}%`,
              width: size,
              height: size,
              borderRadius: '50%',
              background: color,
              opacity,
            }}
          />
        )
      })}
    </div>
  )
}

function alpha(opacity: number): string {
  const v = Math.max(0, Math.min(255, Math.round(opacity * 255)))
  return v.toString(16).padStart(2, '0')
}
