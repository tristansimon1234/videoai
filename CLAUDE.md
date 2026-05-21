# CLAUDE.md

Notes for Claude sessions working in this repo. Keep this current — if a rule below stops being true, fix it here, not just in code.

## What this product does

Turns a one-paragraph product brief into a 45-second 1920×1080 marketing video. The pipeline is Anthropic Sonnet/Haiku → ElevenLabs voice + music → Remotion render. ~2-3 minutes end-to-end, ~€0.50 in API calls per video.

## Hard rules

- **No new top-level files** unless asked. Repo root is `README.md`, `CLAUDE.md`, configs, `src/`, `api/`, `supabase/`, `docs/`. Don't add planning docs, decision logs, or scratch notes here — work from chat context.
- **Don't change wire formats without checking.** `runId` on `POST /render-marketing-video` (see `src/shared/video/video.client.ts`) is intentionally that name — the Remotion render service is a separate deploy. Same for the `MarketingManifest` JSON shape that gets uploaded to Storage and fetched by the render service.
- **`tsc --noEmit` and `npm run build` must stay green.** No `any`, no `@ts-ignore`. Strict mode is on; `noUnusedLocals` + `noUnusedParameters` will reject dead imports.
- **Never log secrets.** `SUPABASE_SERVICE_KEY`, `STRIPE_*`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` only flow server-side. `src/shared/video/video.client.ts::callService` redacts `serviceKey` + `supabaseUrl` before logging payloads — do the same in any new outbound call.
- **No client-side service-role Supabase.** The browser uses `VITE_SUPABASE_ANON_KEY` only (see `src/ui/shared/api/supabase.ts`). Anything that needs the service key goes through `/api/*`.
- **RLS is the security model.** Every table has `enable row level security` + a `user_id = auth.uid()` policy. Don't bypass with the service-role key except in server handlers that have already gone through `authMiddleware` + an ownership check.

## Project layout

```
api/index.ts                   Vercel serverless entry — Express app w/ /api prefix
src/server.ts                  Local dev entry — same Express app, no prefix
src/app.ts                     createApp() + mountRoutes() shared by both entries

src/features/<area>/
  *.routes.ts                  Express router, Zod-validated bodies/params
  *.repository.ts              Supabase row → domain object mapping
  *.schema.ts                  Zod schemas + inferred types
  *.types.ts                   Plain domain interfaces
  *.service.ts                 Business logic (marketing-video only — others
                               are thin enough to live in routes)

src/shared/
  ai/anthropic.client.ts       generateSonnetText() — tool-use + plain text
  ai/elevenlabs.client.ts      synthesizeSpeech() + generateMusic()
  config/env.ts                Zod-validated env, fail-fast in production
  db/supabase.client.ts        Service-role client
  db/storage.repository.ts     upload + public URL
  design/colors.ts             Hex validation
  design/fonts.ts              Allowlist for the font picker
  middleware/auth.middleware.ts authMiddleware + getUserId()
  middleware/error.middleware.ts AppError + typed subclasses + errorHandler
  observability/sentry.ts      Optional Sentry init
  video/video.client.ts        Remotion render service HTTP client

src/ui/                        Vite + React SPA
  App.tsx                      Auth-gated router
  design-system/               Buttons, Modal, Spinner, StepperFlow, …
  features/<area>/             Route components

supabase/migrations/           Two SQL files — schema + credit RPCs
docs/DEPLOY.md                 First-deploy walkthrough
docs/EXTRACTION_HISTORY.md     Historical context only — ignore unless asked
```

## Stack

- Node 20, TypeScript 5.9 strict
- Vite 8 + React 19 + React Router 7 (SPA, NOT Next.js)
- Express 5 deployed as a single Vercel serverless function (`maxDuration: 300`)
- Supabase Postgres + Auth + Storage + RLS
- Anthropic Sonnet 4.6 (designer + edit) + Haiku 4.5 (architect)
- ElevenLabs v3 (TTS) + ElevenLabs Music
- Remotion (renders MP4 in a separate service called via `VIDEO_SERVICE_URL`)
- Stripe Checkout (credit packs)
- Upstash Redis (rate limiting, required in prod)

## Naming

- **Files**: kebab-case for plain modules (`marketing-video.service.ts`), PascalCase for React components (`GenerateModal.tsx`).
- **DB columns**: snake_case (`render_status`, `user_id`). Repositories map to camelCase in TS.
- **Routes**: kebab-case in URLs (`/api/marketing-videos`), camelCase params/body keys.
- **Zod schemas**: `<Thing>Schema` suffix; inferred type is `<Thing>Input`.
- **Errors**: throw `AppError` subclasses (`NotFoundError`, `ValidationError`, `DatabaseError`, `QuotaExceededError`). The middleware turns them into typed JSON responses; 5xx flow through Sentry.

## Pipeline (marketing-video)

1. `POST /api/marketing-videos` validates the brief + resolves the brand.
2. `spendCredit` (atomic Postgres RPC) decrements the user's balance.
3. `createMarketingVideo` inserts a `pending` row; a partial unique index caps in-flight pipelines to 1 per user.
4. `generateMarketingVideo` (in `marketing-video.service.ts`):
   - Architect call (Haiku) → script structure + per-scene `visualMode` + `visualBrief`.
   - N parallel designer calls (Sonnet) → per-scene TSX → `esbuild.transform` → stored on the manifest as `mockCompiledCode`.
   - ElevenLabs TTS → MP3 uploaded to Storage.
   - ElevenLabs Music (or user-uploaded track) → MP3 uploaded to Storage.
   - Manifest JSON uploaded to Storage.
5. `renderMarketingVideoForRun` → `POST /render-marketing-video` to the video service → returns the MP4 path → `render_status = 'ready'`.
6. Any failure between step 3 and 5 → `refundCredit` + `render_status = 'failed'` with the human-readable reason.

The two-stage architect/designer split is load-bearing: a monolithic prompt dropped `mockCode` on 3/4 scenes due to token budget. Don't collapse it back.

## When tests don't exist

There's no test suite yet. Verify behaviour by:
- `npx tsc --noEmit && npm run build` — must be clean before pushing.
- `npm run dev:server` + `npm run dev:client`, then drive the UI through signup → onboarding → generate (see `docs/DEPLOY.md` smoke test).
- For backend-only changes: `curl` the affected route with a valid Supabase JWT.

If you add tests, put them in `src/**/*.test.ts` and add a `test` script.

## Don't touch without asking

- `supabase/migrations/*.sql` after they've been applied to a deployed Supabase project — write a new migration instead.
- The `MarketingManifest` JSON shape (`src/features/marketing-video/marketing-video.types.ts`) — older manifests in users' Storage buckets must still deserialize.
- `vercel.json`'s `maxDuration: 300` — required because the full pipeline approaches 3 minutes.
