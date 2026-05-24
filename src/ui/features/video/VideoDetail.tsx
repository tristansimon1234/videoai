import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, ColorPicker, Field, Spinner } from '../../design-system/components/index.js'
import { api, ApiError, type VoiceTone, type MarketingVideoListItemDTO } from '../../shared/api/client.js'
import { ALL_FONTS, findByCssValue, DEFAULT_FONT } from '../../../shared/design/fonts.js'
import styles from './VideoDetail.module.css'

/**
 * Refine an already-generated marketing video. The user has already paid
 * the credit at generation time — all edits here are free re-renders that
 * mutate the persisted manifest then re-trigger Remotion.
 *
 * Flow:
 *   - GET /api/marketing-videos/:id → load manifest + status.
 *   - User edits a section, clicks "Save & re-render":
 *       a. PUT /:id/manifest or POST /:id/voiceover to persist.
 *       b. POST /:id/render to kick a fresh Remotion render.
 *       c. Local state flips to 'rendering' and we poll GET /:id every 5s
 *          until status is 'ready' or 'failed'.
 */

type VoiceListItem = { voiceId: string; name: string; category: string }

interface ManifestShape {
  branding: {
    productName: string
    accentColor: string
    accentSecondary?: string
    bgColor: string
    textColor: string
    fontFamily: string
    logoUrl: string | null
    websiteUrl?: string | null
    radius?: number
  }
  script: {
    hook: { voiceover: string; headline: string; durationSeconds: number }
    scenes: Array<{
      voiceover: string
      headline: string
      subhead?: string
      durationSeconds: number
      screenshotIndex: number | null
      [k: string]: unknown
    }>
    cta: { voiceover: string; headline: string; buttonLabel: string; durationSeconds: number }
    totalDurationSeconds: number
    language: string
    styleSeed?: string
  }
  format?: '16:9' | '9:16' | '1:1'
}

type DetailDTO = MarketingVideoListItemDTO & { manifest: ManifestShape | null }

const VOICE_TONES: VoiceTone[] = [
  'punchy', 'calm', 'playful', 'serious', 'confident', 'inspirational', 'conversational',
]

export function VideoDetail(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<DetailDTO | null>(null)
  const [voices, setVoices] = useState<VoiceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const res = await api.marketingVideos.get(id) as DetailDTO
      setData(res)
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        navigate('/dashboard', { replace: true })
        return
      }
      setError((err as Error).message)
    }
  }, [id, navigate])

  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      const [, voicesRes] = await Promise.all([
        refresh(),
        api.marketingVideos.voices().catch(() => ({ voices: [] as VoiceListItem[] })),
      ])
      if (!alive) return
      setVoices(voicesRes.voices)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [refresh])

  // Poll while a render is in flight. Stop as soon as it lands.
  useEffect(() => {
    const status = data?.renderStatus
    if (status === 'rendering' || status === 'generating' || status === 'pending') {
      if (pollRef.current) return
      pollRef.current = setInterval(() => { void refresh() }, 5000)
    } else if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [data?.renderStatus, refresh])

  if (loading) {
    return <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}><Spinner size="lg" /></div>
  }

  if (!data || !data.manifest) {
    return (
      <div className={styles.page}>
        <div style={{ padding: 32 }}>
          <Link to="/dashboard" className={styles.backLink}>← Back</Link>
          <p style={{ marginTop: 16 }}>This video has no manifest yet — it may still be generating.</p>
        </div>
      </div>
    )
  }

  const manifest = data.manifest
  const format = manifest.format ?? '16:9'
  const isPortrait = format === '9:16'
  const isSquare = format === '1:1'
  const previewClass = `${styles.previewBox} ${isPortrait ? styles.portrait : isSquare ? styles.square : ''}`.trim()
  const inFlight = data.renderStatus === 'rendering' || data.renderStatus === 'generating' || data.renderStatus === 'pending'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/dashboard" className={styles.backLink}>← Back to dashboard</Link>
        <Link to="/" className={styles.brandLink}>SaaS Video</Link>
      </header>

      <main className={styles.main}>
        <div>
          <h1 className={styles.title}>{data.title}</h1>
          <p className={styles.titleMeta}>
            {format} · {data.durationSeconds ? `${data.durationSeconds.toFixed(0)}s` : '—'} · {new Date(data.createdAt).toLocaleDateString()}
          </p>
          <div className={previewClass}>
            {data.videoUrl && data.renderStatus === 'ready' ? (
              <video
                key={data.videoUrl}
                controls
                className={styles.previewVideo}
                poster={data.thumbnailUrl ?? undefined}
              >
                <source src={data.videoUrl} type="video/mp4" />
              </video>
            ) : (
              <div className={styles.previewPlaceholder}>
                {data.renderStatus === 'failed' ? 'Render failed' : 'Preparing preview…'}
              </div>
            )}
            {inFlight && (
              <div className={styles.statusBanner}>
                <Spinner size="md" />
                <span>{data.renderStatus === 'rendering' ? 'Re-rendering…' : 'Generating…'}</span>
              </div>
            )}
          </div>
          {data.renderError && <p className={styles.errorMsg} style={{ marginTop: 12 }}>{data.renderError}</p>}
          {error && <p className={styles.errorMsg} style={{ marginTop: 12 }}>{error}</p>}
        </div>

        <aside className={styles.sidebar}>
          <ColorsSection videoId={data.id} manifest={manifest} disabled={inFlight} onSaved={refresh} />
          <VoiceSection videoId={data.id} manifest={manifest} voices={voices} disabled={inFlight} onSaved={refresh} />
          <FontSection videoId={data.id} manifest={manifest} disabled={inFlight} onSaved={refresh} />
          <ScriptSection videoId={data.id} manifest={manifest} disabled={inFlight} onSaved={refresh} />
        </aside>
      </main>
    </div>
  )
}

// ============================================================
// Section components — each owns a draft, a Save handler that
// triggers PUT manifest (or POST voiceover) followed by render.
// ============================================================

interface SectionProps {
  videoId: string
  manifest: ManifestShape
  disabled: boolean
  onSaved: () => Promise<void>
}

function ColorsSection({ videoId, manifest, disabled, onSaved }: SectionProps): React.ReactElement {
  const [accent, setAccent] = useState(manifest.branding.accentColor)
  const [bg, setBg] = useState(manifest.branding.bgColor)
  const [text, setText] = useState(manifest.branding.textColor)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = accent !== manifest.branding.accentColor || bg !== manifest.branding.bgColor || text !== manifest.branding.textColor

  const onSave = async () => {
    setSaving(true)
    setErr(null)
    try {
      await api.marketingVideos.updateManifest(videoId, {
        script: manifest.script,
        branding: { accentColor: accent, bgColor: bg, textColor: text },
      })
      await api.marketingVideos.render(videoId)
      await onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>Colors</h3></div>
      <div className={styles.row}><span className={styles.rowLabel}>Accent</span><ColorPicker value={accent} onChange={setAccent} /></div>
      <div className={styles.row}><span className={styles.rowLabel}>Background</span><ColorPicker value={bg} onChange={setBg} /></div>
      <div className={styles.row}><span className={styles.rowLabel}>Text</span><ColorPicker value={text} onChange={setText} /></div>
      {err && <p className={styles.errorMsg}>{err}</p>}
      <div className={styles.actions}>
        <Button variant="primary" size="sm" disabled={!dirty || saving || disabled} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save & re-render'}
        </Button>
      </div>
    </div>
  )
}

function VoiceSection({ videoId, voices, disabled, onSaved }: SectionProps & { voices: VoiceListItem[] }): React.ReactElement {
  const [voiceId, setVoiceId] = useState<string>('')
  const [tone, setTone] = useState<VoiceTone>('punchy')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dirty = voiceId !== '' || tone !== 'punchy'

  const onSave = async () => {
    setSaving(true)
    setErr(null)
    try {
      await api.marketingVideos.updateVoiceover(videoId, {
        ...(voiceId ? { voiceId } : {}),
        tone,
      })
      await api.marketingVideos.render(videoId)
      await onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>Voice & tone</h3></div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Voice</span>
        <select className={styles.select} value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={voices.length === 0}>
          <option value="">(keep current)</option>
          {voices.map((v) => <option key={v.voiceId} value={v.voiceId}>{v.name}</option>)}
        </select>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Tone</span>
        <select className={styles.select} value={tone} onChange={(e) => setTone(e.target.value as VoiceTone)}>
          {VOICE_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {err && <p className={styles.errorMsg}>{err}</p>}
      <p className={styles.savedHint}>Re-synthesizes the voice-over and re-renders the MP4.</p>
      <div className={styles.actions}>
        <Button variant="primary" size="sm" disabled={!dirty || saving || disabled} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save & re-render'}
        </Button>
      </div>
    </div>
  )
}

function FontSection({ videoId, manifest, disabled, onSaved }: SectionProps): React.ReactElement {
  const currentCssValue = useMemo(
    () => findByCssValue(manifest.branding.fontFamily)?.cssValue ?? DEFAULT_FONT.cssValue,
    [manifest.branding.fontFamily],
  )
  const [cssValue, setCssValue] = useState(currentCssValue)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = cssValue !== currentCssValue

  const onSave = async () => {
    setSaving(true)
    setErr(null)
    try {
      await api.marketingVideos.updateManifest(videoId, {
        script: manifest.script,
        branding: { fontFamily: cssValue },
      })
      await api.marketingVideos.render(videoId)
      await onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>Font</h3></div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Family</span>
        <select className={styles.select} value={cssValue} onChange={(e) => setCssValue(e.target.value)}>
          {ALL_FONTS.map((f) => <option key={f.cssValue} value={f.cssValue}>{f.label}</option>)}
        </select>
      </div>
      {err && <p className={styles.errorMsg}>{err}</p>}
      <div className={styles.actions}>
        <Button variant="primary" size="sm" disabled={!dirty || saving || disabled} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save & re-render'}
        </Button>
      </div>
    </div>
  )
}

function ScriptSection({ videoId, manifest, disabled, onSaved }: SectionProps): React.ReactElement {
  const [draft, setDraft] = useState(() => structuredClone(manifest.script))
  const [saving, setSaving] = useState(false)
  const [regenIndex, setRegenIndex] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(manifest.script)

  const onSave = async () => {
    setSaving(true)
    setErr(null)
    try {
      await api.marketingVideos.updateManifest(videoId, { script: draft })
      // The voiceover MP3 was generated from the previous script — re-synth
      // so the audio matches the new text. Uses the default voice/tone; the
      // user can override via the Voice section afterward if needed.
      await api.marketingVideos.updateVoiceover(videoId, {})
      await api.marketingVideos.render(videoId)
      await onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const onRegenerateScene = async (idx: number) => {
    setRegenIndex(idx)
    setErr(null)
    try {
      await api.marketingVideos.regenerateScene(videoId, idx)
      await onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRegenIndex(null)
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}>Script</h3></div>

      <div className={styles.sceneEditor}>
        <span className={styles.sceneLabel}>Hook</span>
        <Field label="Headline" value={draft.hook.headline} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, hook: { ...draft.hook, headline: e.target.value } })} />
        <Field label="Voiceover" multiline value={draft.hook.voiceover} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, hook: { ...draft.hook, voiceover: e.target.value } })} />
      </div>

      {draft.scenes.map((scene, idx) => {
        const regenerating = regenIndex === idx
        return (
          <div key={idx} className={styles.sceneEditor}>
            <div className={styles.sceneEditorHeader}>
              <span className={styles.sceneLabel}>Scene {idx + 1}</span>
              <button
                type="button"
                className={styles.regenButton}
                onClick={() => void onRegenerateScene(idx)}
                disabled={disabled || saving || regenIndex !== null}
                title="Re-run the designer on just this scene — keeps headline & voice-over, changes the visual."
              >
                {regenerating ? <span className={styles.spinDot} aria-hidden /> : <span aria-hidden>↻</span>}
                <span>{regenerating ? 'Regenerating…' : 'Regenerate visual'}</span>
              </button>
            </div>
            <Field label="Headline" value={scene.headline} onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const next = [...draft.scenes]
              next[idx] = { ...scene, headline: e.target.value }
              setDraft({ ...draft, scenes: next })
            }} />
            <Field label="Subhead" value={scene.subhead ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const next = [...draft.scenes]
              next[idx] = { ...scene, subhead: e.target.value }
              setDraft({ ...draft, scenes: next })
            }} />
            <Field label="Voiceover" multiline value={scene.voiceover} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
              const next = [...draft.scenes]
              next[idx] = { ...scene, voiceover: e.target.value }
              setDraft({ ...draft, scenes: next })
            }} />
          </div>
        )
      })}

      <div className={styles.sceneEditor}>
        <span className={styles.sceneLabel}>CTA</span>
        <Field label="Headline" value={draft.cta.headline} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, cta: { ...draft.cta, headline: e.target.value } })} />
        <Field label="Button label" value={draft.cta.buttonLabel} onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, cta: { ...draft.cta, buttonLabel: e.target.value } })} />
        <Field label="Voiceover" multiline value={draft.cta.voiceover} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, cta: { ...draft.cta, voiceover: e.target.value } })} />
      </div>

      {err && <p className={styles.errorMsg}>{err}</p>}
      <p className={styles.savedHint}>Saving edits will also re-synthesize the voice-over. Regenerating only swaps the visual.</p>
      <div className={styles.actions}>
        <Button variant="primary" size="sm" disabled={!dirty || saving || disabled || regenIndex !== null} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save & re-render'}
        </Button>
      </div>
    </div>
  )
}
