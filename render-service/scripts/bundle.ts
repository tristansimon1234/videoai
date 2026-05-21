/**
 * Pre-bundle the Remotion site once at Docker build time. The output
 * directory (../remotion-bundle relative to dist/) is then served by
 * the Express server at /bundle, and `selectComposition` / `renderMedia`
 * point at that local URL.
 *
 * Running this on every render would re-bundle webpack on every
 * request — slow and pointless since the composition code is static.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENTRY = path.resolve(__dirname, '..', 'src', 'remotion', 'Root.tsx')
const OUT = path.resolve(__dirname, '..', 'remotion-bundle')

async function main(): Promise<void> {
  console.log(`[bundle] entry=${ENTRY}`)
  console.log(`[bundle] out=${OUT}`)
  const url = await bundle({
    entryPoint: ENTRY,
    outDir: OUT,
    onProgress: (p) => process.stdout.write(`\r[bundle] ${Math.round(p)}%`),
    webpackOverride: (config) => config,
  })
  console.log(`\n[bundle] done → ${url}`)
}

main().catch((err) => {
  console.error('[bundle] failed:', err)
  process.exit(1)
})
