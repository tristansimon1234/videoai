# Deploy

End-to-end checklist for getting a fresh deploy of SaaS Video running on Vercel + Supabase + Stripe. Allow ~45 minutes for the first pass.

## 0. Prerequisites

- A GitHub repo with this code (push your fork before continuing — Vercel deploys from GitHub).
- A Supabase account.
- A Stripe account in test mode for the first deploy.
- An Anthropic API key with Sonnet 4.6 + Haiku 4.5 access.
- An ElevenLabs API key on a plan that includes both TTS and the Music API.
- An Upstash account (Redis REST — free tier is fine).
- A deployed Remotion render service exposed at a public URL. The protocol is documented in `src/shared/video/video.client.ts` — `POST /render-marketing-video`. Stand up your own or point at one you control.

## 1. Supabase

1. Create a new project at https://supabase.com (any region, Postgres 15+). Note the project ref.

2. Apply the two SQL migrations in order:

   - `supabase/migrations/20260101000000_initial_schema.sql` — creates `brands`, `marketing_videos`, `user_credits` + RLS policies + the `on_auth_user_created_bootstrap_credits` trigger that seeds 1 free credit per signup.
   - `supabase/migrations/20260101000001_credit_rpcs.sql` — `spend_credit` + `refund_credit` SECURITY DEFINER RPCs.

   Easiest path: open the **SQL editor** in the Supabase dashboard, paste each file in turn, run. CLI alternative if you prefer:
   ```sh
   supabase link --project-ref <ref>
   supabase db push
   ```

3. **Verify the bootstrap trigger fired.** Sign up a test user (anywhere — the dashboard's Auth → Users → Add user works), then in the SQL editor:
   ```sql
   select * from user_credits where user_id = '<the test user id>';
   ```
   You MUST see exactly one row with `balance = 1`. If you don't, the trigger didn't install — re-run the initial migration and check for a silent error in the SQL editor's history.

4. **Create the `artifacts` Storage bucket.** Storage → New bucket → name `artifacts`, **Public** (the renderer fetches manifests + voice-over MP3s by URL). No file size cap needed; the manifest JSON + MP3s are well under default limits.

5. **Grab the API credentials.** Settings → API:
   - `SUPABASE_URL` → "Project URL"
   - `SUPABASE_SERVICE_KEY` → "service_role" key (NEVER expose this in the browser)
   - `VITE_SUPABASE_URL` → same as `SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` → "anon public" key

## 2. Stripe

1. Create three products in the Stripe dashboard (test mode), each with a one-time price:
   | Product | Credits | Suggested price |
   |---|---|---|
   | Starter pack | 5   | $19  |
   | Pro pack     | 20  | $59  |
   | Agency pack  | 100 | $199 |

   Adjust the prices to whatever you want — what matters is that the IDs match what's in `src/features/credits/credits.routes.ts::CREDIT_PACKS`. Save each Price ID (`price_…`) — they go in env vars next.

2. **Create the webhook endpoint.** Developers → Webhooks → Add endpoint:
   - URL: `https://<your-vercel-domain>/api/stripe/webhook`
   - Events: `checkout.session.completed` (just that one)
   - Click reveal on the signing secret and copy it — that's `STRIPE_WEBHOOK_SECRET`.

3. Grab `STRIPE_SECRET_KEY` from Developers → API keys (test mode) and `VITE_STRIPE_PUBLISHABLE_KEY` from the same page.

## 3. Upstash Redis

1. Create a Redis database (any region close to your Vercel deploy).
2. Copy the REST URL and REST token from the dashboard → `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.

The in-memory rate-limit fallback works in dev but is bypassable on Vercel (cold starts reset counters), so production boot will throw if these aren't set. Free tier is plenty for thousands of requests/day.

## 4. Vercel

1. Create a new project from your GitHub repo. Framework preset: **Other** (Vercel picks Vite for the static build automatically; the `vercel.json` at the repo root handles the rest).

2. Settings → Environment Variables — set ALL of these for the Production environment:

   ```
   NODE_ENV=production
   SUPABASE_URL=<from step 1>
   SUPABASE_SERVICE_KEY=<from step 1>
   ANTHROPIC_API_KEY=<your key>
   ELEVENLABS_API_KEY=<your key>
   VIDEO_SERVICE_URL=<your Remotion render service URL>

   STRIPE_SECRET_KEY=<from step 2>
   STRIPE_WEBHOOK_SECRET=<from step 2>
   STRIPE_PRICE_STARTER=price_…
   STRIPE_PRICE_PRO=price_…
   STRIPE_PRICE_AGENCY=price_…

   PUBLIC_APP_URL=https://<your-domain>

   UPSTASH_REDIS_REST_URL=<from step 3>
   UPSTASH_REDIS_REST_TOKEN=<from step 3>

   SENTRY_DSN=<optional>
   ```

   And the Vite-prefixed ones (these end up in the browser bundle):
   ```
   VITE_SUPABASE_URL=<from step 1>
   VITE_SUPABASE_ANON_KEY=<from step 1>
   VITE_STRIPE_PUBLISHABLE_KEY=<from step 2>
   ```

   The env validator in `src/shared/config/env.ts` will throw at boot if anything in the required list above is missing or malformed. That's intentional — better to fail at deploy than to 500 on the first user request.

3. Deploy. The Vite build outputs to `dist/client/`, the Express app deploys as a single serverless function from `api/index.ts` with `maxDuration: 300` (5 minutes — the full pipeline including Remotion render fits comfortably inside this).

## 5. Smoke test

Hit the live deploy and walk through one end-to-end render. Order matters — each step exercises one piece of infra and surfaces failures at a sensible boundary.

1. **Sign up** → visit `/signup`, create an account.
   - ✅ Pass: you're redirected to `/onboarding`.
   - ❌ Fail: 500 on signup usually means the `on_auth_user_created` trigger isn't installed (the FK from `user_credits.user_id` to `auth.users.id` rejects the insert mid-transaction). Re-run migration 1.

2. **Create a brand** → fill in name + colors on the onboarding screen.
   - ✅ Pass: redirected to `/dashboard`.

3. **Buy credits** → `/billing` → click any pack → Stripe Checkout test card `4242 4242 4242 4242`, any future expiry, any CVC.
   - ✅ Pass: after payment, you're sent back to `/dashboard?checkout=success`. Within ~5 seconds the credit balance in the header bumps up.
   - ❌ Fail: balance doesn't bump → the webhook didn't fire. Stripe Dashboard → Developers → Webhooks → your endpoint → check the recent deliveries tab. Common causes: wrong `STRIPE_WEBHOOK_SECRET`, webhook pointed at the wrong URL.

4. **Generate a video** → `/dashboard` → "New video" → paste a brief (≥ 20 chars), pick tone + music, submit.
   - ✅ Pass: the modal stays open with the stepper showing "Generating…", then closes after ~2-3 min when the MP4 is ready. The new video appears on the dashboard with its thumbnail.
   - ❌ Fail with `INSUFFICIENT_CREDITS` → step 3 didn't actually credit you; check the webhook.
   - ❌ Fail with anything Remotion / video-service related → `VIDEO_SERVICE_URL` is wrong, or the render service is down. The `[video-service]` log lines in Vercel will tell you which.
   - ❌ Fail with `ELEVENLABS_*` → the ElevenLabs plan doesn't include the Music API, or the key is expired.

5. **Open the video** → click the new tile.
   - ✅ Pass: the MP4 plays in the browser.

## Common gotchas

- **Stripe Price IDs unset.** `POST /api/credits/checkout` 503s with `PRICE_NOT_CONFIGURED` when `STRIPE_PRICE_<PACK>` env vars are empty. The checkout button on `/billing` surfaces this as a clean error.
- **`VIDEO_SERVICE_URL` unset in prod.** The env validator throws at boot — Vercel will show "Function crashed" and never serve. Fix: set the env var and redeploy.
- **Vercel Authentication on a preview deploy.** If you enable "Vercel Authentication" under Deployment Protection, the Remotion bundle URL is gated and the render service can't fetch it. The pre-flight in `marketing-video.service.ts::preflightRemotionBundle` will surface this with a clear message — disable the protection for the preview or test on production.
- **First-render Remotion bundle URL.** The Remotion site needs to ship with your deploy. The current setup expects `<PUBLIC_APP_URL>/remotion-bundle/index.html` to resolve. If you've set up a separate Remotion deploy, point `REMOTION_SERVE_URL` env var at it explicitly.
- **Free Supabase project hibernation.** A paused project returns 503s on every Supabase call; the dashboard banner says "Project paused". Resume it before debugging anything else.
