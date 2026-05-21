/**
 * Mirror of the MarketingManifest shape from the main app. Kept as a
 * separate copy here (rather than imported from `../../src/...`) so the
 * render service stays a self-contained deploy.
 */

export type VideoFormat = '16:9' | '9:16' | '1:1'

export interface MarketingScene {
  voiceover: string
  headline: string
  subhead?: string
  screenshotIndex: number | null
  durationSeconds: number
  /** Esbuild output of the architect/designer's TSX. Evaluated at
   *  render time inside DynamicScene. */
  mockCompiledCode?: string
  visualMode?: string
  /** Cadrage override the architect picked: browser / mobile /
   *  terminal / fullbleed / split. The split / fullbleed values
   *  interact with `headlinePanel` to suppress the side panel. */
  framing?: string
  /** When false, the composition skips the headline panel and the
   *  mock occupies the full canvas. Default true. */
  headlinePanel?: boolean
}

export interface MarketingScript {
  hook: { voiceover: string; headline: string; durationSeconds: number }
  scenes: MarketingScene[]
  cta: { voiceover: string; headline: string; buttonLabel: string; durationSeconds: number }
  totalDurationSeconds?: number
  language?: string
}

export interface MarketingScreenshot {
  url: string
  caption: string
}

export interface MarketingBranding {
  productName: string
  accentColor: string
  bgColor: string
  textColor: string
  fontFamily: string
  logoUrl: string | null
  accentSecondary?: string
  websiteUrl?: string | null
  radius?: number
}

export interface MarketingManifest {
  videoId: string
  generatedAt: string
  script: MarketingScript
  screenshots: MarketingScreenshot[]
  branding: MarketingBranding
  voiceoverUrl: string | null
  voiceoverPath: string | null
  voiceoverDurationSeconds?: number
  musicUrl?: string | null
  musicPath?: string | null
  musicVolume?: number
  musicError?: string | null
  thumbnailUrl?: string | null
  thumbnailPath?: string | null
  format?: VideoFormat
}
