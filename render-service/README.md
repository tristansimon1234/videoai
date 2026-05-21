# videoai render service

Remotion render service for the videoai marketing-video pipeline. Wire-compatible with the main app's `src/shared/video/video.client.ts`.

## What it does

- Accepts `POST /render-marketing-video` with a manifest (or manifest URL)
- Evaluates each scene's `mockCompiledCode` inside a `DynamicScene` that exposes the full Remotion namespace the architect/designer agents emit code against (`MockFrame`, `Pill`, `AnimatedCursor`, `Icons`, `Charts`, `TypewriterText`, `FadeInStagger`, `PulseGlow`, `BreathingScale`, `OrbitingDot`, `Connector`, `TravelingPhoton`, `ParticleField`).
- Renders to MP4 with `@remotion/renderer`, uploads to Supabase Storage at `videos/<runId>/marketing.mp4`, returns `{ videoPath }`.
- Hosts the pre-built Remotion bundle at `/bundle` so the renderer doesn't reach back out to Vercel (avoids deploy-protection 401s).
- Supports 16:9 / 9:16 / 1:1 — width/height come from the manifest's `format` field via `calculateMetadata`.

## Deploy on Railway

1. Push the `render-service/` folder to its own GitHub repo (or point Railway at the subdirectory of this monorepo).
2. Railway → New Project → Deploy from GitHub.
3. Railway auto-detects the `Dockerfile`. Wait for the build (~5-10 minutes — includes Chromium download + Remotion bundle).
4. Settings → Networking → **Generate Domain**. Copy the URL.
5. On Vercel (main app), set:
   ```
   VIDEO_SERVICE_URL=https://<railway-host>
   REMOTION_SERVE_URL=https://<railway-host>/bundle
   ```
6. Redeploy Vercel. The next render lands in `artifacts/videos/<id>/marketing.mp4`.

## Local dev

```bash
cd render-service
npm install
npm run bundle   # builds ./remotion-bundle once
npm run dev      # starts the Express server on :8080
# in another terminal — preview compositions:
npx remotion preview src/remotion/Root.tsx
```

## Wire protocol

```
POST /render-marketing-video
body: {
  runId, manifestUrl, manifest?, compositionId,
  remotionServeUrl, fps, widthPx, heightPx,
  supabaseUrl, serviceKey
}
→ 200 { videoPath: "videos/<runId>/marketing.mp4" }
→ 500 { error, stack }
```

## Failure modes

- **Scene compile/render throws** → DynamicScene catches it via an ErrorBoundary and shows the accent-gradient fallback with the headline + subhead. The rest of the video keeps rendering.
- **Supabase upload fails** → propagates as 500 with the bucket error. Check `artifacts` bucket exists and is public.
- **Composition selection fails** → almost always a stale bundle. Rebuild the image.

## Adding new primitives

The mock-code compiler in the main app (`src/features/marketing-video/mock-code.compiler.ts`) maintains a whitelist of allowed `Remotion.X` references. Add a new primitive in two places:

1. Implement it in `src/remotion/primitives/`
2. Add the export to `RemotionNamespace` in `DynamicScene.tsx`
3. Add the symbol to `REMOTION_NAMESPACE` in `mock-code.compiler.ts` on the main app

If the compiler whitelist isn't updated, the lint will reject any LLM scene that uses the new name.
