import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Branding, Scene, Screenshot } from '../manifest.js'
import { BrandWatermark } from './BrandWatermark.js'
import { DynamicScene } from './DynamicScene.js'

interface FeatureSceneProps {
  scene: Scene
  screenshot: Screenshot | null
  branding: Branding
  /** 0-based index of this scene in the script. Drives layout variation
   *  so consecutive scenes don't all look the same. */
  sceneIndex: number
}

/**
 * Mid-act scene. Three layout variants cycle by sceneIndex so a 4-scene
 * video doesn't feel like the same shot repeated. The text-block and
 * visual-block are extracted into shared sub-components — the layout
 * is just where we position them.
 *
 *   index % 3 === 0 → split-left   (text left, visual right)
 *   index % 3 === 1 → split-right  (mirrored: text right, visual left)
 *   index % 3 === 2 → stacked      (headline top, visual below)
 *
 * Opt-out: set `scene.headlinePanel = false` to skip the headline panel
 * entirely — the mock then fills the full 1920×1080 canvas and the
 * voice-over carries the narrative. Use for a cinematic single-visual
 * beat where on-screen copy would compete with the mock. `framing` is
 * an orthogonal concern (cadrage of the mock itself: browser / mobile
 * / terminal / fullbleed / split); keep them separate so a
 * `headlinePanel: false` mock can still pick whatever cadrage fits.
 *
 * The previous "fullscreen" variant (visual fills the canvas, text in
 * a backdrop-blur card on top) is dropped — overlaying a glass card on
 * a busy product screenshot produced a visually cluttered result the
 * user described as "horrible". The three remaining layouts all
 * cleanly separate text from visual.
 *
 * The screenshot can be null; layouts gracefully fall back to a tinted
 * accent panel so the structure doesn't collapse.
 */
type LayoutVariant = 'split-left' | 'split-right' | 'stacked' | 'fullbleed-total'
const LAYOUT_CYCLE: LayoutVariant[] = ['split-left', 'split-right', 'stacked']

export const FeatureScene: React.FC<FeatureSceneProps> = ({ scene, screenshot, branding, sceneIndex }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const isPortrait = height > width
  const shortSide = Math.min(width, height)
  const sidePadding = Math.round(width * 0.052)
  // In landscape (16:9): text takes ~37.5% of width left/right, visual takes ~48% on the opposite side.
  // In portrait/square the split layout collapses to 'stacked' below.
  const textBlockWidth = Math.round(width * 0.375)
  const visualBlockWidth = Math.round(width * 0.48)
  const visualBlockHeight = Math.round(height * 0.537)
  // Stacked layout — visual is wider, lives below the text.
  const stackedVisualWidth = Math.round(width * (isPortrait ? 0.88 : 0.667))
  const stackedVisualHeight = Math.round(height * (isPortrait ? 0.5 : 0.537))
  const stackedTopOffset = Math.round(height * 0.074)

  const textIn = spring({ frame: frame - 4, fps, config: { damping: 18, stiffness: 90 } })
  const imgIn = spring({ frame: frame - 12, fps, config: { damping: 18, stiffness: 90 } })

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 14, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp' },
  )

  const headlineY = interpolate(textIn, [0, 1], [30, 0])
  const headlineOpacity = interpolate(textIn, [0, 1], [0, 1]) * fadeOut
  const imgOpacity = interpolate(imgIn, [0, 1], [0, 1]) * fadeOut

  // Ken Burns — slow zoom + diagonal pan. Direction varies per scene so
  // a 4-scene video doesn't pan the same way 4 times in a row.
  const kbProgress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const kbScale = interpolate(kbProgress, [0, 1], [1.0, 1.08])
  const headlineHash = scene.headline.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const kbDirX = (headlineHash % 2 === 0 ? 1 : -1)
  const kbDirY = (Math.floor(headlineHash / 2) % 2 === 0 ? 1 : -1)
  const kbPanX = interpolate(kbProgress, [0, 1], [0, 28 * kbDirX])
  const kbPanY = interpolate(kbProgress, [0, 1], [0, 16 * kbDirY])

  // headlinePanel === false → caller wants the mock to own the whole
  // canvas and the voice-over to carry the narrative. We skip the
  // headline panel and let the visual element fill 1920×1080. Useful
  // for a "single cinematic shot" beat where any on-screen copy would
  // compete with the mock for attention. Default is true (current
  // three-variant layout).
  //
  // `framing === 'fullbleed-total'` stays accepted as a legacy alias
  // for the same effect — one early caller used it before we settled
  // on the explicit boolean. New callers should pass `headlinePanel`.
  const headlinePanelOff =
    scene.headlinePanel === false || scene.framing === 'fullbleed-total'
  const cycledLayout = LAYOUT_CYCLE[sceneIndex % LAYOUT_CYCLE.length]!
  // Side-by-side layouts assume a wide canvas. In portrait/square, force
  // stacked so the text and visual each get a comfortable share of the
  // short side instead of being squished side-by-side.
  const layout: LayoutVariant = headlinePanelOff
    ? 'fullbleed-total'
    : isPortrait
      ? 'stacked'
      : cycledLayout

  // Visual priority for the scene:
  //   1. template → structured JSON, fixed React component (preferred).
  // Visual routing:
  //   1. mockCompiledCode → DynamicScene runs the LLM-written TSX in
  //      a sandboxed Function with React + Remotion + branding bound.
  //      ALL the protective infra (lint, Proxy Icons, runtime fallback,
  //      per-scene rescue) lives upstream so we trust the compiled code
  //      reaching here is either valid or the SafeMockBoundary will
  //      catch a runtime throw and show a clean canvas.
  //   2. screenshot → real product UI with Ken Burns.
  //   3. nothing → ScreenshotFrame with screenshot=null falls back to
  //      a flat bgColor canvas (handled in ScreenshotFrame itself).
  const visualElement = scene.mockCompiledCode ? (
    <DynamicScene mockCompiledCode={scene.mockCompiledCode} branding={branding} />
  ) : (
    <ScreenshotFrame
      screenshot={screenshot}
      branding={branding}
      kbScale={kbScale}
      kbPanX={kbPanX}
      kbPanY={kbPanY}
    />
  )

  const textBlock = (alignment: 'left' | 'right' | 'center') => (
    <TextBlock
      scene={scene}
      branding={branding}
      alignment={alignment}
      headlineY={headlineY}
      headlineOpacity={headlineOpacity}
      shortSide={shortSide}
      canvasWidth={width}
    />
  )

  // Skip the FeatureScene's ambient radial-gradient when a mock is in
  // play. The mock's own AccentGlow already provides the depth — adding
  // a second large gradient on the canvas paints a visible tinted
  // rectangle on one half ("le carré"), breaking the clean white look.
  // Screenshots still get the gradient (it adds nice ambient where the
  // raw screenshot has none).
  // Skip the FeatureScene's ambient radial-gradient when a mock is in
  // play — the LLM-written TSX produces its own visual surface and a
  // second gradient on the canvas just dirties the white space.
  const usingMock = !!scene.mockCompiledCode

  // Expose the project's font as a CSS custom property so Twind's
  // font-sans utility (used by every Tailwind text-* className inside
  // LLM-generated mocks) resolves to it first. Geist remains the
  // webfont fallback if the project didn't set a custom stack.
  const outerStyle: React.CSSProperties = {
    backgroundColor: branding.bgColor,
    overflow: 'hidden',
    ...({ '--brand-font': branding.fontFamily } as Record<string, string>),
  }

  return (
    <AbsoluteFill style={outerStyle}>
      <BrandWatermark branding={branding} position="top-right" size={56} />

      {layout === 'split-left' && (
        <>
          {!usingMock && <AbsoluteFill style={{ background: `radial-gradient(ellipse at 80% 50%, ${branding.accentColor}22 0%, transparent 65%)`, opacity: fadeOut }} />}
          <div style={{ position: 'absolute', left: sidePadding, top: 0, bottom: 0, width: textBlockWidth, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {textBlock('left')}
          </div>
          <div style={{ position: 'absolute', right: sidePadding, top: '50%', width: visualBlockWidth, height: visualBlockHeight, marginTop: -Math.round(visualBlockHeight / 2), opacity: imgOpacity, transform: `translateX(${interpolate(imgIn, [0, 1], [80, 0])}px)` }}>
            {visualElement}
          </div>
        </>
      )}

      {layout === 'split-right' && (
        <>
          {!usingMock && <AbsoluteFill style={{ background: `radial-gradient(ellipse at 20% 50%, ${branding.accentColor}22 0%, transparent 65%)`, opacity: fadeOut }} />}
          <div style={{ position: 'absolute', right: sidePadding, top: 0, bottom: 0, width: textBlockWidth, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {textBlock('right')}
          </div>
          <div style={{ position: 'absolute', left: sidePadding, top: '50%', width: visualBlockWidth, height: visualBlockHeight, marginTop: -Math.round(visualBlockHeight / 2), opacity: imgOpacity, transform: `translateX(${interpolate(imgIn, [0, 1], [-80, 0])}px)` }}>
            {visualElement}
          </div>
        </>
      )}

      {layout === 'stacked' && (
        <>
          {!usingMock && <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 0%, ${branding.accentColor}22 0%, transparent 60%)`, opacity: fadeOut }} />}
          <div style={{ position: 'absolute', top: stackedTopOffset, left: sidePadding, right: sidePadding, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            {textBlock('center')}
          </div>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              bottom: stackedTopOffset,
              width: stackedVisualWidth,
              height: stackedVisualHeight,
              marginLeft: -Math.round(stackedVisualWidth / 2),
              opacity: imgOpacity,
              transform: `translateY(${interpolate(imgIn, [0, 1], [60, 0])}px)`,
            }}
          >
            {visualElement}
          </div>
        </>
      )}

      {layout === 'fullbleed-total' && (
        <AbsoluteFill style={{ opacity: imgOpacity }}>
          {visualElement}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}

interface TextBlockProps {
  scene: Scene
  branding: Branding
  alignment: 'left' | 'right' | 'center'
  headlineY: number
  headlineOpacity: number
  shortSide: number
  canvasWidth: number
}

const TextBlock: React.FC<TextBlockProps> = ({ scene, branding, alignment, headlineY, headlineOpacity, shortSide, canvasWidth }) => {
  // Centered layouts use a slightly smaller headline so a long line wraps
  // nicely inside the canvas instead of bleeding off the sides.
  const headlineSize = Math.round(shortSide * (alignment === 'center' ? 0.078 : 0.085))
  const subheadSize = Math.round(shortSide * 0.028)
  const eyebrowSize = Math.round(shortSide * 0.02)
  const subheadMaxWidth = Math.round(canvasWidth * (alignment === 'center' ? 0.57 : 0.354))
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: alignment === 'right' ? 'flex-end' : alignment === 'center' ? 'center' : 'flex-start',
        gap: Math.round(shortSide * 0.019),
        opacity: headlineOpacity,
        transform: `translateY(${headlineY}px)`,
        textAlign: alignment,
        width: '100%',
      }}
    >
      <div
        style={{
          padding: '6px 14px',
          borderRadius: 999,
          background: `${branding.accentColor}25`,
          color: branding.accentColor,
          fontFamily: `${branding.fontFamily}, 'Geist', system-ui, sans-serif`,
          fontSize: eyebrowSize,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {branding.productName}
      </div>
      <h2
        style={{
          color: branding.textColor,
          fontFamily: `${branding.fontFamily}, 'Geist', system-ui, sans-serif`,
          fontSize: headlineSize,
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          margin: 0,
        }}
      >
        {scene.headline}
      </h2>
      {scene.subhead && (
        <p
          style={{
            color: `${branding.textColor}B0`,
            fontFamily: `${branding.fontFamily}, 'Geist', system-ui, sans-serif`,
            fontSize: subheadSize,
            fontWeight: 400,
            lineHeight: 1.35,
            letterSpacing: '-0.005em',
            margin: 0,
            maxWidth: subheadMaxWidth,
          }}
        >
          {scene.subhead}
        </p>
      )}
    </div>
  )
}

interface ScreenshotFrameProps {
  screenshot: Screenshot | null
  branding: Branding
  kbScale: number
  kbPanX: number
  kbPanY: number
}

const ScreenshotFrame: React.FC<ScreenshotFrameProps> = ({ screenshot, branding, kbScale, kbPanX, kbPanY }) => {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: -20,
          borderRadius: 28,
          background: `linear-gradient(135deg, ${branding.accentColor}66, transparent)`,
          filter: 'blur(40px)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 18,
          overflow: 'hidden',
          border: `1px solid ${branding.textColor}22`,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          background: `${branding.textColor}08`,
        }}
      >
        {screenshot ? (
          <Img
            src={screenshot.url}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `scale(${kbScale}) translate(${kbPanX}px, ${kbPanY}px)`,
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
          />
        ) : (
          // No screenshot AND no mock — this is the silent-failure state
          // (mocks-mode scene whose mockCode was missing or both rescue
          // attempts failed). Render just the canvas bgColor so the
          // empty visual slot blends with the rest of the video instead
          // of flashing a colored gradient that looks like a glitch.
          <AbsoluteFill style={{ background: branding.bgColor }} />
        )}
      </div>
    </>
  )
}
