/**
 * MockFrame: chrome that wraps the scene content. The architect picks a
 * `framing` (browser / mobile / terminal / fullbleed / split) in the
 * manifest — but the compiled scene also gets to use this primitive
 * directly to add chrome inside its own layout. Both code paths land
 * here.
 */
import React from 'react'

export type MockFrameTone = 'light' | 'dark'

export const MockFrame: React.FC<{
  variant?: 'browser' | 'mobile' | 'terminal' | 'card'
  url?: string
  tone?: MockFrameTone
  children: React.ReactNode
  style?: React.CSSProperties
}> = ({ variant = 'browser', url, tone = 'dark', children, style }) => {
  const bg = tone === 'dark' ? '#0f1115' : '#ffffff'
  const fg = tone === 'dark' ? '#e8eaed' : '#1c1f24'
  const border = tone === 'dark' ? '#22262d' : '#e3e5e8'
  const chromeBg = tone === 'dark' ? '#16181d' : '#f7f8fa'

  if (variant === 'terminal') {
    return (
      <div style={{
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: 14,
        boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
        overflow: 'hidden',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        ...style,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: chromeBg, borderBottom: `1px solid ${border}` }}>
          <Dot color="#ff5f56" />
          <Dot color="#ffbd2e" />
          <Dot color="#27c93f" />
          <span style={{ marginLeft: 16, fontSize: 14, opacity: 0.6 }}>{url ?? 'bash'}</span>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    )
  }

  if (variant === 'mobile') {
    return (
      <div style={{
        background: bg,
        color: fg,
        border: `8px solid #1a1a1a`,
        borderRadius: 48,
        boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        ...style,
      }}>
        <div style={{ height: 32, background: '#0a0a0a', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', paddingBottom: 4 }}>
          <div style={{ width: 120, height: 4, borderRadius: 2, background: '#333' }} />
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div style={{
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: 18,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        padding: 28,
        ...style,
      }}>
        {children}
      </div>
    )
  }

  // browser (default)
  return (
    <div style={{
      background: bg,
      color: fg,
      border: `1px solid ${border}`,
      borderRadius: 14,
      boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
      overflow: 'hidden',
      ...style,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        background: chromeBg,
        borderBottom: `1px solid ${border}`,
      }}>
        <Dot color="#ff5f56" />
        <Dot color="#ffbd2e" />
        <Dot color="#27c93f" />
        <div style={{
          flex: 1,
          marginLeft: 12,
          padding: '6px 12px',
          background: tone === 'dark' ? '#0b0d12' : '#fff',
          border: `1px solid ${border}`,
          borderRadius: 8,
          fontSize: 13,
          opacity: 0.7,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>
          {url ?? 'https://app.example.com'}
        </div>
      </div>
      <div style={{ padding: 28 }}>{children}</div>
    </div>
  )
}

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <div style={{ width: 12, height: 12, borderRadius: 6, background: color }} />
)
