import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  api,
  ApiError,
  type ChatMessageDTO,
  type ChatTurnDTO,
  type ChatExtractedBriefDTO,
  type BrandDTO,
} from '../../shared/api/client.js'
import { Button, Spinner } from '../../design-system/components/index.js'
import styles from './ChatGenerate.module.css'

/**
 * Chat-first generate flow. Replaces the legacy stepper modal:
 * a centered conversation collects the brief through targeted
 * questions (Haiku-driven), with quick-reply chips for the choices
 * that have a small fixed option set (format / tone / music). When
 * the assistant signals `ready`, the page shows a recap card and
 * calls the existing create endpoint with the structured brief.
 *
 * Three states: collecting (chat), confirming (recap card), generating
 * (full-screen spinner). The chat transcript stays on the client; the
 * `/chat` endpoint is stateless and gets the full history each turn.
 */

type Phase = 'chat' | 'generating' | 'done'

interface UiMessage extends ChatMessageDTO {
  /** Local id for React key. Server doesn't care. */
  id: string
  /** Quick replies attached to an assistant message (chat phase only). */
  quickReplies?: { label: string; value: string }[]
}

export function ChatGenerate(): React.ReactElement {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [brief, setBrief] = useState<ChatExtractedBriefDTO | null>(null)
  const [phase, setPhase] = useState<Phase>('chat')
  const [error, setError] = useState<string | null>(null)
  const [brands, setBrands] = useState<BrandDTO[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const initFired = useRef(false)

  // Push the opening assistant question on mount. Also fetch brands so we
  // can pass a brandId at submit time — the chat itself doesn't ask the
  // user to pick a brand (we use the default).
  useEffect(() => {
    if (initFired.current) return
    initFired.current = true
    void (async () => {
      try {
        const [turn, brandsRes] = await Promise.all([
          api.marketingVideos.chat([]),
          api.brands.list().catch(() => ({ items: [] })),
        ])
        setBrands(brandsRes.items)
        pushAssistant(turn)
      } catch (err) {
        setError((err as Error).message)
      }
    })()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, waiting])

  const pushAssistant = useCallback((turn: ChatTurnDTO) => {
    setMessages((prev) => [
      ...prev,
      {
        id: cryptoRandom(),
        role: 'assistant',
        content: turn.message,
        quickReplies: turn.quickReplies,
      },
    ])
    if (turn.ready && turn.brief) {
      setBrief(turn.brief)
    }
  }, [])

  const sendUserMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || waiting) return
    setError(null)
    const userMsg: UiMessage = { id: cryptoRandom(), role: 'user', content: trimmed }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setWaiting(true)
    try {
      // Strip the local-only fields before sending.
      const payload: ChatMessageDTO[] = nextMessages.map((m) => ({ role: m.role, content: m.content }))
      const turn = await api.marketingVideos.chat(payload)
      pushAssistant(turn)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setWaiting(false)
    }
  }, [messages, waiting, pushAssistant])

  const submitBrief = useCallback(async () => {
    if (!brief) return
    setPhase('generating')
    setError(null)
    try {
      const defaultBrand = brands.find((b) => b.isDefault) ?? brands[0]
      await api.marketingVideos.create({
        brief: brief.brief,
        title: brief.title,
        brandId: defaultBrand?.id,
        options: {
          tone: brief.tone,
          musicTrackId: brief.musicTrackId,
          userPrompt: brief.userPrompt,
          format: brief.format,
        },
      })
      setPhase('done')
      navigate('/dashboard')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_CREDITS') {
        setError("You've used your credit. Buy a pack from the billing page.")
      } else {
        setError((err as Error).message)
      }
      setPhase('chat')
    }
  }, [brief, brands, navigate])

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant'),
    [messages],
  )
  const activeQuickReplies = !waiting && !brief && lastAssistant?.quickReplies

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
            <div key={m.id} className={m.role === 'user' ? styles.userRow : styles.assistantRow}>
              <div className={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>
                {m.content}
              </div>
            </div>
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

      {brief ? (
        <div className={styles.confirmCard}>
          <div className={styles.confirmRow}>
            <span className={styles.confirmLabel}>Brief</span>
            <span className={styles.confirmValue}>{brief.brief}</span>
          </div>
          <div className={styles.confirmGrid}>
            <div><span className={styles.confirmLabel}>Format</span><span className={styles.confirmChip}>{brief.format}</span></div>
            <div><span className={styles.confirmLabel}>Tone</span><span className={styles.confirmChip}>{brief.tone}</span></div>
            <div><span className={styles.confirmLabel}>Music</span><span className={styles.confirmChip}>{prettyMusic(brief.musicTrackId)}</span></div>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.confirmActions}>
            <Button variant="ghost" onClick={() => { setBrief(null); setPhase('chat') }}>Refine</Button>
            <Button variant="primary" onClick={() => void submitBrief()}>Generate video (1 credit)</Button>
          </div>
        </div>
      ) : (
        <div className={styles.composer}>
          {activeQuickReplies && (
            <div className={styles.chips}>
              {activeQuickReplies.map((q) => (
                <button
                  key={q.value}
                  className={styles.chip}
                  onClick={() => void sendUserMessage(q.value)}
                  disabled={waiting}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
          {error && <div className={styles.error}>{error}</div>}
          <form
            className={styles.inputRow}
            onSubmit={(e) => { e.preventDefault(); void sendUserMessage(input) }}
          >
            <textarea
              className={styles.input}
              placeholder="Describe your product…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendUserMessage(input)
                }
              }}
              rows={1}
              disabled={waiting}
            />
            <Button type="submit" variant="primary" disabled={waiting || !input.trim()}>Send</Button>
          </form>
        </div>
      )}
    </div>
  )
}

function cryptoRandom(): string {
  // Browser crypto for stable React keys — no need to be unguessable, just unique.
  return Math.random().toString(36).slice(2, 10)
}

function prettyMusic(id: string): string {
  if (id === 'none') return 'No music'
  return id.replace(/^ai-/, '').replace(/^./, (c) => c.toUpperCase())
}
