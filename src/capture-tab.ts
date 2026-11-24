/**
 * The capture layer — the eyes.
 *
 * A drawer tab (free, host DOM — never a sandbox frame, which would carry
 * `display-capture 'none'`) with Start / Look / Stop for the screen, a webcam
 * snap, the phone's camera via a file input, and any picture from disk; plus
 * a "Look" action in the chat input bar. Every path ends in the same place:
 * the main canvas → JPEG, downscaled before anything leaves the browser,
 * sent to the backend as base64 inside an ordinary frontend message.
 *
 * Continuous mode ticks from a Web Worker (D-018) so a tab hidden behind a
 * fullscreen game keeps its cadence (confirmed on real hardware: 233 ticks
 * behind a fullscreen game).
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import {
  DEFAULT_CAPTURE_SETTINGS,
  GATE_EDGE,
  TICK_WORKER_SOURCE,
  base64ByteLength,
  classifyTrackLabel,
  titleCandidate,
  type WatchingState,
  dataUrlToBase64,
  describeSupport,
  isMobileUserAgent,
  EYE_ICON,
  HOUSELIGHTS_ICON,
  fitWithin,
  formatBytes,
  frameChanged,
  toGrey,
  type CapturePayload,
  type CaptureReceipt,
  type CaptureSettings,
  type CaptureSource,
  type CaptureTrigger,
  type CaptureEnvironment,
  type ChatState,
  type Stance,
  STANCES,
  type EngineSnapshot,
  type ConnectionInfo,
  type ReactionModelSettings,
  type ReactionResult,
} from './capture.ts'
import type { BoxLine, CompanionFrame, LookupStatus, ReactionProgress, RemoteLookRequest, RemoteLookResult } from './capture.ts'
import { DEFAULT_STANCE, progressText, stopWarningMs } from './capture.ts'
import { DEFAULT_CUSTOM_INSTRUCTION } from './prompt.ts'
import manifest from '../spindle.json'
import { createMediaKeyLook } from './mediakey.ts'
// D-087: the tab's Hush help is its own words; the widget's button keeps HUSH_TITLE until its PR.
import { GUIDE_MARKDOWN, GUIDE_TITLE } from './guide.ts'
import { icon, type IconName } from './icons.ts'

/** D-089 (D5): the tab's card icons. None repeats in the tab or in the full settings. */
const TAB_ICONS: Record<string, IconName> = { session: 'monitor-play', who: 'users', watching: 'eye', during: 'clapperboard' }
const HUSH_HELP = 'They keep watching. They just can\'t talk about it.'
import { button, captionHelp, confirmDanger, createUiKit, el, helpRow, helpTip, note, statusClass, statusLines, type HelpContent } from './ui.ts'
import type { Voice } from './voice.ts'
import type { ComposerBridge } from './composer.ts'

/** An open eye. 20×20 in the sidebar, 16px in the input bar. */

export const TAB_STYLES = `
  /* D-054: a Box Seat viewer's block — their name, then their options indented under a rule. */
  /* D-054, D-089: a Box Seat viewer is a caption (their name) with their rows under it. */
  .hl-viewer { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
  .hl-viewer-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .hl-viewer-tag { font-weight: 600; font-size: var(--hl-fs-caption); padding: 1px 7px; border-radius: 999px; text-transform: none;
                   letter-spacing: 0; color: var(--lumiverse-text-muted, inherit); background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.15));
                   border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3)); }
  .hl-fold > summary { list-style: none; cursor: pointer; display: flex; flex-direction: row; align-items: center;
                       justify-content: space-between; gap: 8px; width: 100%; min-height: 28px; box-sizing: border-box; text-align: left; }
  .hl-fold-head { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .hl-fold > summary > span:first-child { text-align: left; }
  .hl-fold-title { font-size: var(--hl-fs-title); font-weight: 600; color: var(--lumiverse-text, inherit); }
  .hl-seg { display: flex; border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.35)); border-radius: 10px; overflow: hidden; margin: 8px 0; }
  .hl-seg-btn { flex: 1 1 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 9px 12px; cursor: pointer;
                background: transparent; color: var(--lumiverse-text, inherit); border: 0; font: inherit; text-align: left; }
  .hl-seg-btn + .hl-seg-btn { border-left: 1px solid var(--lumiverse-border, rgba(128,128,128,0.35)); }
  .hl-seg-btn:hover:not(.hl-seg-on) { background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.08)); }
  .hl-seg-btn:focus-visible { outline: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); outline-offset: -2px; }
  .hl-seg-on { background: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); }
  .hl-seg-title { font-weight: 600; }
  .hl-seg-sub { font-size: var(--hl-fs-help); opacity: 0.85; }
  .hl-eyes-part { margin: 8px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .hl-token-hint { display: flex; flex-direction: column; gap: 4px; }
  .hl-fold-body { display: flex; flex-direction: column; gap: 8px; }
  .hl-fold > summary::-webkit-details-marker { display: none; }
  .hl-fold > summary:focus-visible { outline: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); outline-offset: 2px; border-radius: 4px; }
  .hl-fold-chevron { display: inline-flex; width: 16px; height: 16px; flex: none; color: var(--lumiverse-text-muted, currentColor);
                     transition: transform var(--lumiverse-transition-fast, 120ms); }
  .hl-fold[open] > summary .hl-fold-chevron { transform: rotate(90deg); }
  .hl-fold[open] > summary { margin-bottom: 6px; }
  .hl-watch-input { flex: 1; min-width: 120px; }
  .hl-thumb { max-width: 100%; border-radius: 6px; display: block;
              border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.25)); }
  .hl-thumb-empty { height: 90px; border-radius: 6px; display: flex; align-items: center;
                    justify-content: center; opacity: 0.6; font-size: var(--hl-fs-help);
                    border: 1px dashed var(--lumiverse-border, rgba(128,128,128,0.35)); }
  .hl-counters { font-size: var(--hl-fs-help); opacity: 0.8; line-height: 1.6; }
  .hl-preview { max-width: 100%; border-radius: 6px; display: block; background: #000;
                border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.25)); }
  .hl-hidden-input { display: none; }
`


interface Session {
  stream: MediaStream
  video: HTMLVideoElement
  startedAt: number
  autoStopAt: number
  autoStopTimer: ReturnType<typeof setTimeout> | null
  /** D-099: the length of the current auto-stop window (the setting when it started or was last extended). */
  windowMs: number
}

type Ticker =
  | { kind: 'worker'; worker: Worker; url: string; intervalMs: number }
  | { kind: 'main'; timer: ReturnType<typeof setInterval>; intervalMs: number }

interface Frame {
  jpegB64: string
  thumbB64: string
  thumbDataUrl: string
  width: number
  height: number
  gate: Uint8Array
}

/** What Houselights asks for, and what stops working without each. */
const CANVAS_MISSING = 'This browser cannot draw the picture Houselights needs. Try a current Chrome, Edge, Firefox or Safari.'

const PERMISSIONS: { name: string; without: string; optional?: boolean }[] = [
  { name: 'generation', without: 'Houselights cannot describe a picture or write a reaction.' },
  { name: 'chats', without: 'Houselights cannot tell which chat you are in.' },
  { name: 'chat_mutation', without: 'reactions cannot be put into the chat.' },
  { name: 'characters', without: "Houselights cannot read character names or a Box Seat's cards." },
  { name: 'ui_panels', without: 'the widget cannot be shown.' },
  { name: 'media', without: 'the speaker and the mic stay hidden. Everything else works.', optional: true },
  { name: 'web_search', without: 'Look things up stays off. Everything else works.', optional: true },
]

/** A fold's heading, as Lumiverse draws its own: the title on the left, a chevron on the right that points right when closed and down when open. */
/** D-082: a hint, one line per point, with Houselights' own tokens in bold ({{user}} and other host macros stay plain). */
export function tokenHint(lines: string[]): HTMLElement {
  const box = el('div', { className: 'hl-token-hint' })
  for (const line of lines) {
    const p = el('p', { className: 'hl-sub' })
    for (const part of line.split(/(\{\{(?:scene|hushed|ifhushed|\/ifhushed)\}\})/)) {
      if (!part) continue
      p.appendChild(/^\{\{\/?(?:scene|hushed|ifhushed)\}\}$/.test(part) ? el('strong', { textContent: part }) : document.createTextNode(part))
    }
    box.appendChild(p)
  }
  return box
}

/** A note whose first words are bold ("Potential spoilers: …"). */
function leadNote(lead: string, rest: string): HTMLElement {
  return el('p', { className: 'hl-sub' }, [el('strong', { textContent: lead }), document.createTextNode(` ${rest}`)])
}

/** D-087: the Stance `[?]`: every stance, one line each, and the Coach's advice (D-080) while it is chosen. */
function stanceHelp(chosen?: Stance): HTMLElement[] {
  const lines: HTMLElement[] = STANCES.map((s) => el('p', {}, [el('strong', { textContent: `${s.label}:` }), document.createTextNode(` ${s.blurb.charAt(0).toLowerCase()}${s.blurb.slice(1)}`)]))
  if (chosen === 'coach') {
    lines.push(leadNote('Recommended usage:', 'Coach works best in solo chats with Look things up on, On demand chosen, and Next-track key = Look on.'))
  }
  return lines
}

export function foldSummary(text: string, className: string, help?: HTMLElement, iconName?: IconName): HTMLElement {
  const summary = el('summary', { className })
  const title = el('span', { textContent: text })
  // D-089 (D5): a card's line icon sits before its title.
  const head: HTMLElement[] = iconName ? [icon(iconName), title] : [title]
  if (help) head.push(help)
  summary.appendChild(el('span', { className: 'hl-fold-head' }, head))
  const chevron = el('span', { className: 'hl-fold-chevron' })
  chevron.setAttribute('aria-hidden', 'true')
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
  summary.appendChild(chevron)
  return summary
}

/** A saved percentage, or the default when it is missing or nonsense. */
export function clampPct(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** A reaction that has said nothing for this long is treated as lost: Look works again. */
export const AWAIT_SILENCE_MS = 150_000
/** D-100: how long after its session ends a window still takes the curtain call as its own. */
export const CURTAIN_WINDOW_MS = 300_000

export interface CaptureTabDeps {
  ctx: SpindleFrontendContext
  /** Open the widget's pop-out window. Called inside the Start click, while the gesture is live. */
  popOut?(): void
  /** Show a portrait size or opacity on the widget while its slider is dragged, before it is saved. Null: back to the saved values. */
  previewPortrait?(preview: { sizePct?: number; opacityPct?: number; textPct?: number } | null): void
  /** Voice (D16): for the tick hold and the tab's Voice section. */
  voice?: Voice
  /** Voice (D16), box fallback: a TTS connection per viewer. */
  boxVoice?: { get(viewerId: string): string; set(viewerId: string, connectionId: string): void }
  /** Null until the backend has sent its first state. */
  getSettings(): (CaptureSettings & ReactionModelSettings) | null
  patch(changes: Partial<CaptureSettings & ReactionModelSettings>): void
  /** The user's connection profiles, for the pickers. */
  getConnections(): ConnectionInfo[]
  /** Human name of the connection a frame is sent to, for the "Sent to" label. */
  getConnectionName(connectionId: string | null): string
  /** H1: the hush, for the tab's Hush button (the frontend owns it). */
  hush?: { state(): { hushed: boolean; source: string | null; remainingMs: number }; set(on: boolean): void }
  /** The speaker switch, for the tab's "Speak reactions aloud" (the frontend also stops speech when it goes off). */
  setVoiceOut?(on: boolean): void
  /** D19: Lumiverse's chat box, for the input bar's Send + look. */
  composer?: ComposerBridge
  /** D-095: open a chat by id; null when the host can't. */
  openChat?: ((chatId: string) => void) | null
  /** D-096: bring the phone toolbar's one-time hint back. */
  showTips?(): void
}

/** Settings-pass Part 2: the pieces the tab builds that live on the full settings page. */
export type BackPanelId = 'capture' | 'device' | 'webSearch' | 'voiceCheck' | 'troubleshooting'

export interface CaptureTab {
  /** Take one capture now. Starts a session first if there isn't one. */
  look(trigger: CaptureTrigger): Promise<void>
  /**
   * A Look button was pressed (the tab's, the widget's, the input bar's): as
   * look('look'), and when it starts a session with Pop out on start ticked,
   * the widget pops out too. Call it inside the click. With `talk`, the line goes with
   * the fresh look (D14).
   */
  pressLook(talk?: string): void
  /** A share session is running in this window. */
  isLive(): boolean
  /** D-100: this window's session ended a moment ago; the curtain call is its to read aloud. */
  justEnded(): boolean
  /** D-055: this is a phone or tablet. */
  isPhone(): boolean
  /** Part 2: a block the full settings page shows (the tab keeps it up to date). */
  backPanel(id: BackPanelId): HTMLElement
  /** H1: the hush changed; redraw the tab's Hush button. */
  onHush(): void
  /** D-063: this phone follows the computer (desktop companion is on). */
  isCompanion(): boolean
  /** D-063: ask the computer's sharing window for a Look, optionally sending a line with it. */
  remoteLook(talk?: string): void
  /** D-063: a frame arrived from some window; a companion phone shows it. */
  onCompanionFrame(frame: CompanionFrame): void
  /** D-063: a reaction was written for some window; a companion phone shows it (never speaks it). */
  onCompanionReaction(result: ReactionResult): void
  /** D-063: (the sharing window) a phone asked for a Look. */
  onRemoteLookRequest(request: RemoteLookRequest): void
  /** D-063: (the phone) whether the computer could look. */
  onRemoteLookResult(result: RemoteLookResult): void
  /** D-096: the computer started or stopped sharing; a phone drops a stale "not sharing". D-099: and learns when it stops itself. */
  onCompanionSession(live: boolean, stop?: { stopsInMs: number; windowMs: number } | null): void
  /** D-099: (the sharing window) a companion phone asked for more time. */
  onRemoteExtendRequest(): void
  /** D-055: as the Take a photo button (the camera app on a phone). Call it inside the click. */
  takePhoto(): void
  /** D-055: as the Choose a picture button. Call it inside the click. */
  choosePicture(): void
  /** The backend's progress through the reaction in flight. */
  onProgress(progress: ReactionProgress): void
  /** D16: redraw the Voice section (after the media permission check answers, or a grant). */
  refreshVoice(): void
  /** Talk-back (D14): say something to the character. `withLook` captures a fresh frame to go with it. */
  talk(text: string, withLook: boolean): Promise<void>
  /** End the session, as the Stop button does. */
  stop(): void
  /** Push back the auto-stop, as the Extend button does. */
  extend(): void
  /** The engine's state for other surfaces (the Pane). Pushed on every change. */
  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void
  snapshot(): EngineSnapshot
  onReceipt(receipt: CaptureReceipt): void
  /** A reaction landed. True when this window asked for it (D-060: only that window speaks it). */
  onReaction(result: ReactionResult): boolean
  onChatState(state: ChatState): void
  /** D15: the Watching chip's state from the backend. */
  onWatching(state: WatchingState): void
  /** D18: whether looking things up can work here. */
  onLookupStatus(status: LookupStatus): void
  /** D15: confirm a name (the candidate's, or typed). Empty clears what's confirmed. */
  confirmWatching(text: string): void
  dismissWatching(): void
  /** D17: the watched chat's stance; `custom` replaces the Custom text when given. */
  setStance(stance: Stance, custom?: string): void
  /** Call whenever settings arrive or change. */
  onSettings(): void
  destroy(): void
}

export function createCaptureTab(deps: CaptureTabDeps): CaptureTab {
  const { ctx } = deps
  const removeStyle = ctx.dom.addStyle(TAB_STYLES)
  const kit = createUiKit(ctx)
  const staticScope = kit.scope()
  const settingsScope = kit.scope()
  const chatScope = kit.scope()
  const quickScope = kit.scope()
  const deviceScope = kit.scope()
  const webScope = kit.scope()

  // --- what this browser can do --------------------------------------------

  const env = detectEnvironment(ctx)
  const support = describeSupport(env)
  /** D-055: a phone or tablet — Other eyes first, screen-only controls hidden, the widget off unless asked. */
  const phone = env.isMobile === true
  const stoppedOrphan = stopOrphanedCapture()

  // --- state ------------------------------------------------------------------

  let session: Session | null = null
  let ticker: Ticker | null = null
  let previousGate: Uint8Array | null = null
  let busy = false
  let status: { text: string; kind: 'info' | 'ok' | 'err' } = stoppedOrphan
    ? { text: 'Stopped a session left over from before Houselights reloaded.', kind: 'info' }
    : { text: '', kind: 'info' }
  let lastThumbDataUrl: string | null = null
  let lastReceipt: CaptureReceipt | null = null
  let lastSentAt = 0
  let lastRoundTripMs: number | null = null
  let chat: ChatState = { type: 'chat_state', chat: null, enabled: false }
  let watchingState: WatchingState = { confirmed: null, candidate: null }
  const watchScope = kit.scope()
  let lastReaction: ReactionResult | null = null
  let awaitingReaction = false
  /** D-100: when this window's session last ended, so it knows the curtain call is its to read aloud. */
  let sessionEndedAt = 0
  // While awaiting: what the backend says it is doing, the Box Seat lines that
  // have already landed, and when it last said anything. A reply that never
  // comes (backend reloaded mid-reaction) stops counting after a long silence.
  let working: string | null = null
  let partialLines: BoxLine[] = []
  let lastProgressAt = 0
  const isAwaiting = () => awaitingReaction && Date.now() - lastProgressAt < AWAIT_SILENCE_MS

  // --- D-063: desktop companion (a phone following the computer) ---------------------
  /** When the computer's frame reached this phone and its reaction hasn't yet; 0 = not waiting. */
  let companionSince = 0
  let remoteLookTimer: ReturnType<typeof setTimeout> | null = null
  /** D-099: when the computer's session stops itself (this device's clock), and its window; null when not known. */
  let remoteStop: { at: number; windowMs: number } | null = null
  /** This phone asked the computer to look, and no frame has come back yet. */
  let remoteAsked = false
  /** How long a phone waits for the computer to answer a remote Look before saying so. */
  const REMOTE_LOOK_WAIT_MS = 10_000
  function companionOn(): boolean {
    return phone && deps.getSettings()?.companionPhone === true
  }
  function companionWaiting(): boolean {
    return companionSince > 0 && Date.now() - companionSince < AWAIT_SILENCE_MS
  }
  function clearRemoteLookTimer(): void {
    if (remoteLookTimer !== null) clearTimeout(remoteLookTimer)
    remoteLookTimer = null
  }
  function remoteLookFor(talk?: string): void {
    if (!companionOn() || isAwaiting() || companionWaiting()) return
    clearRemoteLookTimer()
    remoteAsked = true
    companionSince = Date.now()
    status = { text: talk ? 'Asked your computer to look and send your line…' : 'Asked your computer to look…', kind: 'info' }
    ctx.sendToBackend({ type: 'remote_look', ...(talk ? { talk } : {}) })
    // No frame within a few seconds: say so, rather than leave the phone looking busy.
    remoteLookTimer = setTimeout(() => {
      remoteLookTimer = null
      if (!remoteAsked) return
      remoteAsked = false
      companionSince = 0
      status = { text: 'Your computer did not answer. Is a session still running there, in this Lumiverse?', kind: 'err' }
      refresh()
    }, REMOTE_LOOK_WAIT_MS)
    refresh()
  }
  const counters = { ticks: 0, sent: 0, skipped: 0, received: 0, failed: 0, reactions: 0 }
  const listeners = new Set<(snapshot: EngineSnapshot) => void>()
  let webcam: { stream: MediaStream; video: HTMLVideoElement } | null = null

  const settings = (): CaptureSettings => deps.getSettings() ?? DEFAULT_CAPTURE_SETTINGS

  // --- canvases, created once --------------------------------------------------

  const mainCanvas = document.createElement('canvas')
  const thumbCanvas = document.createElement('canvas')
  const gateCanvas = document.createElement('canvas')
  gateCanvas.width = GATE_EDGE
  gateCanvas.height = GATE_EDGE
  const mainCtx = mainCanvas.getContext('2d')
  const thumbCtx = thumbCanvas.getContext('2d')
  const gateCtx = gateCanvas.getContext('2d', { willReadFrequently: true })

  // --- the tab ------------------------------------------------------------------

  const tab = ctx.ui.registerDrawerTab({
    id: 'houselights',
    title: 'Houselights',
    shortName: 'Houselights',
    description: 'Let your character see your screen',
    keywords: ['screen', 'capture', 'look', 'eyes', 'share'],
    headerTitle: 'Houselights',
    iconSvg: HOUSELIGHTS_ICON,
    // D-087 (D2): Lumiverse's own help button on the tab's header opens the guide.
    guide: { markdown: GUIDE_MARKDOWN, title: GUIDE_TITLE },
  })

  const panel = el('div', { className: 'hl-tab' })
  tab.root.appendChild(panel)

  // Static pieces are built once; the dynamic ones are updated in place.
  const stateBadge = staticScope.badge('Idle', 'neutral')
  // D-079: the widget on or off, from the header — this device's switch (the phone's on a phone).
  const widgetToggle = button('Hide widget', () => {
    const on = paneShownHere()
    deps.patch(phone ? { showPaneMobile: !on } : { showPane: !on })
    queueMicrotask(() => renderSettings())
  })
  widgetToggle.classList.add('hl-btn-small')
  const extendBtn = el('button', { className: 'hl-btn', textContent: 'Extend' })
  extendBtn.type = 'button'
  // D-086: two lines each, so the next "Sent." cannot erase a failure.
  const sessionLines = statusLines()
  /** The failure on the session's line, so a redraw does not show a dismissed one again. */
  let failedStatus: { text: string; kind: 'info' | 'ok' | 'err' } | null = null
  const startBtn = el('button', { className: 'hl-btn hl-btn-primary', textContent: 'Start session' })
  const lookBtn = el('button', { className: 'hl-btn hl-btn-primary', textContent: 'Look' })
  const stopBtn = el('button', { className: 'hl-btn', textContent: 'Stop' })
  const testBtn = el('button', { className: 'hl-btn', textContent: 'Send a test picture' })
  const thumbWrap = el('div')
  const receiptBox = el('div', { className: 'hl-status', textContent: '' })
  // D-088 (D7): the Session card keeps the time; the diagnostics live in Troubleshooting, Session details.
  const sessionClock = el('div', { className: 'hl-counters' })
  const countersBox = el('div', { className: 'hl-counters' })
  // The session's one front option (Mode), under the buttons.
  const modeSlot = el('div')
  // Part 2: "Hush" and "Speak reactions aloud", the two switches flipped mid-session.
  const quickGroup = el('div', { className: 'hl-fold-body' })
  const tabHushBtn = el('button', { className: 'hl-btn', textContent: 'Hush' })
  // Beside Stop since 0.1.10 (asked for after 0.1.9): the one switch flipped mid-game, in reach.
  const tabHushTip = helpTip('Hush', HUSH_HELP)
  /** The quiet after you speak is a status, not help: it stays in view under the Hush button. */
  const hushQuiet = note('Quiet for a moment after you spoke. Hush keeps them quiet for longer.')
  hushQuiet.hidden = true
  // Part 2: blocks built here, shown on the full settings page.
  const back: Record<BackPanelId, HTMLElement> = {
    capture: el('div'),
    device: el('div'),
    webSearch: el('div'),
    voiceCheck: el('div'),
    troubleshooting: el('div'),
  }
  // Look things up sits under Watching: each chat's own switch, for every stance (D18″).
  const lookupBox = el('div')
  // D18: what the backend last said about web search (granted, set up, the last search).
  let lookupStatus: LookupStatus | null = null
  let lookupAsked = false
  // The widget's looks, folded closed under During the show.
  const appearance = el('details', { className: 'hl-field hl-fold' }) as HTMLDetailsElement
  const permissionLine = el('div', { className: 'hl-status' })
  permissionLine.hidden = true
  const settingsGroup = back.capture // Capture tuning lives on the settings page now.
  const chatGroup = el('div', { className: 'hl-fold-body' })
  const watchGroup = el('div', { className: 'hl-fold-body' })
  const widgetGroup = el('div', { className: 'hl-fold-body' })
  // The tab's folds, by id (filled by `section` / `registerFold`).
  const folds = new Map<string, { el: HTMLDetailsElement; open: boolean }>()
  const reactionLines = statusLines()
  let failedReaction: ReactionResult | null = null
  const sentToNote = note('')

  // Other eyes: webcam, phone camera, any picture.
  const webcamBtn = el('button', { className: 'hl-btn', textContent: 'Open webcam' })
  const snapBtn = el('button', { className: 'hl-btn hl-btn-primary', textContent: 'Snap' })
  const webcamCancelBtn = el('button', { className: 'hl-btn', textContent: 'Close webcam' })
  const webcamPreview = el('div')
  const photoBtn = el('button', { className: 'hl-btn', textContent: 'Take a photo' })
  const pictureBtn = el('button', { className: 'hl-btn', textContent: 'Choose a picture' })
  const otherLines = statusLines()
  // Created with createElement and appended to the tab root, so the `capture`
  // attribute survives (Phase 0 v2, S5). `capture` makes a phone open its camera
  // app instead of a file picker; desktops ignore it.
  const cameraInput = el('input', { type: 'file', className: 'hl-hidden-input' })
  cameraInput.accept = 'image/*'
  cameraInput.setAttribute('capture', 'environment')
  const pictureInput = el('input', { type: 'file', className: 'hl-hidden-input' })
  pictureInput.accept = 'image/*'

  // --- the input-bar action ---------------------------------------------------

  const lookAction = ctx.ui.registerInputBarAction({
    id: 'houselights-look',
    label: 'Look',
    subtitle: 'Show your character the screen',
    iconSvg: EYE_ICON,
    enabled: support.screen,
  })
  // D19: with a line typed in Lumiverse's chat box, the input bar's Look is Send + look: the draft
  // goes with a fresh look through talk-back (D14), and leaves the box only once it has landed.
  // Only when the chat box is the watched chat's: a pinned chat elsewhere gets a plain Look.
  function draftToSend(): { chatId: string; text: string } | null {
    const draft = deps.composer?.current()
    return draft && draft.text && chat.chat && draft.chatId === chat.chat.id ? draft : null
  }
  /**
   * The input bar's Look, in one place: its words, and whether it shows at all (the host hides a
   * disabled action). On a phone or tablet it shows while following the computer (D-095), and asks
   * the computer to look.
   */
  let lookActionShown = ''
  function renderLookAction(): void {
    const sends = draftToSend() !== null
    const reacting = !!chat.chat && chat.enabled
    const remote = companionOn()
    const enabled = remote
      ? reacting && !isAwaiting() && !companionWaiting()
      : !phone && support.screen && !busy && reacting && !isAwaiting() // the tab offers no screen sharing on a phone either
    const label = sends ? 'Send + look' : 'Look'
    const subtitle = remote
      ? sends ? 'Ask your computer to look, and send what you typed' : 'Ask your computer to look'
      : sends ? 'Show your character the screen and send what you typed'
        : session ? 'Session live: send one picture now' : 'Show your character the screen'
    const shown = `${enabled}|${label}|${subtitle}`
    if (shown === lookActionShown) return
    lookActionShown = shown
    try {
      lookAction.setEnabled(enabled)
      lookAction.setLabel(label)
      lookAction.setSubtitle(subtitle)
    } catch {
      // an older host without setLabel: the action still works, it just keeps its first words
    }
  }
  const unsubComposer = deps.composer?.onChange(renderLookAction) ?? (() => {})
  const unsubLookClick = lookAction.onClick(() => {
    const draft = draftToSend()
    if (draft) deps.composer?.sent(draft.chatId, draft.text)
    // D-095: a phone following the computer has no screen; the computer takes the look.
    if (companionOn()) remoteLookFor(draft?.text)
    else pressLook(draft?.text)
  })

  // A once-a-second refresh for the elapsed clock while live. Main-thread,
  // deliberately: it only paints, and being throttled while hidden is fine.
  const clock = setInterval(() => {
    // A companion phone's wait can run out by the clock alone (a Look that drew no reaction):
    // settle it, so its buttons and the input bar's Look come back.
    if (companionSince > 0 && !companionWaiting()) companionSince = 0
    if (session) mediaKey.keepAlive() // D-100
    if (session || awaitingReaction || companionSince > 0 || lookActionShown.startsWith('false') && companionOn()) refresh()
    if (deps.hush?.state().hushed) renderHushButton()
  }, 1000)

  // The page going away must end the share, whatever else happens.
  const onPageHide = () => stopEverything('pagehide')
  window.addEventListener('pagehide', onPageHide)

  webcamBtn.addEventListener('click', () => void openWebcam())
  snapBtn.addEventListener('click', () => void snapWebcam())
  webcamCancelBtn.addEventListener('click', () => closeWebcam())
  photoBtn.addEventListener('click', () => cameraInput.click())
  pictureBtn.addEventListener('click', () => void choosePicture())
  cameraInput.addEventListener('change', () => {
    const file = cameraInput.files?.[0]
    cameraInput.value = ''
    if (file) void sendImageBlob(file, 'camera')
  })
  pictureInput.addEventListener('change', () => {
    const file = pictureInput.files?.[0]
    pictureInput.value = ''
    if (file) void sendImageBlob(file, 'file')
  })
  // "Pop out on start": the Pane's window opens with the session. Both calls
  // are made inside the click, before anything is awaited, so each still has
  // the user's gesture; the share picker goes first because it matters more.
  const popOutWanted = () =>
    deps.getSettings()?.showPane !== false && deps.getSettings()?.popoutOnStart === true && env.hasDocumentPictureInPicture && !!deps.popOut
  startBtn.addEventListener('click', () => {
    const starting = session === null
    void startSession('button')
    if (starting && popOutWanted()) deps.popOut?.()
  })
  lookBtn.addEventListener('click', () => pressLook())
  function pressLook(talk?: string): void {
    const starting = session === null && deps.getSettings()?.captureMode !== 'paranoid' && !isAwaiting()
    void look(talk ? 'talk' : 'look', talk)
    if (starting && popOutWanted()) deps.popOut?.()
  }
  stopBtn.addEventListener('click', () => stopSession('button'))
  extendBtn.addEventListener('click', () => extendSession())
  testBtn.addEventListener('click', () => void sendSyntheticFrame())

  // --- Voice (D16) / spike V1 ---------------------------------------------------
  const voiceStatus = el('div', { className: 'hl-status' })
  const voiceProviders = el('div', { className: 'hl-status' })
  const voiceAllowBtn = el('button', { className: 'hl-btn', textContent: 'Allow voice' })
  const voiceTestBtn = el('button', { className: 'hl-btn', textContent: 'Say a test line' })
  const voiceResult = el('div', { className: 'hl-status' })
  voiceResult.hidden = true
  let ttsConnections: { id: string; name: string }[] | null = null
  function setVoiceResult(text: string, kind: 'info' | 'ok' | 'err'): void {
    voiceResult.className = statusClass(kind)
    voiceResult.textContent = text
    voiceResult.hidden = false
  }
  function renderVoice(): void {
    const v = deps.voice
    if (!v) {
      // D-088: cannot happen in a real build (VOI-040), so it says nothing.
      voiceStatus.hidden = true
      voiceProviders.hidden = true
      voiceAllowBtn.hidden = true
      voiceTestBtn.hidden = true
      return
    }
    const a = v.availability()
    const caps = (ctx.host?.capabilities ?? {}) as Record<string, number | undefined>
    // D-088: plain words; the reasons and the advice are said once, above, on the Voice card.
    const bits = [
      `Speaking: ${a.tts ? 'available' : 'not available'}`,
      `Listening: ${a.stt ? 'available' : 'not available'}`,
      `Media permission: ${a.media === null ? 'checking…' : a.media ? 'granted' : 'not granted'}`,
    ]
    voiceStatus.hidden = false
    voiceStatus.className = statusClass('info')
    voiceStatus.textContent = bits.join(' · ')
    voiceAllowBtn.hidden = a.media !== false || (!a.tts && !a.stt)
    voiceTestBtn.hidden = !(a.tts && a.media === true)
    // D-088 (VOI-037): the recognisers are listed once, on the Voice card, in plain names.
    voiceProviders.hidden = true
    if (a.tts && a.media === true && ttsConnections === null && Number(caps['connection-kinds-v1'] ?? 0) >= 1 && ctx.connections) {
      ttsConnections = []
      void ctx.connections
        .list({ kind: 'tts' })
        .then((list) => {
          ttsConnections = list.map((c) => ({ id: c.id, name: `${c.name}${c.voice ? ` — ${c.voice}` : ''}` }))
          renderChat()
        })
        .catch(() => {
          ttsConnections = []
        })
    }
  }
  voiceAllowBtn.addEventListener('click', () => {
    const v = deps.voice
    if (!v) return
    voiceAllowBtn.disabled = true
    void v
      .requestMedia()
      .then((granted) => {
        setVoiceResult(granted ? 'Granted. The speaker and the mic are on the widget now.' : 'Not granted. You can grant it later in Lumiverse\'s Extensions panel.', granted ? 'ok' : 'info')
      })
      .finally(() => {
        voiceAllowBtn.disabled = false
        renderVoice()
        refresh()
      })
  })
  voiceTestBtn.addEventListener('click', () => {
    const v = deps.voice
    if (!v) return
    setVoiceResult('Speaking…', 'info')
    void v
      .speakText('Houselights can speak. This is the default voice of your text-to-speech connection.')
      .then(() => setVoiceResult('Spoke the test line in your default TTS voice, the one reactions use.', 'ok'))
      .catch((err: unknown) => setVoiceResult(`Could not speak: ${err instanceof Error ? err.message : String(err)}`, 'err'))
  })

  // --- Media-key Look (spike H1 → D-046) ----------------------------------------
  // Chrome sends media keys only to a tab that is playing something, so while a
  // session runs Houselights plays a silent loop and claims next-track. The
  // loop needs a click to start: it is armed at the top of startSession, which
  // every click path reaches before anything is awaited. Outside a session the
  // key is the user's other players' again.
  const mediaKey = createMediaKeyLook({
    onPress: () => {
      // D-100: a press always says what it did, on the status line and in the server log. It used
      // to do nothing at all, silently, while a reaction was still being written.
      const outcome = !session ? 'no-session' : busy || isAwaiting() ? 'busy' : 'looked'
      if (outcome === 'looked') void look('look')
      else {
        status = {
          text: outcome === 'busy' ? `Next-track key: still on the last Look. ${working ?? 'Waiting for the reaction…'}` : 'Next-track key: no session is running, so there is nothing to look at.',
          kind: 'info',
        }
        refresh()
      }
      ctx.sendToBackend({ type: 'media_key', outcome, hidden: document.visibilityState === 'hidden' })
      return outcome
    },
    onChange: () => refresh(),
  })
  const mediaKeyWanted = () => deps.getSettings()?.mediaKeyLook === true && mediaKey.state().supported
  function armMediaKey(): void {
    if (!mediaKeyWanted()) return
    mediaKey.setEnabled(true)
    void mediaKey.setHold(true)
  }
  function disarmMediaKey(): void {
    mediaKey.setEnabled(false)
    void mediaKey.setHold(false)
  }


  buildStaticLayout()
  renderSettings()
  renderChat()
  refresh()

  // --- folds ---------------------------------------------------------------------
  // Every section but the session block folds. Each remembers being opened or
  // closed in the settings (so it follows the user across reloads and
  // browsers); a fresh install opens them all except the Test area.
  function foldOpen(id: string): boolean {
    const s = deps.getSettings()
    const saved = s?.folds?.[id]
    if (typeof saved === 'boolean') return saved
    if (id === 'models' && s?.modelsOpen === false) return false // before folds were saved together
    return folds.get(id)?.open ?? true
  }
  function applyFold(id: string): void {
    const f = folds.get(id)
    if (f) f.el.open = foldOpen(id)
  }
  function registerFold(id: string, d: HTMLDetailsElement, defaultOpen: boolean): void {
    folds.set(id, { el: d, open: defaultOpen })
    d.open = foldOpen(id)
    d.addEventListener('toggle', () => {
      if (d.open === foldOpen(id)) return // set from the settings, not by a click
      deps.patch({ folds: { ...(deps.getSettings()?.folds ?? {}), [id]: d.open } })
    })
  }
  /** A section that folds: the title on the left, a chevron on the right. */
  function section(id: string, title: string, body: HTMLElement, defaultOpen = true, help?: HelpContent): HTMLDetailsElement {
    const d = el('details', { className: 'hl-group hl-fold' }) as HTMLDetailsElement
    // A card's `[?]` sits after its title; pressing it opens the card, never folds it.
    const tip = help ? helpTip(title, help, () => { d.open = true }) : null
    d.appendChild(foldSummary(title, 'hl-fold-title', tip?.button, id === 'session' && phone ? 'camera' : TAB_ICONS[id]))
    if (tip) d.appendChild(tip.note)
    d.appendChild(body)
    registerFold(id, d, defaultOpen)
    return d
  }

  function buildStaticLayout(): void {
    // D-087: the version line comes first; the tab's own header already says Houselights.
    panel.appendChild(permissionLine)
    panel.appendChild(el('div', { className: 'hl-row' }, [widgetToggle, stateBadge.element]))
    void renderPermissions()
    // D-085: the introduction sits behind the first card's `[?]`.
    let sessionHelp: string
    if (phone) {
      // D-055: phones can't share their screen; the camera and pictures are the eyes here.
      sessionHelp = 'On a phone or tablet, your character sees through your camera or a picture you choose. Screen sharing needs a computer.'
    } else {
      sessionHelp =
        'Start session opens your browser\'s share dialog, where you choose a window or screen. ' +
        'Look sends one picture, scaled down first. Stop ends the session, and so does the browser\'s own ' +
        'Stop sharing button. A session also stops itself after a while; Extend adds more time. ' +
        'Change the length in Settings → Capture. More in the guide.'
      if (!support.screen) {
        panel.appendChild(el('div', { className: 'hl-status err', textContent: support.note }))
      } else if (support.note) {
        panel.appendChild(el('div', { className: 'hl-status', textContent: support.note }))
      }
    }

    // Part 2, the rule: touched per session or per chat → here; set once → the full settings.
    // 1. Session: the buttons, the mode, and the other eyes (they're inputs too).
    const controls = el('div', { className: 'hl-fold-body' })
    const hushBits = deps.hush ? [tabHushBtn, tabHushTip.button] : []
    const sessionBtns = el('div', { className: 'hl-btns' }, phone ? [] : [startBtn, lookBtn, stopBtn, ...hushBits, extendBtn])
    sessionBtns.style.alignItems = 'center'
    // Nothing to share from a phone: there the row holds Hush alone.
    if (phone) sessionBtns.append(...hushBits)
    if (!phone || hushBits.length > 0) controls.appendChild(sessionBtns)
    if (deps.hush) controls.append(tabHushTip.note, hushQuiet)
    if (!phone) controls.appendChild(modeSlot)
    controls.appendChild(sentToNote)
    controls.appendChild(sessionLines.root)
    controls.appendChild(sessionClock)
    // Other eyes: a fold of its own (closed on a computer, open on a phone), webcam and phone apart.
    const other = el('details', { className: 'hl-field hl-fold hl-other-eyes' }) as HTMLDetailsElement
    other.appendChild(foldSummary('Other eyes', 'hl-subhead'))
    registerFold('otherEyes', other, phone)
    const webcamOk = env.isSecureContext && env.hasGetUserMedia
    const webcamPart = el('div', { className: 'hl-eyes-part' })
    const webcamHead = el('span', { className: 'hl-eyes-head', textContent: 'Webcam' })
    if (webcamOk) webcamPart.appendChild(captionHelp(webcamHead, 'Webcam', 'A preview appears and you press Snap. The camera is switched off the moment the photo is taken.'))
    else webcamPart.append(webcamHead, note('The webcam needs a secure page (https or localhost), so it is not offered here.'))
    if (webcamOk) {
      webcamPart.appendChild(el('div', { className: 'hl-btns' }, [webcamBtn, snapBtn, webcamCancelBtn]))
      webcamPart.appendChild(webcamPreview)
    }
    const phonePart = el('div', { className: 'hl-eyes-part' })
    phonePart.appendChild(
      captionHelp(
        el('span', { className: 'hl-eyes-head', textContent: 'Camera and pictures' }),
        'Camera and pictures',
        'Take a photo opens the camera app on a phone or tablet, and a file chooser on a computer. Choose a picture ' +
          'takes any picture stored here. Both are scaled down before they are sent.',
      ),
    )
    phonePart.appendChild(el('div', { className: 'hl-btns' }, [photoBtn, pictureBtn]))
    phonePart.appendChild(
      staticScope.checkboxRow('Prefer the front camera', false, (v) =>
        cameraInput.setAttribute('capture', v ? 'user' : 'environment'),
      'Many phones and tablets ignore this. If yours does, switch cameras in the camera app.'),
    )
    // On a phone the phone part leads; on a computer the webcam does.
    if (phone) other.append(phonePart, webcamPart)
    else other.append(webcamPart, phonePart)
    // D-078: no second "Sent to" here — Other eyes sits inside Session, right by the first one.
    other.appendChild(otherLines.root)
    other.appendChild(cameraInput)
    other.appendChild(pictureInput)
    // D-055: on a phone, Other eyes is the way in, so it goes first.
    if (phone) controls.insertBefore(other, controls.firstChild)
    else controls.appendChild(other)
    panel.appendChild(section('session', phone ? 'Camera and pictures' : 'Session', controls, true, sessionHelp))

    // 2. Who reacts. 3. Watching (with Look things up).
    panel.appendChild(section('who', 'Who reacts', chatGroup))
    const watchBody = el('div', { className: 'hl-fold-body' }, [watchGroup, lookupBox])
    watchGroup.className = ''
    panel.appendChild(section('watching', 'Watching', watchBody))

    // 4. During the show (D-077): what you might change mid-chat, in one place —
    // Hush and Speak aloud, then the widget's switches, the next-track key (it
    // takes over the media Next key, so it lives with the things you flip), and
    // the widget's looks, folded closed. Was "Hush and voice" + "Widget".
    tabHushBtn.addEventListener('click', () => {
      const h = deps.hush?.state()
      deps.hush?.set(!(h?.hushed && h.source === 'button'))
    })
    registerFold('widgetLook', appearance, false)
    quickGroup.className = ''
    widgetGroup.className = ''
    const during = el('div', { className: 'hl-fold-body' }, [quickGroup, widgetGroup])
    panel.appendChild(section('during', 'During the show', during, true, 'Things you might change mid-chat.'))

    // 5. Last sent, at the bottom: never folded — it's the privacy promise.
    const seen = el('div', { className: 'hl-group' })
    seen.appendChild(
      captionHelp(el('span', { className: 'hl-fold-title hl-card-title' }, [icon('image'), el('span', { textContent: 'Last sent' })]), 'Last sent', 'The last picture that left your browser, and what came back. This card never folds.'),
    )
    seen.appendChild(thumbWrap)
    seen.appendChild(receiptBox)
    seen.appendChild(reactionLines.root)
    panel.appendChild(seen)

    // 6. Everything set once is a click away.
    // D-086: a small button, not an underlined link.
    const openSettings = button('Open the full settings', () => {
      ctx.events.emit('open-settings', { view: 'extensions' })
    }, 'small')
    panel.appendChild(el('div', { className: 'hl-btns' }, [openSettings]))

    // On the full settings page. Voice: what this device offers, and a test line.
    back.voiceCheck.appendChild(voiceStatus)
    back.voiceCheck.appendChild(voiceProviders)
    back.voiceCheck.appendChild(el('div', { className: 'hl-btns' }, [voiceAllowBtn, voiceTestBtn]))
    back.voiceCheck.appendChild(voiceResult)
    renderVoice()
    // Troubleshooting: a drawn frame through the whole path.
    const t = back.troubleshooting
    t.appendChild(
      captionHelp(
        el('span', { className: 'hl-subhead hl-subhead-gap', textContent: 'Test the connection' }),
        'Test the connection',
        'Sends a made-up picture, the size of a real one, with no share dialog and no character involved. ' +
          'It shows whether pictures arrive whole. The result appears on the Last sent card.',
      ),
    )
    t.appendChild(el('div', { className: 'hl-btns' }, [testBtn]))
    // D-088 (D7): what a report needs, in one place, under its own caption.
    t.appendChild(el('span', { className: 'hl-subhead hl-subhead-gap', textContent: 'Session details' }))
    t.appendChild(
      note(
        `Running in: ${env.clientKind} on ${env.platform}. Secure page: ${env.isSecureContext ? 'yes' : 'no'}. ` +
          `Screen sharing offered by the browser: ${env.hasGetDisplayMedia ? 'yes' : 'no'}.`,
      ),
    )
    t.appendChild(countersBox)
  }

  /**
   * Part 2, the settings page's "This device": the phone's switches (settings follow you
   * between devices, so a computer can set them too) and the next-track key.
   */
  function renderDevice(paneOnHere: boolean): void {
    deviceScope.reset()
    const d = back.device
    d.replaceChildren()
    const phonePane = deps.getSettings()?.showPaneMobile !== false
    d.appendChild(
      // D-088 (D3c): the Mobile card shows on a computer only, so its labels need no "on my phone".
      deviceScope.checkboxRow('Show the widget', phonePane, (v) => {
        deps.patch({ showPaneMobile: v })
        queueMicrotask(() => renderSettings())
      }, 'A phone or tablet has its own switch, on by default. Your computer\'s is the Hide widget button at the top of the Houselights tab.'),
    )
    d.appendChild(
      deviceScope.checkboxRow(
        'Follow my computer',
        deps.getSettings()?.companionPhone === true,
        (v) => {
          deps.patch({ companionPhone: v })
          refresh()
        },
        'Off by default. For playing on your computer with a phone or tablet beside you: the phone\'s toolbar asks your computer to look, ' +
          'and sends what you typed in the chat box with it. A session must already be running on the computer. More in the guide.',
        !phonePane,
      ),
    )
    void paneOnHere
  }

  /** H1 in the tab: the same Hush / Hushed · m:ss as the widget. */
  function renderHushButton(): void {
    const h = deps.hush?.state()
    const pressed = !!h && h.hushed && h.source === 'button'
    const secs = Math.max(0, Math.ceil((h?.remainingMs ?? 0) / 1000))
    tabHushBtn.textContent = pressed ? `Hushed · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : 'Hush'
    tabHushBtn.classList.toggle('hl-btn-on', pressed)
  }

  function renderQuick(): void {
    quickScope.reset()
    quickGroup.replaceChildren()
    if (deps.hush) {
      renderHushButton()
      const h = deps.hush.state()
      hushQuiet.hidden = !(h.hushed && h.source === 'conversation')
    }
    const va = deps.voice?.availability()
    if (deps.setVoiceOut && va?.tts && va.media === true) {
      quickGroup.appendChild(
        quickScope.checkboxRow('Speak reactions aloud', deps.getSettings()?.voiceOut === true, (v) => deps.setVoiceOut?.(v),
          'Reads each reaction aloud. The same switch as the widget\'s speaker button. The voice is chosen in Lumiverse\'s TTS settings.'),
      )
    }
  }

  /** This device's widget switch: the phone's own on a phone, the computer's otherwise. */
  function paneShownHere(): boolean {
    return phone ? deps.getSettings()?.showPaneMobile !== false : deps.getSettings()?.showPane !== false
  }

  function renderSettings(): void {
    for (const id of folds.keys()) applyFold(id)
    const s = settings()
    settingsScope.reset()
    settingsGroup.replaceChildren()
    // Part 2: Mode is the session's one front option. Paranoid is set on the settings page.
    modeSlot.replaceChildren()
    // A two-part bar rather than a list, so both modes are always in view (2026-11-16).
    const bar = el('div', { className: 'hl-seg' })
    bar.setAttribute('role', 'radiogroup')
    bar.setAttribute('aria-label', 'Mode')
    const choices: Array<{ value: CaptureSettings['captureMode']; title: string; sub: string }> = [
      { value: 'on-demand', title: 'On demand', sub: 'Start once, Look when you want' },
      { value: 'continuous', title: 'Continuous', sub: 'Looks by itself on a timer' },
    ]
    for (const c of choices) {
      const on = s.captureMode === c.value
      const b = el('button', { className: `hl-seg-btn${on ? ' hl-seg-on' : ''}` }, [
        el('span', { className: 'hl-seg-title', textContent: c.title }),
        el('span', { className: 'hl-seg-sub', textContent: c.sub }),
      ]) as HTMLButtonElement
      b.type = 'button'
      b.dataset.mode = c.value
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(on))
      b.addEventListener('click', () => {
        if (settings().captureMode === c.value) return
        deps.patch({ captureMode: c.value })
        syncTicker()
        refresh()
        queueMicrotask(() => renderSettings())
      })
      bar.appendChild(b)
    }
    modeSlot.appendChild(bar)
    if (s.captureMode === 'paranoid') {
      modeSlot.appendChild(note('Paranoid is on: every Look opens the share dialog. Choose On demand or Continuous to turn it off.'))
    }
    // The widget switch is this device's own (a phone has its own — D-055, on by default since D-078).
    const paneOn = paneShownHere()
    widgetToggle.textContent = paneOn ? 'Hide widget' : 'Show widget'
    widgetToggle.classList.toggle('hl-btn-on', paneOn)
    // D-087 (D3b): the header button is the widget's one switch; the tick that repeated it is gone.
    const widgetTop: HTMLElement[] = []
    // D-078: on a phone, the companion switch sits right under the widget's (it needs the widget).
    if (phone) {
      widgetTop.push(
        settingsScope.checkboxRow(
          'Follow my computer',
          deps.getSettings()?.companionPhone === true,
          (v) => {
            deps.patch({ companionPhone: v })
            refresh()
          },
          'Off by default. For playing on your computer with a phone or tablet beside you: the toolbar\'s Look asks your computer to look, ' +
            'and sends what you typed in the chat box with it. A session must already be running on the computer.',
          !paneOn,
        ),
      )
      // D-096: the toolbar's one-time hint, on request. Kept on this device, so the button is here.
      if (deps.showTips && paneOn) {
        const tipsBtn = button('Show tips again', () => {
          deps.showTips?.()
          tipsBtn.textContent = 'Tips will show again'
          tipsBtn.disabled = true
        }, 'small')
        widgetTop.push(el('div', { className: 'hl-btns' }, [tipsBtn]))
      }
    }
    if (env.hasDocumentPictureInPicture && deps.popOut && !phone) {
      const pop = settingsScope.checkboxRow(
        'Pop out on start',
        paneOn && deps.getSettings()?.popoutOnStart === true,
        (v) => deps.patch({ popoutOnStart: v }),
        // D-085: this was a hover-only title, which a phone can never read.
        // D-086: greyed while the widget is hidden, it says why again (0.1.1 lost that line).
        paneOn
          ? 'Start session and Start + Look also open the widget in its own window, which stays over your game.'
          : 'Needs the widget. Press Show widget first.',
        !paneOn,
      )
      widgetTop.push(pop)
    }
    if (mediaKey.state().supported && !phone) {
      const box = settingsScope.checkboxRow('Next-track key = Look', deps.getSettings()?.mediaKeyLook === true, (v) => {
        deps.patch({ mediaKeyLook: v })
        // Ticked mid-session: this click is the gesture the silent loop needs.
        if (v && session) {
          mediaKey.setEnabled(true)
          void mediaKey.setHold(true)
        } else if (!v) disarmMediaKey()
      }, "While a session runs, your keyboard's next-track key takes a Look, even with a game in front. " +
        'To get the key, Houselights plays silence, so music players will not ' +
        'skip on that key until the session stops.')
      widgetTop.push(box)
    }
    renderDevice(paneOn)
    renderQuick()

    // The widget's portrait: how big, and how see-through over the picture.
    widgetGroup.replaceChildren()
    for (const row of widgetTop) widgetGroup.appendChild(row)
    appearance.replaceChildren(foldSummary('Widget appearance', 'hl-subhead'))
    widgetGroup.appendChild(appearance)
    applyFold('widgetLook')
    const portraitSize = clampPct(deps.getSettings()?.portraitSizePct, 25, 10, 90)
    const portraitOpacity = clampPct(deps.getSettings()?.portraitOpacityPct, 100, 10, 100)
    appearance.appendChild(
      settingsScope.rangeRow(
        'Portrait size',
        portraitSize,
        { min: 10, max: 90, step: 5, suffix: '%', disabled: !paneOn },
        (v) => {
          deps.previewPortrait?.(null)
          deps.patch({ portraitSizePct: v })
        },
        (v) => deps.previewPortrait?.(v === null ? null : { sizePct: v }),
        'How tall the speaker\'s portrait is, as a share of the widget\'s picture. It grows with the widget.',
      ),
    )
    appearance.appendChild(
      settingsScope.rangeRow(
        'Portrait opacity',
        portraitOpacity,
        { min: 10, max: 100, step: 5, suffix: '%', disabled: !paneOn },
        (v) => {
          deps.previewPortrait?.(null)
          deps.patch({ portraitOpacityPct: v })
        },
        (v) => deps.previewPortrait?.(v === null ? null : { opacityPct: v }),
        'Lower values let the picture show through the portrait.',
      ),
    )
    // D-059: the widget's text size, and the two switches that also sit in its top-right corner.
    appearance.appendChild(
      settingsScope.rangeRow(
        'Text size',
        clampPct(deps.getSettings()?.paneTextPct, 100, 70, 200),
        { min: 70, max: 200, step: 5, suffix: '%', disabled: !paneOn },
        (v) => {
          deps.previewPortrait?.(null)
          deps.patch({ paneTextPct: v })
        },
        (v) => deps.previewPortrait?.(v === null ? null : { textPct: v }),
        'The size of all text on the widget and its pop-out. Buttons keep their size.',
      ),
    )
    appearance.appendChild(
      settingsScope.checkboxRow(
        'Hide picture',
        deps.getSettings()?.paneHidePicture === true,
        (v) => deps.patch({ paneHidePicture: v }),
        'Hides the last picture on the widget. The portraits and the lines stay. The same switch as the widget\'s Hide picture button.',
        !paneOn,
      ),
    )
    appearance.appendChild(
      settingsScope.checkboxRow(
        'Lines only',
        deps.getSettings()?.paneLinesOnly === true,
        (v) => deps.patch({ paneLinesOnly: v }),
        'Shows only what the characters say and what you say. Everything else on the widget is hidden. ' +
          'The same switch as the widget\'s Lines only button.',
        !paneOn,
      ),
    )
    if (!paneOn) widgetGroup.appendChild(note('The widget is hidden. Press Show widget.'))

    // The settings page's Capture section (Part 2): everything here is set once.
    settingsGroup.appendChild(
      settingsScope.checkboxRow('Paranoid mode', s.captureMode === 'paranoid', (v) => {
        deps.patch({ captureMode: v ? 'paranoid' : 'on-demand' })
        syncTicker()
        refresh()
        queueMicrotask(() => renderSettings())
      }, 'When on, no session stays open: every Look opens the browser\'s share dialog and stops sharing straight after. Turning it off goes back to On demand.'),
    )
    settingsGroup.appendChild(el('span', { className: 'hl-subhead hl-subhead-gap', textContent: 'Continuous' }))
    settingsGroup.appendChild(
      settingsScope.numberRow('Look every (seconds)', s.cadenceSeconds, { min: 1, max: 120, step: 1 }, (v) => {
        deps.patch({ cadenceSeconds: v })
        syncTicker()
      }),
    )
    settingsGroup.appendChild(
      settingsScope.numberRow('Skip a Look when the screen changed less than (0–255)', s.changeThreshold, { min: 0, max: 255, step: 1 }, (v) =>
        deps.patch({ changeThreshold: v }),
        'How much the screen must change before a Look is sent. 0 sends every Look. About 6 ignores a moving cursor and catches a change of scene.',
      ),
    )
    settingsGroup.appendChild(
      settingsScope.numberRow('Stop the session after (minutes)', s.autoStopMinutes, { min: 1, max: 240, step: 5 }, (v) =>
        deps.patch({ autoStopMinutes: v }),
      ),
    )

    settingsGroup.appendChild(el('span', { className: 'hl-subhead hl-subhead-gap', textContent: 'What leaves the browser' }))
    settingsGroup.appendChild(
      settingsScope.numberRow('Longest edge (pixels)', s.maxEdge, { min: 320, max: 2560, step: 64 }, (v) => deps.patch({ maxEdge: v })),
    )
    settingsGroup.appendChild(
      settingsScope.numberRow('JPEG quality (0–1)', s.jpegQuality, { min: 0.3, max: 1, step: 0.05 }, (v) => deps.patch({ jpegQuality: v })),
    )
    settingsGroup.appendChild(
      settingsScope.numberRow('Thumbnail edge (pixels)', s.thumbEdge, { min: 96, max: 640, step: 32 }, (v) => deps.patch({ thumbEdge: v })),
    )

    settingsGroup.appendChild(
      captionHelp(
        el('span', { className: 'hl-subhead hl-subhead-gap', textContent: 'Share dialog' }),
        'Share dialog',
        'Chrome and Edge follow these two; other browsers ignore them. The share dialog is always the browser\'s own.',
      ),
    )
    settingsGroup.appendChild(
      settingsScope.checkboxRow('Leave this Lumiverse tab out of the share dialog', s.excludeSelf, (v) => deps.patch({ excludeSelf: v })),
    )
    settingsGroup.appendChild(
      settingsScope.checkboxRow('Offer whole-screen sharing', s.monitorSurfaces === 'allow', (v) =>
        deps.patch({ monitorSurfaces: v ? 'allow' : 'exclude' }),
      ),
    )
  }

  /**
   * D15: the Watching chip. A guess (a window title at Start, or what the vision
   * model read off the screen) sits here until it's confirmed, edited or
   * dismissed. Only confirmed text ever reaches the character.
   */
  /** D-087: the old "Cleared when the session stops" was wrong: the name stays until it is cleared. */
  const WATCHING_HELP = 'The character is told this is the game or app on your screen. It lasts for the session; the next one asks "Still this?". It also asks when the screen stops looking like it.'
  function renderWatching(): void {
    watchScope.reset()
    watchGroup.replaceChildren()
    const w = watchingState
    const row = el('div', { className: 'hl-row' })
    const editor = (initial: string, onSave: (text: string) => void) => {
      const input = el('input', { value: initial }) as HTMLInputElement
      input.type = 'text'
      input.maxLength = 80
      input.placeholder = 'e.g. Palworld'
      input.setAttribute('aria-label', 'What is on screen')
      const label = el('label', { className: 'hl-sub', textContent: 'What is on screen' })
      input.className = 'hl-input hl-watch-input'
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault()
          onSave(input.value)
        }
      })
      return { label, input, save: button('Save', () => onSave(input.value), true) }
    }
    if (w.candidate) {
      row.appendChild(el('span', { textContent: `${w.candidate.text}?` }))
      row.appendChild(button('Confirm', () => deps.ctx.sendToBackend({ type: 'confirm_watching', text: w.candidate!.text }), true))
      row.appendChild(button('Edit', () => {
        row.replaceChildren()
        const { label, input, save } = editor(w.candidate!.text, (t) => deps.ctx.sendToBackend({ type: 'confirm_watching', text: t }))
        row.append(label, input, save)
        input.focus()
      }))
      watchGroup.appendChild(row)
      watchGroup.appendChild(
        note(
          w.candidate.source === 'label'
            ? 'This is the window\'s title, from your browser. Nothing is sent until you confirm. Edit it if it says too much.'
            : 'The vision model thinks this is what is on screen. Nothing is sent until you confirm. Edit it if it is wrong.',
        ),
      )
    } else if (!w.confirmed && w.lastConfirmed) {
      // D-099: the name ran out with its session, or the screen stopped matching it. Ask; send nothing.
      const last = w.lastConfirmed
      row.appendChild(el('span', { textContent: `Still ${last}?` }))
      row.appendChild(button('Confirm', () => deps.ctx.sendToBackend({ type: 'confirm_watching', text: last }), true))
      row.appendChild(button('Change', () => {
        row.replaceChildren()
        const { label, input, save } = editor(last, (t) => deps.ctx.sendToBackend({ type: 'confirm_watching', text: t }))
        row.append(label, input, save)
        input.focus()
        input.select()
      }))
      watchGroup.appendChild(row)
      watchGroup.appendChild(
        note(
          w.doubt === 'screen'
            ? 'The screen stopped looking like this. Nothing is sent until you confirm or change it.'
            : 'This is from your last session. Nothing is sent until you confirm or change it.',
        ),
      )
    } else if (w.confirmed) {
      row.appendChild(el('span', { textContent: w.confirmed }))
      row.appendChild(button('Edit', () => {
        row.replaceChildren()
        const { label, input, save } = editor(w.confirmed!, (t) => deps.ctx.sendToBackend({ type: 'confirm_watching', text: t }))
        row.append(label, input, save)
        input.focus()
      }))
      // D-086: the destructive one sits apart, at the far end, in the danger look.
      const clear = button('Clear', () => deps.ctx.sendToBackend({ type: 'confirm_watching', text: '' }), 'danger')
      clear.classList.add('hl-btns-apart')
      row.appendChild(clear)
      watchGroup.appendChild(helpRow(row, 'Watching', WATCHING_HELP))
    } else {
      const { label, input, save } = editor('', (t) => deps.ctx.sendToBackend({ type: 'confirm_watching', text: t }))
      row.append(label, input, save)
      watchGroup.appendChild(
        helpRow(row, 'Watching', [
          WATCHING_HELP,
          'Houselights suggests a name from the window\'s title (in Firefox) or from what the vision model sees, and asks before using it. You can also type one.',
        ]),
      )
    }
  }

  // --- the permissions line -------------------------------------------------------
  // After an update that adds a permission, the host does not always ask. One
  // line at the top says where things stand and what a missing one costs.
  async function renderPermissions(): Promise<void> {
    let granted: string[]
    try {
      granted = await ctx.permissions.getGranted()
    } catch {
      return
    }
    const missing = PERMISSIONS.filter((p) => !granted.includes(p.name))
    const versions = `Houselights ${manifest.version}${ctx.host?.lumiverseVersion ? ` · Lumiverse ${ctx.host.lumiverseVersion}` : ''}`
    permissionLine.hidden = false
    permissionLine.replaceChildren()
    if (missing.length === 0) {
      permissionLine.className = statusClass('ok')
      permissionLine.textContent = `${versions} · all permissions granted`
      return
    }
    const blocking = missing.some((p) => !p.optional)
    permissionLine.className = statusClass(blocking ? 'err' : 'info')
    permissionLine.appendChild(el('strong', { textContent: `${versions} · ${missing.length} permission${missing.length === 1 ? '' : 's'} not granted` }))
    for (const p of missing) permissionLine.appendChild(el('div', { textContent: `${p.name}: ${p.without}` }))
    permissionLine.appendChild(
      note(
        "Press Update for Houselights in Lumiverse's Extensions panel, then reload the page. If Houselights is already up to date, grant the permission in that panel.",
      ),
    )
  }

  // --- D18, D18″: look things up -----------------------------------------------------
  /** Part 2, the settings page's "Web search": the permission and whether Lumiverse has search set up. */
  function renderWebSearch(): void {
    // Ask whatever the chat: the settings page shows the answer either way.
    if (!lookupAsked) {
      lookupAsked = true
      ctx.sendToBackend({ type: 'get_lookup_status' })
    }
    webScope.reset()
    const w = back.webSearch
    w.replaceChildren()
    if (!lookupStatus) {
      w.appendChild(note('Checking whether web search is available…'))
      return
    }
    if (!lookupStatus.granted) {
      w.appendChild(
        note(
          'Look things up needs Lumiverse\'s web search permission, which Houselights does not have yet. ' +
            'Lumiverse asks you, or the server\'s owner, to approve it.',
        ),
      )
      w.appendChild(
        el('div', { className: 'hl-btns' }, [
          button('Allow web search', () => {
            void ctx.permissions
              .request(['web_search'], { reason: 'To look up notes about the game you confirmed, and only in chats where Look things up is on.' })
              .catch(() => undefined)
              .then(() => {
                lookupStatus = null
                ctx.sendToBackend({ type: 'get_lookup_status' })
                renderChat()
              })
          }),
        ]),
      )
      return
    }
    w.appendChild(
      el('div', {
        className: statusClass(lookupStatus.enabled === false ? 'info' : 'ok'),
        textContent:
          lookupStatus.enabled === false
            ? 'Permission granted, but web search is off in Lumiverse. Turn it on in Lumiverse\'s settings, under Web Search.'
            : 'Web search is allowed and ready. Look things up is on the Watching card in the Houselights tab, one switch per chat.',
      }),
    )
  }

  function renderLookup(): void {
    lookupBox.replaceChildren()
    renderWebSearch()
    const current = chat.chat
    if (!current) return
    const s = deps.getSettings() ?? { visionMode: 'describe' as const }
    const on = chat.lookUp === true
    if (!lookupStatus) {
      lookupBox.appendChild(note('Checking whether web search is available…'))
      return
    }
    if (!lookupStatus.granted) {
      // Part 2: the permission is set once, on the settings page (Web search). Say where.
      lookupBox.appendChild(note('Look things up needs Lumiverse\'s web search permission first.'))
      const go = button('Set up web search in the full settings', () => ctx.events.emit('open-settings', { view: 'extensions' }), 'small')
      lookupBox.appendChild(el('div', { className: 'hl-btns' }, [go]))
      return
    }
    lookupBox.appendChild(
      chatScope.checkboxRow(
        'Look things up',
        on,
        (v) => {
          // D18″: this chat's own switch, whatever its stance.
          chat = { ...chat, lookUp: v }
          ctx.sendToBackend({ type: 'set_chat_lookup', chatId: current.id, on: v })
          renderChat()
        },
        // D-087: the rest (one search per change, "had notes", writing a Custom for notes; D-069) is in the guide.
        'Off by default, and set for each chat. When on, the character gets a few notes from your own Lumiverse web search, whatever the stance. ' +
          'The search uses only the Watching name and the objective, mission or place name printed on screen, never your picture or a window title. ' +
          'More in the guide.',
      ),
    )
    // D-061: no spoiler-safe mode (amends D18) — a warning instead, said before it's turned on.
    lookupBox.appendChild(
      leadNote(
        'Potential spoilers:',
        'the notes may mention what comes next, such as a later area, a twist or an ending.',
      ),
    )
    // D-080: "how it works best" moved to the Coach's own description, under Stance.
    if (on) {
      const problems: string[] = []
      const last = lookupStatus.last
      lookupBox.appendChild(
        el('div', {
          className: statusClass(last ? (last.error ? 'err' : last.count > 0 ? 'ok' : 'info') : 'info'),
          textContent: last
            ? `Last search (${new Date(last.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}): "${last.query}" ${last.error ? `failed: ${last.error}` : `found ${last.count} note${last.count === 1 ? '' : 's'}${typeof last.pages === 'number' ? `, ${last.pages} from the page itself` : ''}.`}`
            : 'No search yet this session. One happens when the character is about to speak and the screen shows an objective, a mission name or a place name.',
        }),
      )
      if (last?.notes && last.notes.length > 0) {
        // Exactly what the Coach was handed, so a wrong reply can be traced.
        const details = el('details', { className: 'hl-fold hl-notes' })
        details.appendChild(foldSummary('Notes it was given', 'hl-subhead'))
        last.notes.forEach((n, i) => details.appendChild(note(`${i + 1}. ${n.title ? `${n.title} — ` : ''}${n.text}`)))
        lookupBox.appendChild(details)
      }
      if (lookupStatus.enabled === false) problems.push('Web search is off in Lumiverse, so nothing will be found. Turn it on in Lumiverse\'s settings, under Web Search.')
      if (!watchingState.confirmed) problems.push('There is no Watching name yet, so there is nothing to search for. Confirm or type one on this card.')
      if (s.visionMode === 'attach') problems.push('How the character sees is set to Attach, so there is no description to take search words from. Look things up needs Describe.')
      for (const text of problems) lookupBox.appendChild(el('div', { className: statusClass('info'), textContent: text }))
    }
  }

  /** The Custom instruction as typed but not yet saved, so a redraw mid-typing keeps it. */
  let customDraft: string | null = null
  /** The name in the "Save as" field, kept across redraws of the same chat. */
  let presetName = ''
  /** The chat `presetName` was typed in. */
  let presetChatId: string | null = null
  /** The last Save as / Delete result, shown once after the redraw it causes. */
  let presetNote: { text: string; kind: 'info' | 'ok' | 'err' } | null = null
  function renderChat(): void {
    chatScope.reset()
    lookupBox.replaceChildren()
    renderWebSearch()
    chatGroup.replaceChildren()
    if (!chat.chat) {
      chatGroup.appendChild(el('div', { className: 'hl-status', textContent: 'No chat is open. Open a chat with a character first.' }))
      return
    }
    const current = chat.chat
    const pinned = chat.mode === 'pinned'
    const label = current.characterName ? `${current.characterName} · ${current.name}` : current.name
    chatGroup.appendChild(
      chatScope.checkboxRow(`React in ${pinned ? 'the pinned chat' : 'this chat'}`, chat.enabled, (v) => {
        ctx.sendToBackend({ type: 'set_chat_enabled', chatId: current.id, enabled: v })
      }, 'When on, each Look puts a reaction in this chat, with a hidden note of what was seen. Each chat has its own switch.'),
    )
    // The chat's name on its own line, at help size, under the switch.
    chatGroup.appendChild(note(label))
    // Watching in (addendum §2 / D5): pin the chat, or go back to following.
    const pinRow = el('div', { className: 'hl-row' })
    const pinBtn = button(pinned ? 'Unpin' : 'Pin this chat', () => {
      ctx.sendToBackend({ type: 'pin_chat', chatId: pinned ? null : current.id })
    })
    pinRow.appendChild(pinBtn)
    // D-095: from anywhere else, one press to the chat the reactions land in.
    if (pinned && chat.activeChatId !== current.id && deps.openChat) {
      pinRow.appendChild(button('Go to chat', () => deps.openChat?.(current.id)))
    }
    // D-079: at a glance, whether you're in the pinned chat or somewhere else.
    if (pinned) {
      const away = chat.activeChatId !== current.id
      const where = chatScope.badge(away ? 'You\'re elsewhere' : 'You\'re here', away ? 'warning' : 'success')
      pinRow.appendChild(where.element)
    }
    const waiting = chat.newReactions ?? 0
    const elsewhere = pinned && chat.activeChatId !== current.id
    if (!pinned) {
      // What pinning does is help; where a pinned chat's reactions land is status, and stays in view.
      const pinTip = helpTip('Pin this chat', 'Reactions go to whichever chat you have open. Pin this chat and they keep landing here, wherever you are.')
      pinRow.style.justifyContent = 'flex-start'
      pinRow.appendChild(pinTip.button)
      chatGroup.append(pinRow, pinTip.note)
    } else chatGroup.appendChild(pinRow)
    if (pinned) chatGroup.appendChild(
      note(
        (elsewhere
              ? `Pinned: reactions land in this chat while you are in another.${waiting ? ` ${waiting} new reaction${waiting === 1 ? '' : 's'} waiting.` : ''}`
              : 'Pinned: reactions land in this chat wherever you are.'),
      ),
    )
    // D-052: a solo chat that council members could join. Above the stance (D-075),
    // as in a Box Seat, where who sits comes before each viewer's stance.
    if (!chat.box && chat.council?.length) {
      chatGroup.appendChild(
        captionHelp(
          el('span', { className: 'hl-subhead', textContent: 'Council members' }),
          'Council members',
          'A council member you turn on watches alongside the character. With anyone on, this chat runs as a Box Seat: each viewer speaks in turn, with a stance of their own.',
        ),
      )
      for (const v of chat.council) {
        chatGroup.appendChild(
          chatScope.checkboxRow(`${v.name} joins this chat`, false, (on) =>
            ctx.sendToBackend({ type: 'set_council_seat', chatId: current.id, viewerId: v.id, seated: on }),
          ),
        )
      }
    }
    // D17: the stance, per chat. Takes effect on the next Look.
    const stance: Stance = chat.stance ?? DEFAULT_STANCE
    // In a group chat the chat-wide select is hidden: it is the default behind
    // every viewer, and one slip would change the whole box. Stances are set
    // per viewer, in the Box Seat section below.
    if (!chat.box) {
      const stanceRow = chatScope.selectRow(
        'Stance',
        stance,
        STANCES.map((s) => ({ value: s.id, label: s.label })),
        (v) => {
          customDraft = null
          ctx.sendToBackend({ type: 'set_stance', chatId: current.id, stance: v })
        },
        // D-087: every stance, one line each; the Coach's advice (D-080) joins while it is chosen.
        stanceHelp(stance),
      )
      chatGroup.appendChild(stanceRow)
    }
    // D18, D18″: look things up — any stance, opt-in per chat, and only once the name is confirmed.
    renderLookup()
    // Box Seat (D13′): a group chat. Who is in the box and each viewer's stance.
    if (chat.box) {
      const box = chat.box
      const seated = box.viewers.filter((v) => v.seated !== false)
      const council = box.viewers.filter((v) => v.kind === 'council')
      // D-085: the Box Seat's explanations, one paragraph each, behind its `[?]`.
      const boxHelp: string[] = [
        // D-081: who's in the box is shown just below, viewer by viewer — no list here.
        'Each Look goes viewer by viewer. One opens (they take turns), the next answers, and each line is its own message. ' +
          'Each viewer has a stance of their own. More in the guide.',
      ]
      // D-081: the card-mode line is gone (plumbing); the solo-with-council note stays.
      if (box.solo) boxHelp.push('This is a solo chat with council members sitting in it. Turn them all off and it is an ordinary solo chat again.')
      chatGroup.appendChild(captionHelp(el('span', { className: 'hl-subhead', textContent: 'Box Seat' }), 'Box Seat', boxHelp))
      // D-080: nothing to say when lines carry their own names (the normal case). Only
      // an older Lumiverse, where every line starts "Name:", gets a plain explanation.
      if (!box.stamping) {
        chatGroup.appendChild(
          note('This Lumiverse version can\'t give each line its own name and avatar, so each line starts with the speaker\'s name instead. Updating Lumiverse fixes it.'),
        )
      }
      if (council.length > 0) {
        chatGroup.appendChild(
          captionHelp(
            el('span', { className: 'hl-subhead', textContent: 'Council members' }),
            'Council members',
            'Turn on the council members who sit in this chat\'s Box Seat. Each chat keeps its own choice' +
              (box.solo ? '.' : '; a group chat starts with all of them.') +
              ' More in the guide.',
          ),
        )
        for (const v of council) {
          chatGroup.appendChild(
            chatScope.checkboxRow(`${v.name} sits in this Box Seat`, v.seated !== false, (on) =>
              ctx.sendToBackend({ type: 'set_council_seat', chatId: current.id, viewerId: v.id, seated: on }),
            ),
          )
        }
      }
      // D-054: voice in the box. While the speaker toggle is on: who is read aloud
      // (everyone, or one viewer; each character in its own Lumiverse voice), and the
      // per-viewer fallback voices. Off: none of it shows.
      const settingsNow = deps.getSettings()
      const voiceOn = settingsNow?.voiceOut === true && !!deps.voice
      const speakers = settingsNow?.boxSpeakers ?? {}
      const chosenSpeaker = speakers[current.id] && seated.some((v) => v.id === speakers[current.id]) ? speakers[current.id]! : ''
      if (voiceOn) {
        chatGroup.appendChild(
          chatScope.selectRow(
            'Speaks aloud',
            chosenSpeaker,
            [{ value: '', label: 'Everyone, one after another' }, ...seated.map((v) => ({ value: v.id, label: `Only ${v.name}` }))],
            (id) => {
              const next = { ...speakers }
              if (id) next[current.id] = id
              else delete next[current.id]
              deps.patch({ boxSpeakers: next })
              queueMicrotask(() => renderChat())
            },
            'Each viewer is read in their character\'s own voice, from its Voice tab in Lumiverse. Choose one viewer to be read aloud and the rest stay on screen.',
          ),
        )
      }
      // One block per viewer: their name, then their options indented under it.
      for (const v of seated) {
        const block = el('div', { className: 'hl-viewer' })
        const head = el('div', { className: 'hl-viewer-name', textContent: v.name })
        if (v.kind === 'council') head.appendChild(el('span', { className: 'hl-viewer-tag', textContent: 'council' }))
        if (voiceOn && chosenSpeaker === v.id) head.appendChild(el('span', { className: 'hl-viewer-tag', textContent: 'speaks aloud' }))
        block.appendChild(head)
        block.appendChild(
          chatScope.selectRow(
            'Stance',
            v.stance,
            STANCES.map((s) => ({ value: s.id, label: s.label })),
            (st) => ctx.sendToBackend({ type: 'set_viewer_stance', chatId: current.id, viewerId: v.id, stance: st }),
            stanceHelp(v.stance),
          ),
        )
        // D-052: a Custom viewer can have their own saved instruction.
        if (v.stance === 'custom') {
          const presets = deps.getSettings()?.customPresets ?? []
          const match = v.custom ? presets.find((p) => p.text.trim() === v.custom!.trim()) : undefined
          const value = !v.custom ? '' : match ? `preset:${match.name}` : 'own'
          const options = [
            { value: '', label: 'This chat\'s Custom instruction' },
            ...presets.map((p) => ({ value: `preset:${p.name}`, label: p.name })),
            ...(value === 'own' ? [{ value: 'own', label: 'Their own instruction (no longer saved under a name)' }] : []),
          ]
          block.appendChild(
            chatScope.selectRow(
              'Instruction',
              value,
              options,
              (picked) => {
                if (picked === 'own') return
                const text = picked.startsWith('preset:') ? (presets.find((p) => `preset:${p.name}` === picked)?.text ?? '') : ''
                ctx.sendToBackend({ type: 'set_viewer_custom', chatId: current.id, viewerId: v.id, text })
              },
              presets.length === 0 ? 'To give this viewer an instruction of their own, save one under a name with Save as, then choose it here.' : undefined,
            ),
          )
        }
        // D16 fallback: a line that cannot play by message (unstamped host, or a
        // council member) is spoken as text — in this connection's voice. Only
        // while voice is on, and only for a viewer who is actually read aloud.
        const readAloud = chosenSpeaker === '' || chosenSpeaker === v.id
        if (voiceOn && readAloud && deps.boxVoice && ttsConnections && ttsConnections.length > 0 && (!box.stamping || v.kind === 'council')) {
          block.appendChild(
            chatScope.selectRow(
              'Voice',
              deps.boxVoice.get(v.id),
              [{ value: '', label: 'Your default TTS connection' }, ...ttsConnections.map((c) => ({ value: c.id, label: c.name }))],
              (id) => deps.boxVoice?.set(v.id, id),
            ),
          )
        }
        chatGroup.appendChild(block)
      }
    }
    // The Custom instruction and the saved ones, last: long, and only for a Custom stance.
    const anyCustom = chat.box ? chat.box.viewers.some((v) => v.seated !== false && v.stance === 'custom') : stance === 'custom'
    if (anyCustom) {
      // D-082: the hint, one point per line, with our tokens in bold. D-085: behind the `[?]`, whole.
      const customHint = tokenHint([
        chat.box
          ? 'Replaces the stance block for every Custom viewer in this chat who has no saved instruction chosen under their own name.'
          : 'Replaces the stance block for this chat.',
        '{{scene}} is where what was seen goes; if you leave it out, it is automatically placed at the start of your instructions.',
        '{{hushed}} is empty unless a hush is part of the moment — then it says so, e.g. "{{user}} hushed you for 4 minutes. That is over now, and this is the first thing you have said since."',
        'Wrap hush-only guidance in {{ifhushed}}…{{/ifhushed}} so that these instructions are only sent if a hush actually occurred.',
        'The base block still applies: framing and self-recognition (on the Prompts card in the full settings) and the Watching name.',
        'Until you write your own, the stock instruction is shown and used. Reset to stock puts it back.',
      ])
      const field = chatScope.textField(
        'Custom instruction',
        customHint,
        // D-073: an empty Custom uses the default, so the box shows it rather than nothing.
        customDraft ?? (chat.customStance?.trim() ? chat.customStance : DEFAULT_CUSTOM_INSTRUCTION),
        6,
        (v) => {
          customDraft = v
        },
      )
      chatGroup.appendChild(field)
      const saveRow = el('div', { className: 'hl-btns' })
      saveRow.appendChild(
        button('Save instruction', () => {
          // In a box the chat-wide stance stays as it is; only the text is saved.
          ctx.sendToBackend({ type: 'set_stance', chatId: current.id, stance: chat.box ? stance : 'custom', custom: customDraft ?? chat.customStance ?? '' })
          customDraft = null
        }),
      )
      // D-073: back to the built-in text. Saved as empty, which means "the default",
      // so a later improvement to the default reaches this chat too.
      // D-086: apart, at the far end, in the danger look (it throws the typed text away).
      saveRow.appendChild(
        el('div', { className: 'hl-btns hl-btns-apart' }, [
          button('Reset to stock', () => {
            // D-087: every reset asks first (style guide §2).
            void confirmDanger(
              ctx,
              'Reset Custom instruction',
              'This chat\'s Custom instruction goes back to the stock one. What you wrote here is lost unless it is saved under a name.',
              'Reset',
            ).then((yes) => {
              if (!yes) return
              customDraft = null
              ctx.sendToBackend({ type: 'set_stance', chatId: current.id, stance: chat.box ? stance : 'custom', custom: '' })
            })
          }, 'danger'),
        ]),
      )
      chatGroup.appendChild(saveRow)

      // Named Custom instructions, saved in the settings and shared by every chat.
      const presets = deps.getSettings()?.customPresets ?? []
      // What the box shows is what Save as keeps — the default included, when nothing is written yet.
      const current_text = () => (customDraft ?? (chat.customStance?.trim() ? chat.customStance : DEFAULT_CUSTOM_INSTRUCTION) ?? '').trim()
      // A new chat starts with an empty Name, not the last chat's.
      if (presetChatId !== current.id) {
        presetChatId = current.id
        presetName = ''
      }
      // Shown as selected only when it is what this chat actually uses: its saved
      // Custom text matches. The name typed last breaks a tie between equal texts.
      const using = (chat.customStance ?? '').trim()
      const matching = using ? presets.filter((p) => p.text.trim() === using) : []
      const selected = (matching.find((p) => p.name === presetName) ?? matching[0])?.name ?? ''
      chatGroup.appendChild(
        chatScope.selectRow(
          'Saved instructions',
          selected,
          [{ value: '', label: presets.length ? 'Choose one to use here…' : 'None saved yet' }, ...presets.map((p) => ({ value: p.name, label: p.name }))],
          (name) => {
            const p = presets.find((x) => x.name === name)
            if (!p) return
            presetName = p.name
            customDraft = null
            // Using it is choosing it for this chat: the text is saved as this chat's Custom instruction.
            ctx.sendToBackend({ type: 'set_stance', chatId: current.id, stance: chat.box ? stance : 'custom', custom: p.text })
          },
          'Choose one and it becomes this chat\'s Custom instruction. Saved instructions are shared by every chat.',
        ),
      )
      const nameInput = el('input', { type: 'text', value: presetName, placeholder: 'e.g. Dry narrator', className: 'hl-input' }) as HTMLInputElement
      nameInput.maxLength = 60
      nameInput.addEventListener('input', () => {
        presetName = nameInput.value
      })
      chatGroup.appendChild(el('div', { className: 'hl-row' }, [el('label', { textContent: 'Name' }), nameInput]))
      const presetStatus = el('div', { className: statusClass('info') })
      presetStatus.hidden = true
      const say = (text: string, kind: 'info' | 'ok' | 'err') => {
        presetNote = { text, kind }
        presetStatus.className = statusClass(kind)
        presetStatus.textContent = text
        presetStatus.hidden = false
      }
      if (presetNote) {
        // Shown once: the message that caused this redraw.
        presetStatus.className = statusClass(presetNote.kind)
        presetStatus.textContent = presetNote.text
        presetStatus.hidden = false
        presetNote = null
      }
      const presetRow = el('div', { className: 'hl-btns' })
      presetRow.appendChild(
        button('Save as', () => {
          const name = presetName.trim().slice(0, 60)
          const text = current_text()
          if (!name) return say('Give it a name first.', 'err')
          if (!text) return say('Nothing to save: the Custom instruction is empty.', 'err')
          const existed = presets.some((p) => p.name === name)
          const next = [...presets.filter((p) => p.name !== name), { name, text: text.slice(0, 4000) }].sort((a, b) => a.name.localeCompare(b.name))
          if (next.length > 50) return say('You already have 50 saved instructions. Delete one first.', 'err')
          presetName = name
          deps.patch({ customPresets: next })
          ctx.sendToBackend({ type: 'set_stance', chatId: current.id, stance: chat.box ? stance : 'custom', custom: text })
          customDraft = null
          say(existed ? `Updated "${name}".` : `Saved "${name}".`, 'ok')
          queueMicrotask(() => renderChat())
        }),
      )
      const deleteBtn = button('Delete', () => {
          const name = presetName.trim()
          if (!presets.some((p) => p.name === name)) return say(name ? `No saved instruction is called "${name}".` : 'Choose or type the name to delete.', 'err')
          // D-087: every delete asks first.
          void confirmDanger(ctx, 'Delete saved instruction', `Delete "${name}"? Chats that already use it keep their instruction.`, 'Delete').then((yes) => {
            if (!yes) return
            const now = deps.getSettings()?.customPresets ?? []
            deps.patch({ customPresets: now.filter((p) => p.name !== name) })
            presetName = ''
            say(`Deleted "${name}". This chat keeps its instruction.`, 'info')
            queueMicrotask(() => renderChat())
          })
        }, 'danger')
      presetRow.appendChild(el('div', { className: 'hl-btns hl-btns-apart' }, [deleteBtn]))
      chatGroup.appendChild(presetRow)
      chatGroup.appendChild(presetStatus)
    }
  }


  function describeReaction(r: ReactionResult): { text: string; kind: 'info' | 'ok' | 'err' } {
    if (r.ok) {
      const seen = r.scene ? ` (saw: ${r.scene})` : ''
      const guess = r.app ? ` · the vision model thinks it is ${r.app} (${Math.round((r.appConfidence ?? 0) * 100)}%)` : r.scene ? ' · the vision model named no game or app' : ''
      const told = (r.watching ? ` · told: in ${r.watching}` : '') + (r.lookedUp ? ` · had notes: "${r.lookedUp.query}" (${r.lookedUp.fresh ? 'searched now' : 'reused'})` : '') + (r.hushTold === 'hush' ? ' · told about a hush' : r.hushTold === 'quiet' ? ' · told it held back while you talked' : '')
      if (r.lines && r.lines.length) {
        const script = r.lines.map((l) => `${l.name || '(unattributed)'}: ${l.text}`).join(' | ')
        const asked = r.boxOrder?.length ? `asked ${r.boxOrder.join(', then ')}. ` : ''
        const got = `${asked ? 'Got' : 'got'} ${r.lines.length} line${r.lines.length === 1 ? '' : 's'} (${r.lines.map((l) => l.name || 'unattributed').join(', ')})`
        return { text: `Box Seat: ${asked}${got}: ${script}${seen}${guess}${told}`, kind: 'ok' }
      }
      return { text: `Reaction: "${r.text}"${seen}${guess}${told}`, kind: 'ok' }
    }
    if (r.error) return { text: `Reaction failed: ${r.error}`, kind: 'err' }
    const d = r.detail ?? {}
    switch (r.reason) {
      case 'no-chat':
        return { text: 'No chat to react in.', kind: 'info' }
      case 'chat-off':
        return { text: 'Reactions are off for this chat. Turn on React in this chat, on the Who reacts card.', kind: 'info' }
      case 'busy':
        return { text: 'Held back: a reply was being written in the chat.', kind: 'info' }
      case 'already-reacting':
        return { text: 'Still on the previous picture.', kind: 'info' }
      case 'hush':
        return {
          text: (d.source === 'conversation' ? 'Staying quiet while you two are talking.' : 'Hushed.') + (d.kept ? ' Still watching: noted what it saw.' : ''),
          kind: 'info',
        }
      case 'cooldown':
        return { text: `Saw it. Staying quiet for another ${Math.ceil(Number(d.waitMs ?? 0) / 1000)} seconds (the minimum gap).`, kind: 'info' }
      case 'kind':
        return { text: `Not commenting on this (${String(d.kind)}).`, kind: 'info' }
      case 'boring':
        return { text: `Rated it ${String(d.interest)} out of 10, below your bar of ${String(d.bar)}.`, kind: 'info' }
      case 'repeat':
        return { text: 'Nothing new since the last reaction.', kind: 'info' }
      default:
        return { text: 'Nothing said.', kind: 'info' }
    }
  }

  // --- the engine's state, for the Pane ------------------------------------------
  // (`listeners` is declared with the rest of the state: the first refresh()
  // runs before this point in the file.)
  function snapshot(): EngineSnapshot {
    return {
      live: session !== null,
      busy,
      startedAt: session?.startedAt ?? null,
      // D-099: a phone following the computer knows the computer's session through the backend.
      autoStopAt: session?.autoStopAt ?? remoteStop?.at ?? null,
      stopWarnAt: session ? session.autoStopAt - stopWarningMs(session.windowMs) : remoteStop ? remoteStop.at - stopWarningMs(remoteStop.windowMs) : null,
      lastThumbDataUrl,
      lastReaction,
      // D-063: a companion phone also shows the computer's Look as in progress.
      awaitingReaction: isAwaiting() || companionWaiting(),
      working: isAwaiting() ? working : companionWaiting() ? (remoteAsked ? 'Asking your computer to look…' : 'Your computer is looking…') : null,
      partialLines: isAwaiting() ? partialLines : [],
      chat,
      watching: watchingState,
      canCapture: support.screen,
      mediaKeyHeld: mediaKey.state().enabled && mediaKey.state().holding,
      status,
    }
  }
  function notify(): void {
    if (listeners.size === 0) return
    const s = snapshot()
    for (const l of listeners) {
      try {
        l(s)
      } catch {
        // A listener's failure is its own problem.
      }
    }
  }

  function refresh(): void {
    notify()
    const live = session !== null
    const s = settings()

    stateBadge.set(live ? 'LIVE' : 'Idle', live ? 'danger' : 'neutral')
    // The drawer tab badge: new reactions waiting in the pinned chat beat LIVE.
    const waiting = chat.newReactions ?? 0
    tab.setBadge(waiting > 0 ? `${waiting} new` : live ? 'LIVE' : null)
    extendBtn.disabled = !live
    extendBtn.textContent = `Extend +${Math.max(1, s.autoStopMinutes)} min`
    extendBtn.style.display = live ? '' : 'none'

    // No reactions in the watched chat: nothing to start a session for.
    const reacting = !!chat.chat && chat.enabled
    startBtn.disabled = !support.screen || live || busy || s.captureMode === 'paranoid' || !reacting
    lookBtn.disabled = !support.screen || busy || !reacting || isAwaiting()
    // D-087: the reason a greyed Start or Look is greyed is on the status line, not in a hover title.
    const offReason = !chat.chat ? 'Open a chat with a character first.' : 'Turn on React in this chat, on the Who reacts card, first.'
    stopBtn.disabled = !live
    lookBtn.textContent = busy ? 'Looking…' : live || s.captureMode === 'paranoid' ? 'Look' : 'Start + Look'

    const ambient = live
      ? s.captureMode === 'continuous'
        ? 'Live. Houselights looks by itself; Look still works.'
        : 'Live. Press Look when you want a reaction.'
      : !reacting
        ? `No session. ${offReason}`
        : 'No session.'
    if (status.kind === 'err') {
      // A failure goes to its own line once; the status line goes on saying where things stand.
      if (status !== failedStatus) {
        failedStatus = status
        sessionLines.fail(status.text)
      }
      sessionLines.status(ambient)
    } else {
      sessionLines.status(status.text || ambient)
    }

    if (session) {
      const elapsed = Math.floor((Date.now() - session.startedAt) / 1000)
      const left = Math.max(0, Math.ceil((session.autoStopAt - Date.now()) / 1000))
      sessionClock.textContent =
        `Live for ${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, '0')}s · ` +
        `stops itself in ${Math.floor(left / 60)}m ${String(left % 60).padStart(2, '0')}s`
    } else {
      sessionClock.textContent = ''
    }
    sessionClock.hidden = !sessionClock.textContent
    const details: string[] = []
    if (session) {
      details.push(describeStream(session.stream))
      details.push(
        `Timer: ${ticker ? (ticker.kind === 'worker' ? 'in the background (keeps time behind a game)' : 'on the page (may slow down behind a game)') : 'off'}.`,
      )
    }
    details.push(
      `Looks ${counters.ticks} · sent ${counters.sent} · skipped, nothing changed ${counters.skipped} · received ${counters.received}` +
        ` · reactions ${counters.reactions}` + (counters.failed ? ` · failed ${counters.failed}` : ''),
    )
    countersBox.replaceChildren(...details.map((d) => el('div', { textContent: d })))

    thumbWrap.replaceChildren(
      lastThumbDataUrl
        ? el('img', { className: 'hl-thumb', src: lastThumbDataUrl, alt: 'The last picture sent' })
        : el('div', { className: 'hl-thumb-empty', textContent: 'Nothing sent yet' }),
    )

    if (lastReceipt) {
      if (lastReceipt.ok) {
        const size = formatBytes(lastReceipt.measuredJpegBytes ?? 0)
        const dims = `${lastReceipt.width}×${lastReceipt.height}`
        const trip = lastRoundTripMs !== null ? ` in ${lastRoundTripMs} ms` : ''
        receiptBox.className = lastReceipt.intact ? 'hl-status ok' : 'hl-status err'
        receiptBox.textContent = lastReceipt.intact
          ? `Received intact: ${dims}, ${size}${trip}.`
          : `Houselights received a different size than was sent (${size} against ${formatBytes(lastReceipt.declaredJpegBytes ?? 0)}). Please report this.`
      } else {
        receiptBox.className = 'hl-status err'
        receiptBox.textContent = `Not accepted: ${lastReceipt.error ?? 'unknown error'}`
      }
      receiptBox.style.display = ''
    } else {
      receiptBox.style.display = 'none'
    }

    const m = deps.getSettings()
    const prose = deps.getConnectionName(m?.connectionId ?? null)
    const vision =
      m && m.visionMode === 'describe' ? deps.getConnectionName(m.visionConnectionId ?? m.connectionId) : null
    sentToNote.textContent = vision && vision !== prose
      ? `Sent to: ${vision} (vision model), then ${prose} (reaction model).`
      : `Sent to: ${prose}.`

    const webcamOpen = webcam !== null
    webcamBtn.disabled = busy || webcamOpen
    snapBtn.disabled = busy || !webcamOpen
    webcamCancelBtn.disabled = !webcamOpen
    photoBtn.disabled = busy
    pictureBtn.disabled = busy

    if (isAwaiting()) {
      reactionLines.status(working ?? 'Asking the character…')
    } else if (lastReaction) {
      const d = describeReaction(lastReaction)
      if (d.kind === 'err') {
        if (lastReaction !== failedReaction) {
          failedReaction = lastReaction
          reactionLines.fail(d.text)
        }
        reactionLines.status('')
      } else {
        reactionLines.status(d.text)
      }
    } else {
      reactionLines.status('')
    }

    renderLookAction()
  }

  // --- sessions ----------------------------------------------------------------

  function displayMediaOptions(s: CaptureSettings): DisplayMediaStreamOptions {
    // The non-`video`/`audio` members are Chromium hints. Firefox and Safari
    // ignore unknown members, so this is safe to pass everywhere.
    const options: DisplayMediaStreamOptions & Record<string, unknown> = {
      video: {
        displaySurface: 'window',
        // We read one frame every few seconds; without these the browser
        // captures the screen at full rate (30–60 fps) for as long as the
        // session is open, which is real GPU and CPU work for nothing.
        frameRate: { ideal: 2, max: 5 },
        width: { max: 1920 },
        height: { max: 1080 },
      },
      audio: false,
      selfBrowserSurface: s.excludeSelf ? 'exclude' : 'include',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: s.monitorSurfaces === 'exclude' ? 'exclude' : 'include',
    }
    return options
  }

  async function openStream(s: CaptureSettings): Promise<{ stream: MediaStream; video: HTMLVideoElement }> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions(s))
    } catch (err) {
      // D-064: some Safari versions are reported to refuse display constraints
      // with `ideal` in them (a TypeError or OverconstrainedError before any
      // picker). Ask once more with nothing but "video, no audio"; the
      // applyConstraints below still tries for the low frame rate. A cancel
      // (NotAllowedError) or a real failure is not retried.
      if (!isConstraintRejection(err)) throw err
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    }
    // Some browsers only apply rate/size limits after the picker; ask again.
    const track = stream.getVideoTracks()[0]
    if (track) {
      try {
        await track.applyConstraints({ frameRate: { ideal: 2, max: 5 }, width: { max: 1920 }, height: { max: 1080 } })
      } catch {
        // Not every browser lets you re-constrain a display track; the initial request still counts.
      }
    }
    registerOrphanGuard(() => stopEverything('orphan'))
    if (track) {
      // Spike R2: one line per browser, read back by a human. Never sent.
      const st = track.getSettings() as MediaTrackSettings & { displaySurface?: string }
      console.info(`[Houselights] R2 track.label=${JSON.stringify(track.label)} surface=${st.displaySurface ?? '?'} (${classifyTrackLabel(track.label ?? '')})`)
      // D15 layer 1: a title is a candidate for the chip — shown, never sent raw.
      const candidate = titleCandidate(track.label ?? '')
      if (candidate) ctx.sendToBackend({ type: 'watch_candidate', text: candidate, source: 'label' })
    }
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    try {
      await video.play()
      await waitForFrames(video, 5000)
    } catch (err) {
      for (const t of stream.getTracks()) t.stop()
      throw err
    }
    return { stream, video }
  }

  function isConstraintRejection(err: unknown): boolean {
    const name = (err as { name?: unknown } | null)?.name
    return err instanceof TypeError || name === 'TypeError' || name === 'OverconstrainedError'
  }

  /** Resolve once the video has real dimensions, i.e. a frame can be drawn. */
  function waitForFrames(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const check = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) return resolve()
        if (Date.now() - started > timeoutMs) return reject(new Error('The shared window never produced a picture.'))
        setTimeout(check, 50)
      }
      check()
    })
  }

  async function startSession(origin: 'button' | 'look'): Promise<boolean> {
    if (session || !support.screen) return session !== null
    armMediaKey() // Synchronous, inside the click: the silent loop needs the gesture.
    const s = settings()
    busy = true
    status = { text: 'Waiting for you to choose what to share…', kind: 'info' }
    refresh()
    try {
      const { stream, video } = await openStream(s)
      const track = stream.getVideoTracks()[0]
      // The browser's own "Stop sharing" button ends the track; mirror it.
      track?.addEventListener('ended', () => stopSession('ended'))

      const autoStopMs = Math.max(1, s.autoStopMinutes) * 60_000
      session = {
        stream,
        video,
        startedAt: Date.now(),
        autoStopAt: Date.now() + autoStopMs,
        autoStopTimer: setTimeout(() => stopSession('auto-stop'), autoStopMs),
        windowMs: autoStopMs,
      }
      // D-063: a companion phone may ask this window to look. D-099: and is told when it stops itself.
      ctx.sendToBackend({ type: 'session_state', live: true, stopsInMs: autoStopMs, windowMs: autoStopMs })
      previousGate = null
      const label = describeTrack(track)
      status = { text: `Sharing ${label}. ${origin === 'button' ? 'Press Look when you want a reaction.' : ''}`.trim(), kind: 'ok' }
      syncTicker()
      return true
    } catch (err) {
      status = { text: explainMediaError(err), kind: err instanceof DOMException && err.name === 'NotAllowedError' ? 'info' : 'err' }
      disarmMediaKey()
      return false
    } finally {
      busy = false
      refresh()
    }
  }

  /** One click adds another full auto-stop window from now (plan-v2 §6). */
  function extendSession(): void {
    if (!session) return
    const autoStopMs = Math.max(1, settings().autoStopMinutes) * 60_000
    if (session.autoStopTimer) clearTimeout(session.autoStopTimer)
    session.autoStopAt = Date.now() + autoStopMs
    session.autoStopTimer = setTimeout(() => stopSession('auto-stop'), autoStopMs)
    session.windowMs = autoStopMs
    ctx.sendToBackend({ type: 'session_extended', stopsInMs: autoStopMs, windowMs: autoStopMs })
    status = { text: `Extended. The session now stops itself at ${new Date(session.autoStopAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`, kind: 'ok' }
    refresh()
  }

  /** Stop the share session and the webcam, whatever state they're in. */
  function stopEverything(reason: 'orphan' | 'pagehide'): void {
    stopSession(reason === 'orphan' ? 'destroy' : 'button', true)
    closeWebcam()
  }

  /** `gone`: the page itself is going away, so nobody is left to hear a curtain call (D-100). */
  function stopSession(reason: 'button' | 'ended' | 'auto-stop' | 'destroy', gone = false): void {
    if (!session) return
    const { stream, video, autoStopTimer } = session
    session = null
    if (!gone && reason !== 'destroy') sessionEndedAt = Date.now()
    ctx.sendToBackend({ type: 'session_state', live: false, reason: gone ? 'destroy' : reason })
    disarmMediaKey()
    if (autoStopTimer) clearTimeout(autoStopTimer)
    for (const t of stream.getTracks()) t.stop()
    video.pause()
    video.srcObject = null
    previousGate = null
    stopTicker()
    status =
      reason === 'ended'
        ? { text: 'Sharing was stopped from the browser. Session over.', kind: 'info' }
        : reason === 'auto-stop'
          ? { text: `Stopped by itself after ${settings().autoStopMinutes} minutes. Start again whenever you like. Change the length in Settings → Capture.`, kind: 'info' }
          : { text: 'Session stopped. Nothing is being shared.', kind: 'info' }
    if (reason !== 'destroy') refresh()
  }

  /** What the browser is actually delivering — so a GPU complaint can be read off the panel. */
  function describeStream(stream: MediaStream): string {
    const track = stream.getVideoTracks()[0]
    if (!track) return 'no video track'
    const st = track.getSettings()
    const size = st.width && st.height ? `${st.width}×${st.height}` : '?×?'
    const fps = typeof st.frameRate === 'number' ? `${Math.round(st.frameRate * 10) / 10} fps` : '? fps'
    const label = track.label ?? ''
    return `Stream: ${size} at ${fps}.${label ? ` The browser calls it "${label}".` : ''}`
  }

  function describeTrack(track: MediaStreamTrack | undefined): string {
    if (!track) return 'something'
    const settingsOf = track.getSettings() as MediaTrackSettings & { displaySurface?: string }
    const kind = settingsOf.displaySurface
    const size = settingsOf.width && settingsOf.height ? ` (${settingsOf.width}×${settingsOf.height})` : ''
    if (kind === 'monitor') return `a whole screen${size}`
    if (kind === 'window') return `a window${size}`
    if (kind === 'browser') return `a browser tab${size}`
    return `your screen${size}`
  }

  function explainMediaError(err: unknown, what = 'share the screen'): string {
    if (err instanceof DOMException) {
      switch (err.name) {
        case 'NotAllowedError':
          return 'Cancelled. Nothing was shared.'
        case 'NotFoundError':
          return 'The browser found nothing it could share.'
        case 'NotReadableError':
        case 'AbortError':
          return 'The browser could not read the screen. On macOS, check Screen Recording permission for your browser in System Settings.'
        default:
          return `Could not ${what}: ${err.name}${err.message ? ` (${err.message})` : ''}`
      }
    }
    return `Could not ${what}: ${err instanceof Error ? err.message : String(err)}`
  }

  // --- frames -----------------------------------------------------------------------

  function grab(video: HTMLVideoElement, s: CaptureSettings): Frame {
    if (!mainCtx || !thumbCtx || !gateCtx) throw new Error(CANVAS_MISSING)
    const { width, height } = fitWithin(video.videoWidth, video.videoHeight, s.maxEdge)
    if (width === 0 || height === 0) throw new Error('The shared window has no size yet. Try Look again.')
    mainCanvas.width = width
    mainCanvas.height = height
    mainCtx.drawImage(video, 0, 0, width, height)
    return encodeFromMainCanvas(s)
  }

  /** Everything after the main canvas has the frame: JPEG, thumbnail, gate sample. */
  function encodeFromMainCanvas(s: CaptureSettings): Frame {
    if (!mainCtx || !thumbCtx || !gateCtx) throw new Error(CANVAS_MISSING)
    const width = mainCanvas.width
    const height = mainCanvas.height
    const jpegB64 = dataUrlToBase64(mainCanvas.toDataURL('image/jpeg', s.jpegQuality))

    const thumb = fitWithin(width, height, s.thumbEdge)
    thumbCanvas.width = thumb.width
    thumbCanvas.height = thumb.height
    thumbCtx.drawImage(mainCanvas, 0, 0, thumb.width, thumb.height)
    const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.6)

    gateCtx.drawImage(mainCanvas, 0, 0, GATE_EDGE, GATE_EDGE)
    const gate = toGrey(gateCtx.getImageData(0, 0, GATE_EDGE, GATE_EDGE).data)

    return { jpegB64, thumbB64: dataUrlToBase64(thumbDataUrl), thumbDataUrl, width, height, gate }
  }

  /** D15: an alt-tab sized change, as opposed to the ordinary gate's "something moved". */
  function isShift(diff: number, threshold: number): boolean {
    // Alt-tab sized. Combat and camera swings in a fast game sit well under this.
    return diff >= Math.max(threshold * 8, 48)
  }

  function send(frame: Frame, source: CaptureSource, trigger: CaptureTrigger, talk?: string, shift = false): void {
    const payload: CapturePayload = {
      type: 'capture',
      source,
      trigger,
      ...(talk ? { talk } : {}),
      ...(shift ? { shift: true } : {}),
      jpegB64: frame.jpegB64,
      thumbB64: frame.thumbB64,
      width: frame.width,
      height: frame.height,
      declaredJpegBytes: base64ByteLength(frame.jpegB64),
      declaredThumbBytes: base64ByteLength(frame.thumbB64),
      capturedAt: Date.now(),
      localTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    lastSentAt = payload.capturedAt
    lastRoundTripMs = null
    lastThumbDataUrl = frame.thumbDataUrl
    counters.sent += 1
    awaitingReaction = trigger !== 'test'
    if (awaitingReaction) {
      working = talk ? 'Sending your line with a fresh Look…' : 'Looking…'
      partialLines = []
      lastProgressAt = Date.now()
    }
    ctx.sendToBackend(payload)
  }

  async function look(trigger: CaptureTrigger, talk?: string): Promise<void> {
    if (busy || !support.screen) return
    if (trigger === 'tick') counters.ticks += 1
    // One reaction at a time. Sending another frame now would only come back
    // "already reacting" — and its quick answer used to clear the "thinking"
    // state of the one still being written.
    if (isAwaiting()) {
      if (trigger !== 'tick') {
        status = { text: `Still on the last Look: ${working ?? 'waiting for the reaction…'}`, kind: 'info' }
        refresh()
      }
      return
    }
    const s = settings()
    if (trigger === 'tick') {
      // D16: speaking is a pacing gate — no automatic Look while the character
      // speaks, nor for one cooldown after.
      const hold = deps.voice?.tickHold()
      if (hold) {
        status = { text: `Holding the automatic Look: ${hold}.`, kind: 'info' }
        refresh()
        return
      }
    }

    try {
      if (s.captureMode === 'paranoid') {
        // Picker per glance, zero standing access.
        busy = true
        status = { text: 'Choose what to share for this one Look…', kind: 'info' }
        refresh()
        const { stream, video } = await openStream(s)
        try {
          const frame = grab(video, s)
          send(frame, 'screen', trigger, talk)
          status = { text: 'Sent one picture. Nothing is being shared now.', kind: 'ok' }
        } finally {
          for (const t of stream.getTracks()) t.stop()
          video.srcObject = null
        }
        return
      }

      if (!session) {
        const ok = await startSession('look')
        if (!ok || !session) return
      }
      busy = true
      refresh()
      const frame = grab(session.video, s)

      const verdict = frameChanged(previousGate, frame.gate, s.changeThreshold)
      const shift = previousGate !== null && isShift(verdict.diff, s.changeThreshold)
      if (trigger === 'tick') {
        previousGate = frame.gate
        if (!verdict.changed) {
          counters.skipped += 1
          status = { text: `The screen barely changed (${verdict.diff.toFixed(1)} against a threshold of ${s.changeThreshold}). Skipped.`, kind: 'info' }
          return
        }
        status = { text: `The screen changed (${verdict.diff.toFixed(1)}). Sent.`, kind: 'ok' }
      } else {
        previousGate = frame.gate
        status = { text: `Sent a ${frame.width}×${frame.height} picture.`, kind: 'ok' }
      }
      send(frame, 'screen', trigger, talk, shift)
    } catch (err) {
      counters.failed += 1
      status = { text: explainMediaError(err), kind: 'err' }
    } finally {
      busy = false
      refresh()
    }
  }

  /**
   * A frame with no screen behind it: a gradient, a timestamp, and enough
   * film grain to make the JPEG as large as a busy real frame. That makes the
   * test button a real S1 check rather than a 20 KB cheat.
   */
  async function sendSyntheticFrame(): Promise<void> {
    if (busy) return
    busy = true
    refresh()
    try {
      if (!mainCtx) throw new Error(CANVAS_MISSING)
      const s = settings()
      const { width, height } = fitWithin(1920, 1080, s.maxEdge)
      mainCanvas.width = width
      mainCanvas.height = height

      const gradient = mainCtx.createLinearGradient(0, 0, width, height)
      gradient.addColorStop(0, '#2b1a4d')
      gradient.addColorStop(0.5, '#0f5a63')
      gradient.addColorStop(1, '#c0532b')
      mainCtx.fillStyle = gradient
      mainCtx.fillRect(0, 0, width, height)

      // Grain. Random noise is incompressible, so this sets the payload size.
      const image = mainCtx.getImageData(0, 0, width, height)
      const d = image.data
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 70
        d[i] = Math.max(0, Math.min(255, d[i] + n))
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
      }
      mainCtx.putImageData(image, 0, 0)

      mainCtx.fillStyle = 'rgba(255,255,255,0.92)'
      mainCtx.font = `bold ${Math.round(height / 12)}px system-ui, sans-serif`
      mainCtx.textAlign = 'center'
      mainCtx.fillText('Houselights test picture', width / 2, height / 2)
      mainCtx.font = `${Math.round(height / 28)}px system-ui, sans-serif`
      mainCtx.fillText(new Date().toLocaleString(), width / 2, height / 2 + height / 10)

      const frame = encodeFromMainCanvas(s)
      send(frame, 'synthetic', 'test')
      status = { text: `Sent a ${frame.width}×${frame.height} test picture (${formatBytes(base64ByteLength(frame.jpegB64))}). Waiting for it to arrive…`, kind: 'info' }
    } catch (err) {
      counters.failed += 1
      status = { text: `Could not send the test picture: ${err instanceof Error ? err.message : String(err)}`, kind: 'err' }
    } finally {
      busy = false
      refresh()
    }
  }

  // --- other eyes: webcam, phone camera, pictures ----------------------------------------

  function setOtherStatus(text: string, kind: 'info' | 'ok' | 'err'): void {
    if (kind === 'err') otherLines.fail(text)
    else otherLines.status(text)
  }

  async function openWebcam(): Promise<void> {
    if (webcam || busy) return
    busy = true
    setOtherStatus('Asking for the webcam…', 'info')
    refresh()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      const video = el('video', { className: 'hl-preview', muted: true, playsInline: true, autoplay: true })
      video.srcObject = stream
      await video.play()
      await waitForFrames(video, 5000)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => closeWebcam())
      webcam = { stream, video }
      webcamPreview.replaceChildren(video)
      setOtherStatus('Webcam on. Press Snap to send one photo. The camera switches off straight after.', 'info')
    } catch (err) {
      setOtherStatus(explainMediaError(err, 'open the webcam').replace('the screen', 'the webcam'), 'err')
    } finally {
      busy = false
      refresh()
    }
  }

  function closeWebcam(): void {
    if (!webcam) return
    for (const t of webcam.stream.getTracks()) t.stop()
    webcam.video.pause()
    webcam.video.srcObject = null
    webcam = null
    webcamPreview.replaceChildren()
    refresh()
  }

  async function snapWebcam(): Promise<void> {
    if (!webcam || busy) return
    if (isAwaiting()) {
      setOtherStatus(`Still on the last Look: ${working ?? 'waiting for the reaction…'} Snap again when the reaction arrives.`, 'info')
      return
    }
    busy = true
    refresh()
    try {
      const frame = grab(webcam.video, settings())
      // Release the camera first, then send: the light goes off the instant
      // the photo is taken, whatever the backend does next.
      closeWebcam()
      send(frame, 'webcam', 'look')
      status = { text: `Sent a ${frame.width}×${frame.height} webcam photo.`, kind: 'ok' }
      setOtherStatus('Photo sent. Webcam off.', 'ok')
    } catch (err) {
      counters.failed += 1
      setOtherStatus(`Could not send the photo: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      busy = false
      refresh()
    }
  }

  async function choosePicture(): Promise<void> {
    if (busy) return
    // Spindle's own picker when the host has it; a plain input otherwise.
    if (typeof ctx.uploads?.pickFile === 'function') {
      try {
        const files = await ctx.uploads.pickFile({ accept: ['image/*'], maxSizeBytes: 25 * 1024 * 1024 })
        const file = files[0]
        if (!file) return
        const bytes = new Uint8Array(file.bytes)
        await sendImageBlob(new Blob([bytes], { type: file.mimeType || 'image/*' }), 'file')
      } catch (err) {
        setOtherStatus(`Could not open the picture: ${err instanceof Error ? err.message : String(err)}`, 'err')
        refresh()
      }
      return
    }
    pictureInput.click()
  }

  /** Decode an image file, honouring EXIF orientation, and send it like any other frame. */
  async function sendImageBlob(blob: Blob, source: 'camera' | 'file'): Promise<void> {
    if (busy) return
    if (isAwaiting()) {
      setOtherStatus(`Still on the last Look: ${working ?? 'waiting for the reaction…'} Send the picture again when the reaction arrives.`, 'info')
      return
    }
    busy = true
    setOtherStatus('Reading the picture…', 'info')
    refresh()
    try {
      if (!mainCtx) throw new Error(CANVAS_MISSING)
      const image = await decodeImage(blob)
      const { width, height } = fitWithin(image.width, image.height, settings().maxEdge)
      if (width === 0 || height === 0) throw new Error('That file is not a picture.')
      mainCanvas.width = width
      mainCanvas.height = height
      mainCtx.drawImage(image.source, 0, 0, width, height)
      image.release()
      const frame = encodeFromMainCanvas(settings())
      send(frame, source, 'look')
      status = { text: `Sent a ${frame.width}×${frame.height} ${source === 'camera' ? 'photo' : 'picture'}.`, kind: 'ok' }
      setOtherStatus(source === 'camera' ? 'Photo sent.' : 'Picture sent.', 'ok')
    } catch (err) {
      counters.failed += 1
      setOtherStatus(`Could not use that picture: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      busy = false
      refresh()
    }
  }

  async function decodeImage(
    blob: Blob,
  ): Promise<{ source: CanvasImageSource; width: number; height: number; release(): void }> {
    // createImageBitmap applies the EXIF rotation phones write; the <img>
    // fallback is for browsers without it (older Safari).
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
      } catch {
        // Fall through to the <img> path.
      }
    }
    const url = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = () => reject(new Error('The browser could not read that picture.'))
        i.src = url
      })
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
    } catch (err) {
      URL.revokeObjectURL(url)
      throw err
    }
  }

  // --- the tick (D-018) ------------------------------------------------------------

  function syncTicker(): void {
    const s = settings()
    const wanted = session !== null && s.captureMode === 'continuous'
    const intervalMs = Math.max(1, s.cadenceSeconds) * 1000
    if (!wanted) {
      stopTicker()
      return
    }
    if (ticker && ticker.intervalMs === intervalMs) return
    stopTicker()
    startTicker(intervalMs)
  }

  function startTicker(intervalMs: number): void {
    try {
      const url = URL.createObjectURL(new Blob([TICK_WORKER_SOURCE], { type: 'text/javascript' }))
      const worker = new Worker(url)
      worker.onmessage = (event: MessageEvent) => {
        if (event.data?.type === 'tick') void look('tick')
      }
      worker.onerror = () => {
        // Most likely a Content-Security-Policy that forbids blob: workers.
        // Lumiverse's own page allows them, but a reverse proxy might not.
        stopTicker()
        startMainThreadTicker(intervalMs)
        refresh()
      }
      worker.postMessage({ type: 'start', intervalMs })
      ticker = { kind: 'worker', worker, url, intervalMs }
    } catch {
      startMainThreadTicker(intervalMs)
    }
    refresh()
  }

  function startMainThreadTicker(intervalMs: number): void {
    ticker = { kind: 'main', timer: setInterval(() => void look('tick'), intervalMs), intervalMs }
  }

  function stopTicker(): void {
    if (!ticker) return
    if (ticker.kind === 'worker') {
      ticker.worker.postMessage({ type: 'stop' })
      ticker.worker.terminate()
      URL.revokeObjectURL(ticker.url)
    } else {
      clearInterval(ticker.timer)
    }
    ticker = null
  }

  // --- public surface -------------------------------------------------------------------

  return {
    look,
    backPanel: (id) => back[id],
    isLive: () => session !== null,
    justEnded: () => session === null && sessionEndedAt > 0 && Date.now() - sessionEndedAt < CURTAIN_WINDOW_MS,
    onHush() {
      renderHushButton()
      renderQuick()
    },
    refreshVoice() {
      renderVoice()
      renderQuick()
      renderChat()
      void renderPermissions()
    },
    onReceipt(receipt) {
      lastReceipt = receipt
      if (receipt.ok) counters.received += 1
      else counters.failed += 1
      if (receipt.capturedAt && receipt.capturedAt === lastSentAt) {
        lastRoundTripMs = Math.max(0, Date.now() - lastSentAt)
      }
      if (receipt.ok && status.text.endsWith('Waiting for the backend…')) {
        status = { text: 'The test picture arrived.', kind: 'ok' }
      }
      refresh()
    },
    async talk(text, withLook) {
      const line = text.trim()
      if (!line) return
      if (withLook) {
        // D-063: a companion phone has no screen; the computer takes the look and sends the line.
        if (companionOn()) {
          remoteLookFor(line)
          return
        }
        await look('talk', line)
        return
      }
      awaitingReaction = true
      working = 'Sending your line…'
      partialLines = []
      lastProgressAt = Date.now()
      status = { text: 'Sent your line. Waiting for the reaction…', kind: 'info' }
      refresh()
      ctx.sendToBackend({ type: 'talk', text: line })
    },
    pressLook,
    isPhone: () => phone,
    isCompanion: () => companionOn(),
    remoteLook: (talk) => remoteLookFor(talk),
    onCompanionFrame(frame) {
      // This window's own frame needs no echo; a phone not following the computer ignores it.
      if (!companionOn() || awaitingReaction) return
      clearRemoteLookTimer()
      remoteAsked = false
      lastThumbDataUrl = `data:image/jpeg;base64,${frame.thumbB64}`
      companionSince = Date.now()
      refresh()
    },
    onCompanionReaction(result) {
      if (!companionOn()) return
      companionSince = 0
      // Shown, never spoken: the window that asked speaks it (D-060). This phone's own
      // reaction arrives as its reply first; the echo changes nothing.
      if (!awaitingReaction) lastReaction = result
      refresh()
    },
    onRemoteLookRequest(request) {
      // Only the window that is sharing answers; the phone itself never does.
      if (phone) return
      const decline = (text: string) => ctx.sendToBackend({ type: 'remote_look_answer', ok: false, text })
      // Not sharing: stay quiet. Where the host can't address one window, every window hears the
      // request, and a "not sharing" from this one would contradict the one that is. The backend
      // already answers when nothing is sharing, and the phone gives up after 10 s.
      if (!session) return
      if (busy || isAwaiting()) return decline('Your computer is still on the last Look. Try again when that reaction arrives.')
      void look(request.talk ? 'talk' : 'look', request.talk)
    },
    onCompanionSession(live, stop) {
      if (!companionOn()) return
      // D-099: when the computer's session stops itself, by this device's clock.
      remoteStop = live && stop ? { at: Date.now() + stop.stopsInMs, windowMs: stop.windowMs } : null
      // The failure a phone was told is out of date the moment the computer starts sharing.
      if (live && status.kind === 'err') {
        status = { text: 'Your computer is sharing now.', kind: 'ok' }
        sessionLines.clearFailure()
      }
      refresh()
    },
    onRemoteExtendRequest() {
      // Only the window that is sharing answers; its own Extend does the rest.
      if (!phone && session) extendSession()
    },
    onRemoteLookResult(result) {
      if (!companionOn()) return
      if (result.ok) return // the frame arriving is the real answer; the timer covers silence
      clearRemoteLookTimer()
      remoteAsked = false
      companionSince = 0
      status = { text: result.text, kind: 'err' }
      refresh()
    },
    takePhoto() {
      if (busy) return
      if (isAwaiting()) {
        setOtherStatus(`Still on the last Look: ${working ?? 'waiting for the reaction…'} Take the photo when the reaction arrives.`, 'info')
        return
      }
      cameraInput.click()
    },
    choosePicture() {
      void choosePicture()
    },
    onProgress(progress) {
      if (!awaitingReaction) return // a reply we already gave up on, or one for another window's frame
      working = progressText(progress)
      if (progress.lines) partialLines = progress.lines
      lastProgressAt = Date.now()
      refresh()
    },
    onReaction(result) {
      const mine = awaitingReaction
      awaitingReaction = false
      working = null
      partialLines = []
      lastReaction = result
      if (result.ok) counters.reactions += 1
      refresh()
      return mine
    },
    onChatState(state) {
      // D-086: a failure stays until it is dismissed or the chat changes.
      if ((state.chat?.id ?? null) !== (chat.chat?.id ?? null)) {
        sessionLines.clearFailure()
        otherLines.clearFailure()
        reactionLines.clearFailure()
      }
      chat = state
      renderChat()
      renderLookAction()
      refresh()
    },
    onWatching(state) {
      watchingState = { confirmed: state.confirmed ?? null, candidate: state.candidate ?? null, lastConfirmed: state.lastConfirmed ?? null, doubt: state.doubt ?? null }
      renderWatching()
      renderChat() // D18's "nothing confirmed yet" line depends on it.
      refresh()
    },
    onLookupStatus(next) {
      lookupStatus = next
      renderChat()
    },
    confirmWatching(text) {
      ctx.sendToBackend({ type: 'confirm_watching', text })
    },
    setStance(stance, custom) {
      if (!chat.chat) return
      ctx.sendToBackend({ type: 'set_stance', chatId: chat.chat.id, stance, ...(typeof custom === 'string' ? { custom } : {}) })
    },
    dismissWatching() {
      ctx.sendToBackend({ type: 'dismiss_watching' })
    },
    onSettings() {
      renderSettings()
      renderWatching()
      syncTicker()
      refresh()
    },
    stop() {
      stopSession('button')
    },
    extend() {
      // D-099: a phone following the computer asks the computer for more time.
      if (companionOn()) ctx.sendToBackend({ type: 'remote_extend' })
      else extendSession()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot,
    destroy() {
      mediaKey.destroy()
      listeners.clear()
      stopSession('destroy')
      closeWebcam()
      window.removeEventListener('pagehide', onPageHide)
      clearOrphanGuard()
      stopTicker()
      clearInterval(clock)
      unsubLookClick()
      unsubComposer()
      lookAction.destroy()
      for (const sc of [staticScope, settingsScope, chatScope, quickScope, deviceScope, webScope]) sc.reset()
      tab.destroy()
      removeStyle()
    },
  }
}

// ---------------------------------------------------------------------------
// Orphan guard — a share session must never outlive the code that started it
// ---------------------------------------------------------------------------

/**
 * If the extension is reloaded (an update, a reinstall, a disable/enable)
 * without the host calling our teardown, the old instance's MediaStream keeps
 * capturing with nobody to stop it — the browser's "sharing" indicator stays
 * on and the GPU keeps working. So every live stream registers a stop
 * function on `window`, and a fresh instance stops whatever it finds there
 * before starting its own.
 */
const ORPHAN_KEY = '__houselightsStop'

function registerOrphanGuard(stop: () => void): void {
  const w = window as Window & { [ORPHAN_KEY]?: () => void }
  w[ORPHAN_KEY] = stop
}

function clearOrphanGuard(): void {
  const w = window as Window & { [ORPHAN_KEY]?: () => void }
  delete w[ORPHAN_KEY]
}

/** Called once at setup: stop a previous instance's leftovers, if any. */
export function stopOrphanedCapture(): boolean {
  const w = window as Window & { [ORPHAN_KEY]?: () => void }
  const stop = w[ORPHAN_KEY]
  if (typeof stop !== 'function') return false
  try {
    stop()
  } catch {
    // The old instance is gone; its closure may throw. We tried.
  }
  delete w[ORPHAN_KEY]
  return true
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

function detectEnvironment(ctx: SpindleFrontendContext): CaptureEnvironment {
  const capabilities = ctx.host?.capabilities ?? {}
  let clientKind: CaptureEnvironment['clientKind'] = 'unknown'
  let platform = 'unknown'
  let isMobile: boolean | null = null
  if (ctx.client && (capabilities['client-info-v1'] ?? 0) >= 1) {
    try {
      const info = ctx.client.getInfo()
      clientKind = info.kind
      platform = info.platform
      isMobile = info.isMobile === true
    } catch {
      // Older host without the API — fall through to the browser sniff.
    }
  }
  if (clientKind === 'unknown') {
    const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }
    if (w.__TAURI_INTERNALS__ || w.__TAURI__) clientKind = 'desktop'
    else clientKind = 'browser'
  }
  return {
    isSecureContext: window.isSecureContext,
    hasGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    clientKind,
    platform,
    isMobile: isMobile ?? (clientKind === 'mobile' || isMobileUserAgent(navigator.userAgent ?? '')),
    desktopCaptureCapability: Number(capabilities['desktop-capture-worker-v1'] ?? 0),
    hasDocumentPictureInPicture: 'documentPictureInPicture' in window,
  }
}
