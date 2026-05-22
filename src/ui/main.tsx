import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design-system/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root in index.html')

const missing: string[] = []
if (!import.meta.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
if (!import.meta.env.VITE_SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY')

if (missing.length > 0) {
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#0a0a0a;color:#fafafa;padding:24px">
      <div style="max-width:560px">
        <h1 style="font-size:20px;margin:0 0 12px;color:#f87171">Configuration error</h1>
        <p style="margin:0 0 16px;line-height:1.5;color:#d4d4d4">
          The build is missing required environment variable${missing.length > 1 ? 's' : ''}:
        </p>
        <ul style="margin:0 0 16px;padding-left:20px;color:#fafafa;font-family:ui-monospace,monospace;font-size:13px">
          ${missing.map((k) => `<li>${k}</li>`).join('')}
        </ul>
        <p style="margin:0;line-height:1.5;color:#a3a3a3;font-size:13px">
          Set ${missing.length > 1 ? 'these' : 'this'} in Vercel → Project Settings → Environment Variables
          for the Preview and Production scopes, then redeploy. Vite inlines <code style="font-family:ui-monospace,monospace">VITE_*</code> variables at build time, so changes require a fresh build.
        </p>
      </div>
    </div>
  `
} else {
  void import('./App.js').then(({ App }) => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
