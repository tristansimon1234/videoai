# SaaS Video

AI-generated product videos for SaaS. Write a one-paragraph brief, get back a 45-second branded promo with animated UI mocks, voice-over, and background music — rendered to MP4.

The architect agent (Claude Haiku) turns the brief into a script + per-scene visual direction. Designer agents (Claude Sonnet) compose the per-scene TSX animations in parallel. ElevenLabs handles voice-over and background music. Remotion renders the final video. ~2-3 minutes end-to-end.

## What you give it

```
Brief (≤ 6000 chars)   →   "Acme is a Slack bot that pages
Brand (logo + colors)       on-call engineers when prod metrics
Voice tone + music style    drift. Target: SRE leads at series B+
                            companies. Emphasise the fast-rollback
                            workflow and the no-PagerDuty setup."
```

## What you get back

A 1920×1080 MP4 with:
- a punchy hook (4-6s)
- 3 scenes (~9s each), each one a custom animated UI mock illustrating one benefit
- a CTA scene with your brand button + URL
- voice-over matched to a tone preset (`confident`, `playful`, `inspirational`, …)
- background music generated to fit the script's duration

## Stack

- Node 20 / TypeScript 5.9 strict
- Vite 8 + React 19 + React Router 7 (SPA frontend)
- Express 5 deployed as a single Vercel serverless function (`api/index.ts`, `maxDuration: 300`)
- Supabase Postgres + Auth + Storage + RLS
- Anthropic Sonnet 4.6 (designer + edit) + Haiku 4.5 (architect)
- ElevenLabs v3 (voice-over) + ElevenLabs Music
- Remotion render service (separate deploy, called via `VIDEO_SERVICE_URL`)
- Stripe Checkout (credit packs)

## Data model

Three Supabase tables, all RLS-isolated per `auth.users.id`:

- `brands` — per-user brand identities (logo, colors, font, website). One user can have many; one is the default.
- `marketing_videos` — one row per generated video. `manifest jsonb` holds the rendered script + branding snapshot. Lifecycle: `pending → generating → rendering → ready / failed`. A partial unique index caps concurrency to one in-flight render per user.
- `user_credits` — balance + total bought. Decremented on successful render. Topped up by the Stripe webhook. New users get 1 free credit via the `on_auth_user_created` trigger.

## API surface

```
GET    /api/profile                       current user
POST   /api/brands                        create
GET    /api/brands                        list
PATCH  /api/brands/:id                    update
DELETE /api/brands/:id                    delete

POST   /api/marketing-videos              create + generate (1 credit)
GET    /api/marketing-videos              list
GET    /api/marketing-videos/:id          detail (includes manifest)
DELETE /api/marketing-videos/:id          delete
POST   /api/marketing-videos/:id/edit     AI refine (free)
POST   /api/marketing-videos/:id/render   re-render existing manifest
POST   /api/marketing-videos/:id/voiceover  swap voice/tone, no re-script
PUT    /api/marketing-videos/:id/manifest   user-edited manifest
POST   /api/marketing-videos/:id/thumbnail  client-captured JPEG poster

GET    /api/marketing-videos/_config/voices         ElevenLabs voices
GET    /api/marketing-videos/_config/music-presets  AI music styles

GET    /api/credits                       balance + pack catalog
POST   /api/credits/checkout              start Stripe Checkout
POST   /api/stripe/webhook                Stripe → credit top-up
```

All authed routes take a Supabase JWT (`Authorization: Bearer <token>`). The webhook is public and signature-verified.

## Local development

```sh
git clone <repo> && cd videoai
npm install --legacy-peer-deps
cp .env.example .env       # fill in keys — see "Env vars" below
npm run dev:server         # Express on :3000
npm run dev:client         # Vite on :5173, proxies /api → :3000
```

At minimum you need:
- A Supabase project with the two migrations in `supabase/migrations/` applied.
- An Anthropic API key with Sonnet 4.6 + Haiku 4.5 access.
- An ElevenLabs API key (optional — if unset, videos generate without voice/music).

Stripe + `VIDEO_SERVICE_URL` are optional in dev — the credit checkout and the render step both 503 cleanly when their env is missing, so the rest of the stack still boots and you can iterate on the architect/designer pipeline locally.

## Env vars

```sh
NODE_ENV=development
PORT=3000

SUPABASE_URL=
SUPABASE_SERVICE_KEY=          # service-role; never expose to the browser

ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=            # optional in dev; required for voice + music

VIDEO_SERVICE_URL=             # Remotion render service; required in prod

STRIPE_SECRET_KEY=             # required in prod
STRIPE_WEBHOOK_SECRET=         # required in prod
STRIPE_PRICE_STARTER=          # Stripe Price IDs from the dashboard
STRIPE_PRICE_PRO=
STRIPE_PRICE_AGENCY=

PUBLIC_APP_URL=                # required in prod — used in Stripe Checkout callbacks

SENTRY_DSN=                    # optional
UPSTASH_REDIS_REST_URL=        # required in prod (rate limiting)
UPSTASH_REDIS_REST_TOKEN=
```

Frontend (Vite-prefixed):
```sh
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_STRIPE_PUBLISHABLE_KEY=
```

## Deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full Supabase + Stripe + Vercel walkthrough.

## License

Proprietary — all rights reserved.
