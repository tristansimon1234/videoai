/**
 * Small primitives the LLM-generated scenes use a lot: status pills,
 * accent-color glow halos, and the animated cursor that points at one
 * spot on the screen.
 */
import React from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

export type PillTone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'

const TONE_COLORS: Record<PillTone, { bg: string; fg: string; border: string }> = {
  default: { bg: 'rgba(255,255,255,0.06)', fg: '#e8eaed', border: 'rgba(255,255,255,0.12)' },
  muted:   { bg: 'rgba(255,255,255,0.04)', fg: '#9aa0a6', border: 'rgba(255,255,255,0.08)' },
  accent:  { bg: 'rgba(37,99,235,0.18)',   fg: '#93c5fd', border: 'rgba(37,99,235,0.35)' },
  success: { bg: 'rgba(34,197,94,0.18)',   fg: '#86efac', border: 'rgba(34,197,94,0.35)' },
  warning: { bg: 'rgba(245,158,11,0.18)',  fg: '#fcd34d', border: 'rgba(245,158,11,0.35)' },
  danger:  { bg: 'rgba(239,68,68,0.18)',   fg: '#fca5a5', border: 'rgba(239,68,68,0.35)' },
}

export const Pill: React.FC<{
  text: string
  tone?: PillTone
  icon?: React.ReactNode
  style?: React.CSSProperties
}> = ({ text, tone = 'default', icon, style }) => {
  const c = TONE_COLORS[tone]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      borderRadius: 999,
      background: c.bg,
      color: c.fg,
      border: `1px solid ${c.border}`,
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 1.2,
      ...style,
    }}>
      {icon}
      {text}
    </span>
  )
}

/** Soft radial glow positioned behind a focal point — usually the
 *  background accent under a stat or a key chart. */
export const AccentGlow: React.FC<{
  color: string
  size?: number
  opacity?: number
  style?: React.CSSProperties
}> = ({ color, size = 600, opacity = 0.35, style }) => (
  <div
    style={{
      position: 'absolute',
      width: size,
      height: size,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
      opacity,
      filter: 'blur(40px)',
      pointerEvents: 'none',
      ...style,
    }}
  />
)

/** A cursor that fades in, slides toward (leftPct, topPct), and clicks
 *  once. Per mock-code.compiler.ts contract: numeric leftPct/topPct
 *  (0-100), NOT a path array — the cursor stays anchored. */
export const AnimatedCursor: React.FC<{
  leftPct: number
  topPct: number
  appearAt?: number
  clickAt?: number
  label?: string
}> = ({ leftPct, topPct, appearAt = 0, clickAt, label }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({
    frame: frame - appearAt * fps,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.6 },
  })
  const opacity = interpolate(enter, [0, 1], [0, 1])
  const offset = interpolate(enter, [0, 1], [40, 0])
  const clickProgress = clickAt !== undefined
    ? spring({ frame: frame - clickAt * fps, fps, config: { damping: 12, stiffness: 220, mass: 0.4 } })
    : 0
  const clickScale = clickAt !== undefined
    ? 1 - Math.sin(Math.min(1, clickProgress) * Math.PI) * 0.18
    : 1
  return (
    <div
      style={{
        position: 'absolute',
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: `translate(-12px, -8px) translate(${offset}px, ${offset}px) scale(${clickScale})`,
        opacity,
        pointerEvents: 'none',
      }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 2 L4 18 L9 14 L12 21 L15 19 L12 12 L19 12 Z"
          fill="#ffffff"
          stroke="#0a0a0a"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      {label && (
        <div style={{
          marginTop: 6,
          marginLeft: 18,
          padding: '4px 10px',
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          fontSize: 12,
          borderRadius: 6,
          whiteSpace: 'nowrap',
          fontFamily: 'system-ui, sans-serif',
        }}>{label}</div>
      )}
    </div>
  )
}
