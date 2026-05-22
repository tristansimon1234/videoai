import { supabase } from './supabase.js'

const API_BASE = '/api'

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string | null,
    public status: number,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })

  if (res.status === 204) return undefined as T

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await res.json() : await res.text()

  if (!res.ok) {
    const err = isJson ? body : { error: body, code: null }
    throw new ApiError(err.error ?? `Request failed: ${res.status}`, err.code ?? null, res.status, err.details)
  }
  return body as T
}

// ============================================================
// DTOs — keep loose; the backend is the source of truth.
// ============================================================

export interface BrandDTO {
  id: string
  userId: string
  name: string
  logoUrl: string | null
  logoPath: string | null
  accentColor: string
  bgColor: string
  textColor: string
  fontFamily: string
  websiteUrl: string | null
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface MarketingVideoListItemDTO {
  id: string
  title: string
  brief: string
  brandId: string
  videoUrl: string | null
  thumbnailUrl: string | null
  renderStatus: 'pending' | 'idle' | 'generating' | 'rendering' | 'ready' | 'failed'
  renderError: string | null
  createdAt: string
  durationSeconds: number | null
}

export type VoiceTone =
  | 'punchy' | 'calm' | 'playful' | 'serious'
  | 'confident' | 'inspirational' | 'conversational'

export type VideoFormat = '16:9' | '9:16' | '1:1'

// Chat content blocks — mirror the Anthropic SDK shapes. Text blocks
// render as bubbles; tool_use blocks render as interactive UI cards
// (PlanCard, suggestion cards); tool_result blocks carry the user's
// reply to a tool call back into the next assistant turn.
export type ChatTextBlockDTO = { type: 'text'; text: string }
export type ChatToolUseBlockDTO = { type: 'tool_use'; id: string; name: string; input: unknown }
export type ChatToolResultBlockDTO = { type: 'tool_result'; tool_use_id: string; content: string }
export type ChatContentBlockDTO = ChatTextBlockDTO | ChatToolUseBlockDTO | ChatToolResultBlockDTO

export interface ChatMessageDTO {
  role: 'user' | 'assistant'
  content: string | ChatContentBlockDTO[]
}

export interface ChatTurnDTO {
  /** Assistant blocks for this turn — text and/or tool_use. */
  blocks: Array<ChatTextBlockDTO | ChatToolUseBlockDTO>
  stopReason: string
}

/** Input shape the LLM puts into propose_plan / commit_and_generate. */
export interface ChatPlanInput {
  brief: string
  title?: string
  format: VideoFormat
  tone: VoiceTone
  musicTrackId: string
  aiMusicPrompt?: string
  styleSeed?: string
  userPrompt?: string
}

export interface CreditsDTO {
  balance: number
  totalBought: number
  packs: { id: string; name: string; credits: number; priceCents: number }[]
}

export const api = {
  profile: {
    me: (): Promise<{ id: string; email: string; createdAt: string }> => request('/profile'),
  },
  brands: {
    list: (): Promise<{ items: BrandDTO[] }> => request('/brands'),
    create: (body: Partial<Omit<BrandDTO, 'id' | 'userId' | 'createdAt' | 'updatedAt'>> & { name: string }): Promise<BrandDTO> =>
      request('/brands', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Partial<BrandDTO>): Promise<BrandDTO> =>
      request(`/brands/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: string): Promise<void> =>
      request(`/brands/${id}`, { method: 'DELETE' }),
  },
  marketingVideos: {
    list: (): Promise<{ items: MarketingVideoListItemDTO[] }> => request('/marketing-videos'),
    get: (id: string): Promise<MarketingVideoListItemDTO & { manifest: unknown }> =>
      request(`/marketing-videos/${id}`),
    create: (body: {
      brief: string
      title?: string
      brandId?: string
      options?: {
        tone?: VoiceTone
        voiceId?: string
        musicTrackId?: string
        musicVolume?: number
        aiMusicPrompt?: string
        userPrompt?: string
        format?: VideoFormat
        styleSeed?: string
      }
    }): Promise<MarketingVideoListItemDTO> =>
      request('/marketing-videos', { method: 'POST', body: JSON.stringify(body) }),
    chat: (messages: ChatMessageDTO[]): Promise<ChatTurnDTO> =>
      request('/marketing-videos/chat', { method: 'POST', body: JSON.stringify({ messages }) }),
    delete: (id: string): Promise<void> =>
      request(`/marketing-videos/${id}`, { method: 'DELETE' }),
    voices: (): Promise<{ voices: Array<{ voiceId: string; name: string; category: string }> }> =>
      request('/marketing-videos/_config/voices'),
    musicPresets: (): Promise<{ presets: Array<{ id: string; name: string; mood?: string }> }> =>
      request('/marketing-videos/_config/music-presets'),
    updateManifest: (id: string, body: {
      script: unknown
      branding?: Partial<{
        productName: string
        accentColor: string
        accentSecondary: string
        bgColor: string
        textColor: string
        fontFamily: string
        logoUrl: string | null
        websiteUrl: string | null
        radius: number
      }>
      musicVolume?: number
    }): Promise<MarketingVideoListItemDTO & { manifest: unknown }> =>
      request(`/marketing-videos/${id}/manifest`, { method: 'PUT', body: JSON.stringify(body) }),
    updateVoiceover: (id: string, body: { voiceId?: string; tone?: VoiceTone }): Promise<MarketingVideoListItemDTO & { manifest: unknown }> =>
      request(`/marketing-videos/${id}/voiceover`, { method: 'POST', body: JSON.stringify(body) }),
    render: (id: string): Promise<MarketingVideoListItemDTO & { manifest: unknown }> =>
      request(`/marketing-videos/${id}/render`, { method: 'POST', body: JSON.stringify({}) }),
  },
  credits: {
    get: (): Promise<CreditsDTO> => request('/credits'),
    checkout: (packId: 'starter' | 'pro' | 'agency'): Promise<{ url: string }> =>
      request('/credits/checkout', { method: 'POST', body: JSON.stringify({ packId }) }),
  },
}
