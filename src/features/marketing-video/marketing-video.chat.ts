/**
 * Conversational brief-collection. Drives the chat-first generate flow:
 * the user describes their product in their own words and Haiku asks
 * targeted follow-ups (audience, value prop, tone, format, …) until it
 * has enough to call the existing pipeline. Returns either the next
 * assistant turn (text + optional quick-reply chips) or, when ready,
 * the structured brief the create route accepts.
 *
 * One round-trip per user message — the UI keeps the full transcript on
 * the client and re-posts it; this keeps the endpoint stateless and
 * cheap to host on Vercel serverless.
 */
import { generateSonnetText, HAIKU_MODEL } from '../../shared/ai/anthropic.client.js'
import type { VideoFormat } from './marketing-video.schema.js'
import type { VoiceTone } from './marketing-video.types.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface QuickReply {
  /** Short label displayed on the chip (max ~30 chars for layout). */
  label: string
  /** Free-text value sent back as the user's reply when the chip is
   *  clicked. Usually identical to label, but kept separate so the UI
   *  can show "Yes" while sending "Yes, generate the video". */
  value: string
}

/** Structured brief — what the create route expects after the chat is
 *  done. Fields mirror what the existing pipeline already accepts so we
 *  can drop straight into `POST /api/marketing-videos`. */
export interface ExtractedBrief {
  /** 1-3 sentence product description that becomes the architect's input. */
  brief: string
  /** Short title for the row in the gallery — derived from the product
   *  name. Optional; the create route falls back to a date string. */
  title?: string
  /** Aspect ratio the user picked. */
  format: VideoFormat
  /** Voice-over tone preset. Defaults to 'confident'. */
  tone: VoiceTone
  /** Music style — one of the AI_MUSIC_STYLES ids or 'none'. */
  musicTrackId: string
  /** Extra steering forwarded to the architect — audience + angle the
   *  chat captured but that doesn't fit the brief proper. */
  userPrompt?: string
}

export interface ChatTurn {
  /** Markdown the UI renders as the assistant bubble. */
  message: string
  /** Optional chips below the bubble. The UI sends `value` back as a
   *  user message when one is clicked. */
  quickReplies?: QuickReply[]
  /** True when the assistant has enough info to generate. The UI
   *  switches to a confirm-and-go state and `brief` is non-null. */
  ready: boolean
  /** Populated when ready=true. */
  brief?: ExtractedBrief
}

const SYSTEM_PROMPT = `You are a friendly creative director helping a founder turn a one-sentence pitch into a 45-second marketing video. Your job is to collect ONLY what the generator needs and then hand off — do not over-interview.

# How you talk
- Warm, concise, one idea per message. Never more than 2 questions per turn.
- Match the user's language (if they write French, reply French; same for any other language).
- No filler ("Great question!", "Awesome!", "Got it, so…"). Get to the point.
- Never invent details about the product. If the user is vague, ask.

# What you must collect, in priority order
1. **What the product is** — name + one-line description (what it does, for who). This is the hardest blocker; if missing, ask first.
2. **Aspect ratio** — 16:9 (YouTube, web), 9:16 (TikTok, Reels, Shorts), or 1:1 (Instagram, LinkedIn feed). ALWAYS offer all three as quick replies the first time you ask.
3. **Audience + the one thing to emphasize** — who it's for and what to put forward (speed? quality? price? a specific feature?). One question, free text.
4. **Tone of voice-over** — offer "confident", "punchy", "playful", "calm", "inspirational" as quick replies. Default to confident if user is unsure.
5. **Music style** — offer "Cinematic", "Upbeat", "Inspirational", "Lo-fi", "Tech", "Ambient", "No music" as quick replies.

# Quick replies (chips)
- ALWAYS attach quick replies when the next question has a clear small set of options (format, tone, music). They speed the user up massively.
- For free-text questions (what the product is, audience), do NOT add quick replies — let them type.
- Each chip: short label (≤ 25 chars) + the literal value to send as the user message.

# When to finish
- The moment you have items 1-5, finish. Do NOT ask for "anything else?" — that's friction.
- On the finishing turn, set ready=true and fill the brief object. The "message" on that turn is a single-sentence recap (e.g. "Got it — generating a 9:16 punchy video for [product] highlighting [angle]. Hold on ~3 minutes."). Do NOT ask for confirmation; the UI handles that.

# Brief field rules (when ready=true)
- "brief": 2-3 sentences. First sentence is what the product is. Second adds audience + the one thing to emphasize. Third is optional, only if the user gave a concrete proof-point.
- "title": short, 2-5 words, derived from the product name.
- "format": "16:9" | "9:16" | "1:1" — exact strings.
- "tone": "confident" | "punchy" | "playful" | "calm" | "serious" | "inspirational" | "conversational".
- "musicTrackId": "ai-cinematic" | "ai-upbeat" | "ai-inspirational" | "ai-lofi" | "ai-tech" | "ai-ambient" | "none".
- "userPrompt": optional. Use it to forward audience + emphasis as steering for the architect.

# Edge cases
- If the user types something completely off-topic (asking about pricing, refunds, etc.), redirect in one line back to the brief.
- If the user wants to skip a step ("just do it", "you decide"), pick a sensible default and move on instead of pushing back.
- If the conversation has gone past ~8 turns without finishing, finish with whatever you have — defaults beat dragging it out.

# Output
You MUST call the \`submit_turn\` tool with your full response. Never write prose outside the tool call.`

const TURN_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description: 'The assistant message to display in the chat bubble. One short paragraph, no markdown headers.',
    },
    quickReplies: {
      type: 'array',
      description: 'Optional chips below the bubble. Up to 7. Omit for free-text questions.',
      maxItems: 7,
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Chip label shown to the user (≤ 25 chars).' },
          value: { type: 'string', description: 'What to send back as the user reply when clicked.' },
        },
        required: ['label', 'value'],
      },
    },
    ready: {
      type: 'boolean',
      description: 'True only when you have all 5 required fields and are handing off to the generator.',
    },
    brief: {
      type: 'object',
      description: 'Populated ONLY when ready=true.',
      properties: {
        brief: { type: 'string' },
        title: { type: 'string' },
        format: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
        tone: {
          type: 'string',
          enum: ['confident', 'punchy', 'playful', 'calm', 'serious', 'inspirational', 'conversational'],
        },
        musicTrackId: {
          type: 'string',
          enum: ['ai-cinematic', 'ai-upbeat', 'ai-inspirational', 'ai-lofi', 'ai-tech', 'ai-ambient', 'none'],
        },
        userPrompt: { type: 'string' },
      },
      required: ['brief', 'format', 'tone', 'musicTrackId'],
    },
  },
  required: ['message', 'ready'],
} as const

/**
 * One turn of the brief-collection chat. Pass the entire transcript so
 * far (user + assistant messages); the function returns the next
 * assistant turn. When the transcript is empty, returns the opening
 * question.
 */
export async function runBriefChat(messages: ChatMessage[]): Promise<ChatTurn> {
  // Render the transcript as a single user prompt so the model gets the
  // full picture in one go. (We could use real multi-turn messages here,
  // but a flat transcript keeps the helper signature simple and the
  // prompt cache stable on the system block.)
  const transcript = messages.length === 0
    ? '[Start of conversation — open with the first question.]'
    : messages.map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`).join('\n\n')

  const { text } = await generateSonnetText({
    model: HAIKU_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: transcript,
    maxTokens: 800,
    temperature: 0.5,
    jsonSchema: TURN_TOOL_SCHEMA as unknown as Record<string, unknown>,
  })

  if (!text) {
    // The model didn't emit a tool call — return a soft fallback so the
    // UI doesn't lock up. Surfaces as a generic "please rephrase".
    return {
      message: "Sorry, I missed that — can you rephrase?",
      ready: false,
    }
  }

  const parsed = JSON.parse(text) as ChatTurn
  return parsed
}
