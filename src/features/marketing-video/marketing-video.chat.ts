/**
 * Agentic chat for the brief-collection / pre-generation conversation.
 *
 * Design — the LLM gets a set of tools (think: an MCP server) and decides
 * for itself when to call them. No scripting from us, no "ask in this
 * order". Tools expose UI affordances (an editable plan card, suggestion
 * cards for voice/style, a commit button). The LLM is free to text the
 * user, ask follow-ups, call multiple tools in one turn, or none at all.
 *
 * Wire format — stateless. The client keeps the full transcript and posts
 * it every turn. Each message has a `role` and a `content` array of
 * blocks (text / tool_use / tool_result) that mirror Anthropic's content
 * block shapes. We pass them through to the SDK with minimal massaging.
 *
 * Tools exposed:
 *   - propose_plan: render an editable plan card. User can tweak fields
 *     and click Generate, or send back a tool_result asking for changes.
 *   - suggest_voice: render a clickable mini-card for a specific voice.
 *   - suggest_style: render a clickable mini-card for a style seed.
 *   - commit_and_generate: launch the pipeline. The frontend transitions
 *     to the generating view and calls POST /api/marketing-videos.
 */
import { anthropic, HAIKU_MODEL } from '../../shared/ai/anthropic.client.js'
import type Anthropic from '@anthropic-ai/sdk'

// ============================================================
// Wire types — what the route accepts / returns. Mirror the
// Anthropic SDK shapes so we can pass through with minimal work.
// ============================================================

export type ChatTextBlock = { type: 'text'; text: string }
export type ChatToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }
export type ChatToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  /** Plain-text payload describing what happened (e.g. "user clicked
   *  Generate with these fields: …"). The LLM reads this verbatim. */
  content: string
}

export type ChatContentBlock = ChatTextBlock | ChatToolUseBlock | ChatToolResultBlock

export interface ChatMessage {
  role: 'user' | 'assistant'
  /** Either a plain string (legacy / first user turn) or an array of
   *  blocks. The route normalizes strings to a single text block. */
  content: string | ChatContentBlock[]
}

export interface ChatTurn {
  /** Assistant message split into renderable blocks. Text blocks become
   *  chat bubbles; tool_use blocks become interactive cards. */
  blocks: Array<ChatTextBlock | ChatToolUseBlock>
  /** Anthropic stop_reason for the turn. */
  stopReason: string
}

// ============================================================
// Tool catalog — these are the only ways the LLM can drive the UI.
// Names + descriptions are read by the LLM to decide when to call.
// ============================================================

const VIDEO_FORMATS = ['16:9', '9:16', '1:1'] as const
const VOICE_TONES = [
  'confident', 'punchy', 'playful', 'calm', 'serious', 'inspirational', 'conversational',
] as const
const MUSIC_TRACK_IDS = [
  'ai-cinematic', 'ai-upbeat', 'ai-inspirational', 'ai-lofi', 'ai-tech', 'ai-ambient', 'none',
] as const
export const STYLE_SEED_LABELS = [
  'editorial', 'product-tour', 'metric-driven', 'process-flow',
  'brand-first', 'conversational', 'high-contrast', 'data-density',
] as const

const PLAN_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    brief: {
      type: 'string',
      description: '2-3 sentence factual description of the product (what it is, who for, one strong angle). Becomes the architect input.',
    },
    title: { type: 'string', description: 'Short 2-5 word title for the gallery row.' },
    format: { type: 'string', enum: [...VIDEO_FORMATS] },
    tone: { type: 'string', enum: [...VOICE_TONES] },
    musicTrackId: { type: 'string', enum: [...MUSIC_TRACK_IDS] },
    aiMusicPrompt: {
      type: 'string',
      description: 'Optional free-text music brief, only meaningful when musicTrackId is "ai-*".',
    },
    styleSeed: {
      type: 'string',
      description: 'Optional visual style label. One of: ' + STYLE_SEED_LABELS.join(', ') + '. Drives the designer\'s visual vocabulary.',
    },
    userPrompt: {
      type: 'string',
      description: 'Optional extra steering for the architect (audience, emphasis, tone shift) that doesn\'t belong in the factual brief.',
    },
  },
  required: ['brief', 'format', 'tone', 'musicTrackId'],
} as const

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'propose_plan',
    description:
      'Render an editable plan card in the chat with every field needed to launch generation. The user can tweak any field inline and click Generate, or reply asking for changes. Call this when you have enough info for a coherent first draft — do not wait for every detail to be perfect, the user can edit the card.',
    input_schema: PLAN_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  },
  {
    name: 'suggest_voice',
    description:
      'Suggest a specific voice id with a short reason. Renders a clickable mini-card. Use when you have a strong opinion ("for this product I\'d use a calm female voice"). The user clicks to accept; you can also just include the voiceId directly in propose_plan instead.',
    input_schema: {
      type: 'object',
      properties: {
        voiceId: { type: 'string', description: 'ElevenLabs voice id.' },
        voiceName: { type: 'string', description: 'Human-readable voice name to show in the card.' },
        reason: { type: 'string', description: 'One-sentence rationale shown on the card.' },
      },
      required: ['voiceId'],
    } as unknown as Anthropic.Tool.InputSchema,
  },
  {
    name: 'suggest_style',
    description:
      'Suggest a visual style seed with a reason. Renders a clickable mini-card. Valid styleSeed values: ' + STYLE_SEED_LABELS.join(', ') + '. Click accepts the suggestion; you can also bake the seed into propose_plan directly.',
    input_schema: {
      type: 'object',
      properties: {
        styleSeed: { type: 'string', enum: [...STYLE_SEED_LABELS] },
        reason: { type: 'string' },
      },
      required: ['styleSeed'],
    } as unknown as Anthropic.Tool.InputSchema,
  },
  {
    name: 'commit_and_generate',
    description:
      'Lock in the plan and launch the generation pipeline. The frontend immediately spends 1 credit, calls POST /api/marketing-videos, and switches to the generating view. Call this ONLY after the user has explicitly confirmed (clicked Generate on a plan card, said "go", "do it", etc.). If the user is still iterating, call propose_plan instead.',
    input_schema: PLAN_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  },
]

// ============================================================
// System prompt — deliberately short. The contract is the tools,
// not the prose. We don't script the conversation.
// ============================================================

const SYSTEM_PROMPT = `You help a user create a 45-second marketing video for their product. You have these tools:

- propose_plan: render an editable plan card (brief, format, tone, music, style). Use when you have a coherent draft — the user edits inline.
- suggest_voice / suggest_style: render a small clickable suggestion card. Optional — use when you have a strong opinion.
- commit_and_generate: launch the pipeline. Call ONLY after the user has explicitly confirmed.

Be brief and natural. Match the user's language. Don't ask for every detail before proposing a plan — propose early, the user will edit. You decide the rhythm.`

// ============================================================
// Driver — one turn of the conversation.
// ============================================================

/**
 * Normalize the incoming transcript into Anthropic's expected shape.
 * Strings become single text blocks; explicit block arrays pass through
 * (with light coercion for fields the client may have renamed).
 */
function normalizeMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content }
    }
    const content = m.content.map((b): Anthropic.ContentBlockParam => {
      if (b.type === 'text') return { type: 'text', text: b.text }
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input as object }
      if (b.type === 'tool_result') return { type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content }
      throw new Error(`Unknown chat block type: ${(b as { type: string }).type}`)
    })
    return { role: m.role, content }
  })
}

/**
 * Run one assistant turn against the chat tools. Returns the assistant's
 * blocks (text + tool_use). On transient Anthropic errors (529 / 503 /
 * 429) returns a soft fallback so the UI doesn't surface the raw error.
 */
export async function runAgenticChat(messages: ChatMessage[]): Promise<ChatTurn> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const apiMessages = normalizeMessages(messages)
  // Seed an empty conversation with a user prompt so Anthropic accepts
  // the call (the API requires at least one user message).
  if (apiMessages.length === 0) {
    apiMessages.push({ role: 'user', content: '[Start of conversation]' })
  }

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1200,
      temperature: 0.5,
      system: [{
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      }],
      tools: TOOLS,
      messages: apiMessages,
    })

    const blocks: ChatTurn['blocks'] = []
    for (const b of response.content) {
      if (b.type === 'text') {
        if (b.text.trim().length > 0) blocks.push({ type: 'text', text: b.text })
      } else if (b.type === 'tool_use') {
        blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
      }
      // Other block types (thinking, server_tool_use, …) aren't expected
      // here — silently drop.
    }

    return { blocks, stopReason: response.stop_reason ?? 'end_turn' }
  } catch (err) {
    const status = (err as { status?: number })?.status
    if (status === 529 || status === 503 || status === 429) {
      console.warn(`[chat] Anthropic transient ${status}; returning soft fallback`)
      return {
        blocks: [{ type: 'text', text: "I'm a bit overloaded right now — try again in a few seconds." }],
        stopReason: 'transient_error',
      }
    }
    throw err
  }
}
