/**
 * Icons namespace — exposes the full lucide-react catalog under
 * Remotion.Icons.X. The mock-code compiler whitelist no longer
 * restricts icon names (per the comment in mock-code.compiler.ts) —
 * lucide is large enough that any reasonable name resolves, and unknown
 * names fall back to a generic square outline at runtime via a Proxy.
 *
 * lucide-react exports a default object map of components. We wrap it
 * in a Proxy so `Icons.UnknownName` returns the fallback instead of
 * `undefined` (which would crash the scene when used inside JSX).
 */
import React from 'react'
import * as Lucide from 'lucide-react'

const FallbackIcon: React.FC<{ size?: number; color?: string; strokeWidth?: number }> = ({
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
)

type AnyIcon = React.FC<{ size?: number; color?: string; strokeWidth?: number; style?: React.CSSProperties }>

const lucideMap = Lucide as unknown as Record<string, AnyIcon | undefined>

export const Icons: Record<string, AnyIcon> = new Proxy(
  {},
  {
    get(_target, prop: string) {
      const component = lucideMap[prop]
      if (component && typeof component === 'function') return component
      return FallbackIcon
    },
  },
) as Record<string, AnyIcon>
