import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  api,
  ApiError,
  type ChatMessageDTO,
  type ChatTurnDTO,
  type ChatToolUseBlockDTO,
  type ChatContentBlockDTO,
  type ChatPlanInput,
  type BrandDTO,
  type VideoFormat,
  type VoiceTone,
} from '../../shared/api/client.js'
import { Button, Spinner } from '../../design-system/components/index.js'
import styles from './ChatGenerate.module.css'

/**
 * Agentic chat-first generate flow. The LLM has access to a small set of
 * tools (propose_plan, suggest_voice, suggest_style, commit_and_generate)
 * and decides for itself when to call them. Each tool call renders an
 * interactive UI card in the chat — an editable plan card, a clickable
 * voice suggestion, etc. The user can edit the plan inline or reply in
 * natural language; the LLM reacts on the next turn.
 *
 * Transcript is kept client-side and re-posted in full each turn — the
 * `/chat` endpoint is stateless. Each message carries a `content` array
 * of blocks (text / tool_use / tool_result) mirroring the Anthropic SDK
 * content shape.
 *
 * Flow:
 *   - Open → POST empty transcript → LLM greets / proposes a plan.
 *   - User types or clicks a suggestion → append a user message → POST
 *     → LLM responds with more blocks.
 *   - User clicks Generate on a plan card → bypass the LLM, POST
 *     /api/marketing-videos directly, navigate to /video/:id (or
 *     dashboard if the create response doesn't include an id).
 */

type Phase = 'chat' | 'generating'

const VOICE_TONES: VoiceTone[] = [
  'confident', 'punchy', 'playful', 'calm', 'serious', 'inspirational', 'conversational',
]
const FORMATS: VideoFormat[] = ['16:9', '9:16', '1:1']
const MUSIC_TRACKS = [
  { id: 'ai-cinematic', label: 'Cinematic' },
  { id: 'ai-upbeat', label: 'Upbeat' },
  { id: 'ai-inspirational', label: 'Inspirational' },
  { id: 'ai-lofi', label: 'Lo-fi' },
  { id: 'ai-tech', label: 'Tech' },
  { id: 'ai-ambient', label: 'Ambient' },
  { id: 'none', label: 'No music' },
]
const STYLE_SEEDS = [
  'editorial', 'product-tour', 'metric-driven', 'process-flow',
  'brand-first', 'conversational', 'high-contrast', 'data-density',
]

interface UiMessage extends ChatMessageDTO {
  /** Local React-key id. Server doesn't track this. */
  id: string
}

export function ChatGenerate(): React.ReactElement {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [phase, setPhase] = useState<Phase>('chat')
  const [error, setError] = useState<string | null>(null)
  const [brands, setBrands] = useState<BrandDTO[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const initFired = useRef(false)
  const commitFiredRef = useRef<string | null>(null)

  // Send a turn to the chat endpoint and append the response to the
  // transcript. The optimisticMessages param lets callers see their own
  // user message land in the UI before the server roundtrip resolves.
  const callChat = useCallback(async (optimisticMessages: UiMessage[]) => {
    setMessages(optimisticMessages)
    setWaiting(true)
    setError(null)
    try {
      const payload: ChatMessageDTO[] = optimisticMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))
      const turn: ChatTurnDTO = await api.marketingVideos.chat(payload)
      const assistantMessage: UiMessage = {
        id: cryptoRandom(),
        role: 'assistant',
        content: turn.blocks as ChatContentBlockDTO[],
      }
      setMessages([...optimisticMessages, assistantMessage])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setWaiting(false)
    }
  }, [])

  // Kick the conversation off. Empty transcript → LLM greets.
  useEffect(() => {
    if (initFired.current) return
    initFired.current = true
    void (async () => {
      const brandsRes = await api.brands.list().catch(() => ({ items: [] }))
      setBrands(brandsRes.items)
      await callChat([])
    })()
  }, [callChat])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, waiting])

  // Identify the most-recent propose_plan block — that's the "live" card
  // the user can still edit. Older proposals are rendered as stale cards
  // for context but not interactive.
  const latestPlanRef = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!
      if (m.role !== 'assistant' || typeof m.content === 'string') continue
      for (const b of m.content) {
        if (b.type === 'tool_use' && b.name === 'propose_plan') {
          return { messageId: m.id, toolUseId: b.id }
        }
      }
    }
    return null
  }, [messages])

  // Auto-fire commit_and_generate when the LLM emits it. We bypass the
  // chat for the actual generation — the tool call IS the trigger.
  // The ref guard ensures one commit block fires at most one POST /create,
  // even across re-renders.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || typeof last.content === 'string') return
    const commit = last.content.find((b): b is ChatToolUseBlockDTO => b.type === 'tool_use' && b.name === 'commit_and_generate')
    if (commit && commitFiredRef.current !== commit.id) {
      commitFiredRef.current = commit.id
      void runGenerate(commit.input as ChatPlanInput)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // Anthropic requires that EVERY tool_use block from the previous
  // assistant turn gets a matching tool_result in the next user turn —
  // otherwise the API rejects the request. When the user just types
  // text (or clicks a single suggestion), we synthesize "no-op"
  // tool_result blocks for the other pending tool_uses so the LLM has
  // a complete picture.
  const buildPendingToolResults = useCallback((acceptedToolUseId?: string): ChatContentBlockDTO[] => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || typeof last.content === 'string') return []
    const results: ChatContentBlockDTO[] = []
    for (const b of last.content) {
      if (b.type !== 'tool_use') continue
      if (b.id === acceptedToolUseId) continue
      results.push({
        type: 'tool_result',
        tool_use_id: b.id,
        content: 'User did not click this card; see their message for what they want next.',
      })
    }
    return results
  }, [messages])

  const sendUserText = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || waiting) return
    const userMsg: UiMessage = {
      id: cryptoRandom(),
      role: 'user',
      content: [
        ...buildPendingToolResults(),
        { type: 'text', text: trimmed },
      ],
    }
    setInput('')
    await callChat([...messages, userMsg])
  }, [messages, waiting, callChat, buildPendingToolResults])

  const sendToolResult = useCallback(async (toolUseId: string, content: string) => {
    if (waiting) return
    const userMsg: UiMessage = {
      id: cryptoRandom(),
      role: 'user',
      content: [
        ...buildPendingToolResults(toolUseId),
        { type: 'tool_result', tool_use_id: toolUseId, content },
      ],
    }
    await callChat([...messages, userMsg])
  }, [messages, waiting, callChat, buildPendingToolResults])

  const runGenerate = useCallback(async (plan: ChatPlanInput) => {
    setPhase('generating')
    setError(null)
    try {
      const defaultBrand = brands.find((b) => b.isDefault) ?? brands[0]
      const created = await api.marketingVideos.create({
        brief: plan.brief,
        title: plan.title,
        brandId: defaultBrand?.id,
        options: {
          tone: plan.tone,
          musicTrackId: plan.musicTrackId,
          aiMusicPrompt: plan.aiMusicPrompt,
          userPrompt: plan.userPrompt,
          format: plan.format,
          styleSeed: plan.styleSeed,
        },
      })
      // Navigate to the detail page so the user can watch the render
      // land and refine afterwards. Falls back to dashboard if the
      // create response shape ever drops the id field.
      navigate(created.id ? `/video/${created.id}` : '/dashboard')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_CREDITS') {
        setError("You've used your credit. Buy a pack from the billing page.")
      } else {
        setError((err as Error).message)
      }
      setPhase('chat')
    }
  }, [brands, navigate])

  if (phase === 'generating') {
    return (
      <div className={styles.generating}>
        <Spinner size="lg" />
        <h2>Generating your video…</h2>
        <p>Script, voice-over, music, and render. This takes about 2-3 minutes.</p>
        <p className={styles.warn}>Don't close the tab.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/dashboard')}>← Back</button>
        <span className={styles.title}>New video</span>
      </header>

      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.thread}>
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              isLatestPlan={(toolUseId) => latestPlanRef?.toolUseId === toolUseId}
              onAcceptSuggestion={sendToolResult}
              onGenerate={runGenerate}
              disabled={waiting}
            />
          ))}
          {waiting && (
            <div className={styles.assistantRow}>
              <div className={styles.assistantBubble}>
                <span className={styles.typing}><span /><span /><span /></span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.composer}>
        {error && <div className={styles.error}>{error}</div>}
        <form
          className={styles.inputRow}
          onSubmit={(e) => { e.preventDefault(); void sendUserText(input) }}
        >
          <textarea
            className={styles.input}
            placeholder="Describe your product, or react to the assistant…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void sendUserText(input)
              }
            }}
            rows={1}
            disabled={waiting}
          />
          <Button type="submit" variant="primary" disabled={waiting || !input.trim()}>Send</Button>
        </form>
      </div>
    </div>
  )
}

// ============================================================
// Message rendering — split text vs tool_use blocks. Tool blocks
// become interactive cards; text blocks become bubbles.
// ============================================================

interface MessageRowProps {
  message: UiMessage
  isLatestPlan: (toolUseId: string) => boolean
  onAcceptSuggestion: (toolUseId: string, content: string) => Promise<void>
  onGenerate: (plan: ChatPlanInput) => Promise<void>
  disabled: boolean
}

function MessageRow({ message, isLatestPlan, onAcceptSuggestion, onGenerate, disabled }: MessageRowProps): React.ReactElement | null {
  // User message — either plain text typed in, or a tool_result we
  // surface as a quiet "(accepted)" line so the conversation stays
  // legible. Tool_result blocks aren't rendered as bubbles to keep the
  // chat from being polluted by machine-readable payloads.
  if (message.role === 'user') {
    const text = extractUserText(message.content)
    if (!text) return null
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>{text}</div>
      </div>
    )
  }

  // Assistant — iterate blocks in order.
  const blocks = typeof message.content === 'string'
    ? [{ type: 'text' as const, text: message.content }]
    : message.content

  return (
    <>
      {blocks.map((b, i) => {
        const key = `${message.id}-${i}`
        if (b.type === 'text') {
          return (
            <div key={key} className={styles.assistantRow}>
              <div className={styles.assistantBubble}>{b.text}</div>
            </div>
          )
        }
        if (b.type === 'tool_use') {
          if (b.name === 'propose_plan') {
            return (
              <div key={key} className={styles.assistantRow}>
                <PlanCard
                  toolUseId={b.id}
                  initial={b.input as ChatPlanInput}
                  isLive={isLatestPlan(b.id)}
                  onGenerate={onGenerate}
                  disabled={disabled}
                />
              </div>
            )
          }
          if (b.name === 'suggest_voice') {
            const input = b.input as { voiceId?: string; voiceName?: string; reason?: string }
            return (
              <div key={key} className={styles.assistantRow}>
                <SuggestionCard
                  label="Voice suggestion"
                  title={input.voiceName ?? input.voiceId ?? 'Voice'}
                  reason={input.reason}
                  onAccept={() => void onAcceptSuggestion(b.id, `User accepted voice ${input.voiceName ?? input.voiceId}.`)}
                  disabled={disabled}
                />
              </div>
            )
          }
          if (b.name === 'suggest_style') {
            const input = b.input as { styleSeed?: string; reason?: string }
            return (
              <div key={key} className={styles.assistantRow}>
                <SuggestionCard
                  label="Style suggestion"
                  title={input.styleSeed ?? 'Style'}
                  reason={input.reason}
                  onAccept={() => void onAcceptSuggestion(b.id, `User accepted style "${input.styleSeed}".`)}
                  disabled={disabled}
                />
              </div>
            )
          }
          // commit_and_generate is handled by an effect at the page
          // level — it renders nothing inline (the page is already
          // transitioning to the generating view).
          if (b.name === 'commit_and_generate') return null
        }
        return null
      })}
    </>
  )
}

function extractUserText(content: UiMessage['content']): string | null {
  if (typeof content === 'string') return content
  const parts: string[] = []
  for (const b of content) {
    if (b.type === 'text') parts.push(b.text)
  }
  return parts.length > 0 ? parts.join('\n\n') : null
}

// ============================================================
// PlanCard — the LLM's draft, rendered as an editable form.
// ============================================================

interface PlanCardProps {
  toolUseId: string
  initial: ChatPlanInput
  isLive: boolean
  onGenerate: (plan: ChatPlanInput) => Promise<void>
  disabled: boolean
}

function PlanCard({ initial, isLive, onGenerate, disabled }: PlanCardProps): React.ReactElement {
  const [plan, setPlan] = useState<ChatPlanInput>(initial)

  // The LLM may emit a new propose_plan when it has more info. The "live"
  // card always reflects the latest input — re-sync when the source
  // changes (only when we're the live card, so user edits aren't lost
  // on stale cards we shouldn't be editing anyway).
  useEffect(() => {
    if (isLive) setPlan(initial)
  }, [initial, isLive])

  const set = <K extends keyof ChatPlanInput>(k: K, v: ChatPlanInput[K]) => setPlan({ ...plan, [k]: v })

  return (
    <div className={`${styles.planCard} ${!isLive ? styles.stale : ''}`}>
      <div className={styles.planCardHeader}>{isLive ? 'Plan — edit any field' : 'Earlier plan'}</div>

      <div className={styles.planRow}>
        <span className={styles.planLabel}>Brief</span>
        <textarea
          className={styles.planTextarea}
          value={plan.brief}
          onChange={(e) => set('brief', e.target.value)}
          disabled={!isLive || disabled}
        />
      </div>

      <div className={styles.planGrid}>
        <div className={styles.planRow}>
          <span className={styles.planLabel}>Format</span>
          <select className={styles.planSelect} value={plan.format} onChange={(e) => set('format', e.target.value as VideoFormat)} disabled={!isLive || disabled}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className={styles.planRow}>
          <span className={styles.planLabel}>Tone</span>
          <select className={styles.planSelect} value={plan.tone} onChange={(e) => set('tone', e.target.value as VoiceTone)} disabled={!isLive || disabled}>
            {VOICE_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.planGrid}>
        <div className={styles.planRow}>
          <span className={styles.planLabel}>Music</span>
          <select className={styles.planSelect} value={plan.musicTrackId} onChange={(e) => set('musicTrackId', e.target.value)} disabled={!isLive || disabled}>
            {MUSIC_TRACKS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className={styles.planRow}>
          <span className={styles.planLabel}>Style</span>
          <select className={styles.planSelect} value={plan.styleSeed ?? ''} onChange={(e) => set('styleSeed', e.target.value || undefined)} disabled={!isLive || disabled}>
            <option value="">(auto)</option>
            {STYLE_SEEDS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.planActions}>
        <Button variant="primary" size="sm" disabled={!isLive || disabled} onClick={() => void onGenerate(plan)}>
          Generate (1 credit)
        </Button>
      </div>
    </div>
  )
}

// ============================================================
// SuggestionCard — small clickable card for voice / style picks.
// ============================================================

interface SuggestionCardProps {
  label: string
  title: string
  reason?: string
  onAccept: () => void
  disabled: boolean
}

function SuggestionCard({ label, title, reason, onAccept, disabled }: SuggestionCardProps): React.ReactElement {
  const [accepted, setAccepted] = useState(false)
  return (
    <div
      className={`${styles.suggestionCard} ${accepted ? styles.accepted : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (disabled || accepted) return
        setAccepted(true)
        onAccept()
      }}
    >
      <span className={styles.suggestionLabel}>{label}</span>
      <span className={styles.suggestionTitle}>{title}</span>
      {reason && <span className={styles.suggestionReason}>{reason}</span>}
    </div>
  )
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10)
}
