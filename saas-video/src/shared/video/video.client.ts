import { env } from '../config/env.js'

function getBaseUrl(): string {
  if (!env.VIDEO_SERVICE_URL) throw new Error('VIDEO_SERVICE_URL is not configured')
  return env.VIDEO_SERVICE_URL
}

export function isVideoServiceConfigured(): boolean {
  return Boolean(env.VIDEO_SERVICE_URL)
}

async function callService<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const url = `${getBaseUrl()}${endpoint}`
  // Log non-secret payload keys so we can see what we sent if the service
  // returns a cryptic error. Skip supabase keys obviously.
  const visibleBody = Object.fromEntries(
    Object.entries(body).filter(([k]) => k !== 'serviceKey' && k !== 'supabaseUrl'),
  )
  console.log(`[video-service] POST ${endpoint} payload:`, JSON.stringify(visibleBody))

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      supabaseUrl: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    }),
  })

  // Read the body once as text — when the service returns a cryptic error
  // like "Unexpected token '<'" we want the full payload visible in logs,
  // not just the parsed `error` field. Same pattern works for both ok and
  // non-ok responses; we parse JSON ourselves below.
  const rawText = await res.text()

  if (!res.ok) {
    let parsed: { error?: string; details?: unknown; stack?: string } = {}
    try {
      parsed = JSON.parse(rawText)
    } catch {
      // Body wasn't JSON — fall through with rawText preview as the error.
    }
    const preview = rawText.replace(/\s+/g, ' ').slice(0, 400)
    console.error(
      `[video-service] ${endpoint} failed (${res.status} ${res.statusText}). Body: ${preview}`,
    )
    if (parsed.stack) console.error(`[video-service] Remote stack: ${parsed.stack}`)
    const stackSuffix = parsed.stack ? ` [remote stack: ${parsed.stack}]` : ''
    const detailsSuffix = parsed.details ? ` (details: ${JSON.stringify(parsed.details).slice(0, 200)})` : ''
    const detail = parsed.error
      ? `${parsed.error}${detailsSuffix}${stackSuffix}`
      : `HTTP ${res.status} ${res.statusText} — body: ${preview}`
    throw new Error(`Video service error: ${detail}`)
  }

  try {
    return JSON.parse(rawText) as T
  } catch (err) {
    const preview = rawText.replace(/\s+/g, ' ').slice(0, 400)
    console.error(
      `[video-service] ${endpoint} returned non-JSON body despite 200 OK. First 400 chars: ${preview}`,
    )
    throw new Error(
      `Video service returned non-JSON success response: ${(err as Error).message}. Body preview: "${preview}"`,
    )
  }
}

/**
 * Render a Remotion marketing-video composition to MP4. Vercel serverless
 * functions can't host Chromium (Remotion needs ~170 MB), so this work is
 * delegated to the standalone video-service that hosts the renderer.
 *
 * Wire protocol (the video-service implements):
 *   POST /render-marketing-video
 *   body: {
 *     runId: string,              // protocol field name; we pass our videoId here
 *     manifestUrl: string,        // public JSON manifest URL
 *     manifest?: unknown,         // optional inline manifest content
 *     compositionId: "MarketingVideo",
 *     remotionServeUrl: string,   // pre-bundled Remotion site URL
 *     fps: 30,
 *     widthPx: 1920,
 *     heightPx: 1080,
 *   }
 *   -> { videoPath: "videos/<videoId>/marketing.mp4" }
 *
 * The service fetches the manifest, passes it as `inputProps` to
 * @remotion/renderer's selectComposition + renderMedia, uploads the MP4
 * back to the artifacts bucket, and returns the path. A 45s × 30fps
 * render comfortably fits in Vercel's 300s function cap.
 */
export async function renderMarketingVideo(input: {
  runId: string
  manifestUrl: string
  /** Verified manifest content. Sent inline alongside the URL so a
   *  service-side update can use it as `inputProps` directly without
   *  re-fetching — eliminates the most likely cause of the service's
   *  "Unexpected token '<'" failures. Optional for backwards-compat. */
  manifest?: unknown
  remotionServeUrl: string
  compositionId?: string
  fps?: number
  widthPx?: number
  heightPx?: number
}): Promise<string> {
  const result = await callService<{ videoPath: string }>('/render-marketing-video', {
    runId: input.runId,
    manifestUrl: input.manifestUrl,
    ...(input.manifest !== undefined ? { manifest: input.manifest } : {}),
    compositionId: input.compositionId ?? 'MarketingVideo',
    remotionServeUrl: input.remotionServeUrl,
    fps: input.fps ?? 30,
    widthPx: input.widthPx ?? 1920,
    heightPx: input.heightPx ?? 1080,
  })
  console.log(`[video-service] Rendered marketing video → ${result.videoPath}`)
  return result.videoPath
}
