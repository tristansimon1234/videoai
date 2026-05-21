import { z } from 'zod'

/**
 * Env vars validated at startup. Anything required in production fails fast
 * here rather than silently 500ing the first time it's accessed.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(3000),

  // Supabase — Postgres + Auth + Storage. Service key is server-side only;
  // never expose to the browser. The frontend uses VITE_SUPABASE_ANON_KEY.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // AI providers. Marketing script generation uses Anthropic Sonnet 4.6
  // (designer + repair) + Haiku 4.5 (architect skeleton + AI manifest edit).
  ANTHROPIC_API_KEY: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().optional(),

  // Remotion render service. Optional in dev so the rest of the stack
  // boots without it; the generate route 503s when unset.
  VIDEO_SERVICE_URL: z.string().url().optional(),

  // Stripe — credit-pack purchases. Both required in production (verified
  // below). The webhook secret is what Stripe signs each event with so we
  // can verify the request actually came from Stripe and not a forged caller.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Public app URL — used to build Stripe Checkout success/cancel URLs and
  // any future outbound email link. Required in production so we never
  // hand Stripe a localhost callback.
  PUBLIC_APP_URL: z.string().url().optional(),

  // Sentry — optional. No-op when unset.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_RELEASE: z.string().optional(),

  // Upstash Redis — distributed rate limiting. In-memory fallback is fine
  // for local dev but bypassable on Vercel (cold starts reset counters), so
  // production requires both. Checked below.
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

// Accept the common Vercel/Supabase naming variants so the server boots
// without duplicating env vars:
//  - URL: Vite-prefixed fallback (the same URL is needed by the client).
//  - Service key: Supabase Dashboard exports it as SUPABASE_SERVICE_ROLE_KEY.
// The service key must never be VITE_-prefixed — that would bundle it
// into the client — so no VITE_ fallback for it.
const rawEnv = {
  ...process.env,
  SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_KEY:
    process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
}

export const env: Env = EnvSchema.parse(rawEnv)

// Warn (don't crash) in production when optional integrations are unset.
// The app still boots; routes that depend on these will 503 / fall back
// individually. Re-tighten these to `throw` once billing + rate limiting
// are live.
if (env.NODE_ENV === 'production') {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    console.warn('[env] STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET unset — credit-pack purchases disabled.')
  }
  if (!env.PUBLIC_APP_URL) {
    console.warn('[env] PUBLIC_APP_URL unset — Stripe Checkout callbacks will not work.')
  }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn('[env] UPSTASH_REDIS_* unset — falling back to in-memory rate limiting (bypassable on serverless).')
  }
  if (!env.VIDEO_SERVICE_URL) {
    console.warn('[env] VIDEO_SERVICE_URL unset — video generation will 503.')
  }
}
