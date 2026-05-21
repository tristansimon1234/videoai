/**
 * Render service for videoai. Wire-compatible with the main app's
 * `video.client.ts`:
 *
 *   POST /render-marketing-video
 *     body: { runId, manifestUrl, manifest?, compositionId, remotionServeUrl,
 *             fps, widthPx, heightPx, supabaseUrl, serviceKey }
 *     → { videoPath: "videos/<runId>/marketing.mp4" }
 *
 * The bundle is pre-built at Docker build time (`scripts/bundle.ts`) and
 * served from /bundle on the same container, so the main app can point
 * REMOTION_SERVE_URL at `<railway-url>/bundle` and the request loop
 * stays inside Railway (no Vercel deploy-protection 401).
 */
import express from 'express'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { selectComposition, renderMedia } from '@remotion/renderer'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE_DIR = path.resolve(__dirname, '..', 'remotion-bundle')

const RenderBodySchema = z.object({
  runId: z.string().min(1),
  manifestUrl: z.string().url(),
  manifest: z.unknown().optional(),
  compositionId: z.string().default('MarketingVideo'),
  remotionServeUrl: z.string().url().optional(),
  fps: z.number().int().positive().default(30),
  widthPx: z.number().int().positive().default(1920),
  heightPx: z.number().int().positive().default(1080),
  supabaseUrl: z.string().url(),
  serviceKey: z.string().min(20),
})

const app = express()
app.use(express.json({ limit: '10mb' }))

// Serve the pre-built Remotion site so the renderer can fetch it from
// the same container. The main app should set REMOTION_SERVE_URL to
// `<railway-host>/bundle`.
app.use('/bundle', express.static(BUNDLE_DIR, { fallthrough: false }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, bundleDir: BUNDLE_DIR })
})

app.post('/render-marketing-video', async (req, res) => {
  const started = Date.now()
  const parsed = RenderBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() })
    return
  }
  const body = parsed.data

  try {
    // 1. Resolve the manifest. Prefer the inline copy when the API sent
    //    it (avoids a round-trip + the "Unexpected token <" failure
    //    mode when the URL serves HTML by mistake). Otherwise fetch.
    let manifest: unknown
    if (body.manifest !== undefined) {
      manifest = body.manifest
    } else {
      const r = await fetch(body.manifestUrl)
      if (!r.ok) throw new Error(`Manifest fetch failed: ${r.status} ${r.statusText}`)
      manifest = await r.json()
    }

    // 2. Resolve the serve URL. Default to the local bundle the
    //    container serves at /bundle if the API didn't specify (the API
    //    *should* specify via REMOTION_SERVE_URL though).
    const serveUrl = body.remotionServeUrl ?? `file://${BUNDLE_DIR}`

    // 3. Pick the composition with calculated metadata derived from the
    //    manifest (width/height/duration are computed in Root.tsx's
    //    calculateMetadata so they always match the manifest).
    const composition = await selectComposition({
      serveUrl,
      id: body.compositionId,
      inputProps: { manifest },
    })

    // 4. Render to a temp MP4 then upload to Supabase Storage.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videoai-render-'))
    const outPath = path.join(tmpDir, 'marketing.mp4')

    console.log(`[render] ${body.runId}: ${composition.width}×${composition.height} ${composition.fps}fps ${composition.durationInFrames}f`)

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outPath,
      inputProps: { manifest },
      // Reasonable defaults; tune later. concurrency=null lets Remotion
      // pick based on CPU count.
      concurrency: null,
    })

    // 5. Upload to Supabase Storage.
    const supabase = createClient(body.supabaseUrl, body.serviceKey, {
      auth: { persistSession: false },
    })
    const videoPath = `videos/${body.runId}/marketing.mp4`
    const buf = await fs.readFile(outPath)
    const { error } = await supabase.storage
      .from('artifacts')
      .upload(videoPath, buf, { contentType: 'video/mp4', upsert: true })
    if (error) throw new Error(`Storage upload failed: ${error.message}`)

    // 6. Clean up temp dir best-effort.
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`[render] ${body.runId} ✓ ${videoPath} in ${elapsed}s`)
    res.json({ videoPath })
  } catch (err) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error(`[render] ${body.runId} ✗ after ${elapsed}s: ${message}`)
    if (stack) console.error(stack)
    res.status(500).json({ error: message, stack })
  }
})

const port = Number(process.env.PORT) || 8080
app.listen(port, () => {
  console.log(`[render-service] listening on :${port}, bundle=${BUNDLE_DIR}`)
})
