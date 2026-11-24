/**
 * Capture helpers — the parts of the capture layer that have no DOM in them.
 *
 * Kept separate from the frontend so they can be unit-tested in Bun with no
 * browser. Everything that touches <video>, <canvas> or getDisplayMedia lives
 * in capture-tab.ts; everything here is arithmetic on plain numbers and
 * strings.
 */

// ---------------------------------------------------------------------------
// Settings — plan-v2 §12, the client-side ones
// ---------------------------------------------------------------------------

export type CaptureMode = 'on-demand' | 'continuous' | 'paranoid'
export type MonitorSurfaces = 'allow' | 'exclude'

export interface CaptureSettings {
  /** `on-demand`: Start once, Look many. `continuous`: Look on a timer. `paranoid`: picker per Look. */
  captureMode: CaptureMode
  /** Seconds between automatic Looks in continuous mode. */
  cadenceSeconds: number
  /** Mean absolute grey difference (0–255) a frame must clear to be sent in continuous mode. */
  changeThreshold: number
  /** A live session ends itself after this long. */
  autoStopMinutes: number
  /** Longest edge of the frame that leaves the browser. */
  maxEdge: number
  /** JPEG quality, 0–1. */
  jpegQuality: number
  /** Longest edge of the thumbnail shown in the panel and kept with the beat. */
  thumbEdge: number
  /** Hide the Lumiverse tab from the share picker (Chromium hint). */
  excludeSelf: boolean
  /** Whether whole-monitor sharing is offered in the picker (Chromium hint). */
  monitorSurfaces: MonitorSurfaces
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  captureMode: 'on-demand',
  cadenceSeconds: 5,
  changeThreshold: 6,
  autoStopMinutes: 30,
  maxEdge: 1280,
  jpegQuality: 0.7,
  thumbEdge: 320,
  excludeSelf: true,
  monitorSurfaces: 'allow',
}

/** Edge length of the greyscale comparison square used by the change gate. */
export const GATE_EDGE = 32

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Scale `width × height` down so its longest edge is at most `maxEdge`,
 * keeping the aspect ratio. Never scales up. Never returns a zero dimension
 * for non-zero input.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (!(maxEdge > 0) || longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) }
  }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// ---------------------------------------------------------------------------
// Change gate
// ---------------------------------------------------------------------------

/** RGBA pixels → one grey byte per pixel (Rec. 601 luma, same as the Eyes used). */
export function toGrey(rgba: ArrayLike<number>): Uint8Array {
  const pixels = Math.floor(rgba.length / 4)
  const out = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    const o = i * 4
    out[i] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2])
  }
  return out
}

/**
 * Mean absolute difference between two grey frames, 0–255. Frames of
 * different sizes are treated as completely different (255), because that
 * only happens when the shared surface changed shape, which is a change.
 */
export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || b.length === 0) return 255
  if (a.length !== b.length) return 255
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/**
 * The gate decision. The first frame of a session always passes (there is
 * nothing to compare against). A threshold of 0 disables the gate.
 */
export function frameChanged(
  previous: ArrayLike<number> | null,
  current: ArrayLike<number>,
  threshold: number,
): { changed: boolean; diff: number } {
  if (!previous) return { changed: true, diff: 255 }
  if (threshold <= 0) return { changed: true, diff: meanAbsDiff(previous, current) }
  const diff = meanAbsDiff(previous, current)
  return { changed: diff >= threshold, diff }
}

// ---------------------------------------------------------------------------
// Payload accounting — for the S1 runtime check
// ---------------------------------------------------------------------------

/** Decoded byte length of a base64 string, without decoding it. */
export function base64ByteLength(b64: string): number {
  if (!b64) return 0
  let padding = 0
  if (b64.endsWith('==')) padding = 2
  else if (b64.endsWith('=')) padding = 1
  return Math.floor((b64.length * 3) / 4) - padding
}

/** Strip the `data:image/jpeg;base64,` prefix from a data URL. */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

/** Human-readable size: 287 KB, 1.2 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// The wire format — frontend → backend
// ---------------------------------------------------------------------------

/**
 * Where a frame came from. `screen` is a share session; `webcam` a desktop
 * snap; `camera` the phone's camera app via a file input; `file` any image
 * from disk; `synthetic` the drawn test frame.
 */
export type CaptureSource = 'screen' | 'webcam' | 'camera' | 'file' | 'synthetic'

export const CAPTURE_SOURCES: readonly CaptureSource[] = ['screen', 'webcam', 'camera', 'file', 'synthetic']

export function isCaptureSource(value: unknown): value is CaptureSource {
  return typeof value === 'string' && (CAPTURE_SOURCES as readonly string[]).includes(value)
}
export type CaptureTrigger = 'look' | 'tick' | 'test' | 'talk'

export interface CapturePayload {
  type: 'capture'
  source: CaptureSource
  trigger: CaptureTrigger
  /** Base64 JPEG, no data-URL prefix, already downscaled to `maxEdge`. */
  jpegB64: string
  /** Base64 JPEG thumbnail at `thumbEdge`. */
  thumbB64: string
  width: number
  height: number
  /** Decoded byte lengths as the frontend measured them — the backend compares. */
  declaredJpegBytes: number
  declaredThumbBytes: number
  capturedAt: number
  /** Talk-back (D14), "Send + look": the user's line, sent with the frame it goes with. */
  talk?: string
  /** D15: the change gate saw a large shift (alt-tab sized), so a re-guess is allowed. */
  shift?: boolean
  /**
   * The wall-clock time as the browser shows it ("11:36 PM"). The backend may
   * run in another timezone, and the beat's timestamp should match the chat's.
   */
  localTime?: string
}

/** What the backend sends back so the panel can show "arrived intact". */
export interface CaptureReceipt {
  type: 'capture_received'
  ok: boolean
  error?: string
  source?: CaptureSource
  trigger?: CaptureTrigger
  width?: number
  height?: number
  measuredJpegBytes?: number
  measuredThumbBytes?: number
  declaredJpegBytes?: number
  /** True when the measured and declared sizes match — S1's runtime answer. */
  intact?: boolean
  capturedAt?: number
  receivedAt?: number
}

// ---------------------------------------------------------------------------
// Capability detection — plan-v2 §4 "secure context" and "Tauri wrapper"
// ---------------------------------------------------------------------------

export interface CaptureEnvironment {
  isSecureContext: boolean
  hasGetDisplayMedia: boolean
  /** `getUserMedia` — the desktop webcam. Also absent on plain http. */
  hasGetUserMedia: boolean
  /** From `ctx.client.getInfo().kind`, or `'unknown'` on hosts without client-info-v1. */
  clientKind: 'browser' | 'pwa' | 'desktop' | 'mobile' | 'unknown'
  /**
   * D-055: a phone or tablet (`getInfo().isMobile`, else the user agent). Phones
   * get the tab with Other eyes first and the widget's camera-first phone mode.
   */
  isMobile?: boolean
  platform: string
  /** `ctx.host.capabilities['desktop-capture-worker-v1']`, 0 when absent. */
  desktopCaptureCapability: number
  /**
   * Document Picture-in-Picture (`window.documentPictureInPicture`): an
   * always-on-top window a page can render into. Chrome/Edge 116+. Release-two
   * spike R1; the Pane may live there.
   */
  hasDocumentPictureInPicture: boolean
}

/**
 * What a display track's `label` looks like. Chromium gives opaque ids
 * (`window:123:0`, `screen:0:0`, `web-contents-media-stream://6:8`); Firefox
 * has given window titles; Safari gives ''. Spike R2 for D15 layer 1: a title
 * is a candidate for the "Watching:" chip, an id is not.
 */
export function classifyTrackLabel(label: string): 'empty' | 'opaque-id' | 'title' {
  const trimmed = label.trim()
  if (!trimmed) return 'empty'
  if (/^(window|screen|monitor|web-contents|browser|tab)[:\-]/i.test(trimmed)) return 'opaque-id'
  if (/^[a-z-]+:\/\//i.test(trimmed)) return 'opaque-id'
  // A long run of characters with no space is a handle, not a title.
  if (/^\S{20,}$/.test(trimmed)) return 'opaque-id'
  return 'title'
}

/**
 * D15 layer 1: a track label that looks like a title, with the browser's own
 * suffix (" — Mozilla Firefox", " - Google Chrome") taken off. Null for ids
 * and empties. This is a *candidate*: it is shown to the user before anything
 * uses it, never sent raw.
 */
export function titleCandidate(label: string): string | null {
  if (classifyTrackLabel(label) !== 'title') return null
  let title = label.trim()
  title = title.replace(/\s+[—–-]\s+(Mozilla Firefox|Firefox|Google Chrome|Chromium|Microsoft\s?Edge|Brave|Opera|Vivaldi)\s*$/i, '').trim()
  title = title.slice(0, 80).trim()
  return title || null
}

/** D15: what Houselights thinks is being watched, and what the user has agreed to. */
export interface WatchingState {
  type?: 'watching_state'
  /** The confirmed (or typed) name. The only text that ever reaches the model. */
  confirmed: string | null
  /** A guess awaiting ✓ / edit / ✕. */
  candidate: { text: string; source: 'label' | 'vision'; confidence: number } | null
  /**
   * D-099: the name that was in use until its session ended or the screen stopped matching.
   * Never sent; the chip asks "Still <name>?" about it.
   */
  lastConfirmed?: string | null
  /** D-099: why it is being asked about: the session ended, or the screen said no twice. */
  doubt?: 'session' | 'screen' | null
}

/** D-099: what the strip and the toolbar say about Watching: the name, or "?" while a question is open. */
export function watchingLine(w: WatchingState): string {
  if (w.confirmed) return `Watching: ${w.confirmed}`
  return w.candidate || w.lastConfirmed ? 'Watching: ?' : ''
}

/** D-099: the warning shows for the last two minutes of a session, or its last half if it is shorter than four. */
export const STOP_WARNING_MS = 120_000
export function stopWarningMs(windowMs: number): number {
  return Math.min(STOP_WARNING_MS, Math.floor(windowMs / 2))
}
/** "Stops in 1:42", or '' when there is nothing to warn about right now. */
export function stopWarningText(autoStopAt: number | null | undefined, stopWarnAt: number | null | undefined, now: number): string {
  if (!autoStopAt || !stopWarnAt || now < stopWarnAt || now >= autoStopAt) return ''
  const secs = Math.ceil((autoStopAt - now) / 1000)
  return `Stops in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

export interface CaptureSupport {
  /** Whether the Start / Look buttons should be offered at all. */
  screen: boolean
  /** One plain sentence for the panel when `screen` is false, or a short note when true. */
  note: string
}

/** The eye on the input bar's Look action. (The tab and the phone's disc use HOUSELIGHTS_ICON, D-077.) */
export const EYE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
  <circle cx="12" cy="12" r="3"/></svg>`

/**
 * D-077: Houselights' own mark — popcorn — for the sidebar tab and the phone's
 * folded disc. Lucide's "popcorn" (lucide-static 0.460.0, ISC; credited in the
 * README). The input bar's Look keeps the eye: that button is about looking.
 */
export const HOUSELIGHTS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a2 2 0 0 0 0-4 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0 0 4"/>
  <path d="M10 22 9 8"/><path d="m14 22 1-14"/>
  <path d="M20 8c.5 0 .9.4.8 1l-2.6 12c-.1.5-.7 1-1.2 1H7c-.6 0-1.1-.4-1.2-1L3.2 9c-.1-.6.3-1 .8-1Z"/></svg>`

/** D-055: a phone or tablet by its user agent, for hosts without client-info-v1. */
export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
}

export function describeSupport(env: CaptureEnvironment): CaptureSupport {
  if (!env.isSecureContext) {
    return {
      screen: false,
      note:
        'Sharing your screen needs a secure page (https or localhost). This page is plain http, so ' +
        'the browser does not offer it. Take a photo and Choose a picture still work here.',
    }
  }
  if (!env.hasGetDisplayMedia) {
    if (env.clientKind === 'mobile' || env.clientKind === 'pwa') {
      return {
        screen: false,
        note: 'Phones and tablets cannot share their screen to a web page. Use the camera instead.',
      }
    }
    if (env.clientKind === 'desktop') {
      return {
        screen: false,
        note:
          'This Lumiverse desktop app cannot share your screen. Open Lumiverse in ' +
          'a browser (Chrome, Edge, Firefox or Safari) to use Look.',
      }
    }
    return {
      screen: false,
      note: 'This browser cannot share your screen. Try Chrome, Edge, Firefox or Safari.',
    }
  }
  if (env.clientKind === 'desktop') {
    return {
      screen: true,
      note:
        'You are in the Lumiverse desktop app. Sharing your screen works here on Windows and, ' +
        'unofficially, on macOS. If the share dialog misbehaves, open Lumiverse in a browser.',
    }
  }
  return { screen: true, note: '' }
}

// ---------------------------------------------------------------------------
// Web Worker tick — D-018
// ---------------------------------------------------------------------------

/**
 * Source of the tick worker. Lives here as a string so it can be checked in
 * tests and so the frontend can build it into a Blob URL. It does nothing but
 * post `{ type: 'tick', at }` on an interval; all the real work happens on
 * the main thread, which keeps the worker trivially auditable.
 */
export const TICK_WORKER_SOURCE = `
let timer = null;
self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'start') {
    if (timer !== null) clearInterval(timer);
    const ms = Math.max(250, Number(msg.intervalMs) || 5000);
    timer = setInterval(() => self.postMessage({ type: 'tick', at: Date.now() }), ms);
  } else if (msg.type === 'stop') {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
};
`.trim()

// ---------------------------------------------------------------------------
// The wire format — backend → frontend, Phase 2
// ---------------------------------------------------------------------------

/** `look`/`tick` come from the capture tab; `manual` is the text test button. */
export type ReactionTrigger = 'look' | 'tick' | 'manual' | 'talk' | 'after-hush' | 'curtain-call'

export type ReactionSkipReason =
  | 'no-chat'
  | 'chat-off'
  | 'busy'
  | 'already-reacting'
  | 'hush'
  | 'cooldown'
  | 'kind'
  | 'boring'
  | 'repeat'

export interface ReactionResult {
  type: 'reaction_result'
  ok: boolean
  trigger: ReactionTrigger
  /**
   * Nobody pressed anything. D-068: a hush ended; the sharing window reads it aloud.
   * D-100: a session ended; the window that was sharing reads it aloud.
   */
  origin?: 'after-hush' | 'curtain-call'
  /** The reaction, when ok. */
  text?: string
  /** The reply's message id, so the host can play it in the character's own voice (D16). */
  messageId?: string
  /** D18: the reaction had looked-up notes in front of it. `fresh` = searched now, else reused. */
  lookedUp?: { query: string; fresh: boolean }
  /** D-071: the prompt told it about a hush ('hush') or about holding back while you talked ('quiet'). */
  hushTold?: HushTold
  /** The scene description that was reacted to, when there was one. */
  scene?: string | null
  chatId?: string
  interest?: number
  kind?: string
  /** D15: what the vision model thought the app was, and how sure; for the status line. */
  app?: string | null
  appConfidence?: number
  /** D15: the confirmed name the character was told, if any. */
  watching?: string | null
  /** Box Seat (D13′): the parsed lines, one per speaker, when the chat is a box. */
  lines?: BoxLine[]
  /** Box Seat: who was asked to speak this Look, in order — to compare with `lines`. */
  boxOrder?: string[]
  /** D-057: the one viewer whose lines are read aloud, decided by the backend. null = everyone; absent = an older backend. */
  speakOnly?: string | null
  /** Why nothing was said, when it was a deliberate skip. */
  reason?: ReactionSkipReason
  detail?: Record<string, unknown>
  /** Why nothing was said, when something went wrong. */
  error?: string
}

/** One line from the box (D13′): who said it, what they said, and their card if they have one. */
export interface BoxLine {
  name: string
  text: string
  /** D-057: the viewer who said it (a card id or a council member id), so voice need not guess from the name. */
  viewerId?: string
  /** The line's message id, for voice (D16). */
  messageId?: string
  /** D18: this viewer's line had looked-up notes in front of it. */
  lookedUp?: boolean
  characterId: string | null
  /** A council member's avatar (R6), when the speaker has no card. */
  avatarUrl?: string | null
}

/** A viewer in the box: a group member card, or (R6) a council member seated by the roster block. */
export interface BoxViewerInfo {
  id: string
  name: string
  /** `card` = a member of the group chat; `council` = seated via the roster block (R6). */
  kind: 'card' | 'council'
  stance: Stance
  /** Council members only: false when not sitting in this chat's box. Absent = seated. */
  seated?: boolean
  /** This viewer's own Custom instruction, when one is picked for them. Absent = the chat's Custom text. */
  custom?: string
}

/** Which chat reactions would land in, and whether that chat has them on. */
/**
 * D17: the stance a chat's viewer takes. One shared base block (framing,
 * self-recognition, the confirmed Watching line) sits under every one of them.
 */
/** D-071: what a reaction's prompt said: a hush you pressed, or the quiet while you talked. */
export type HushTold = 'hush' | 'quiet'

export type Stance = 'heckler' | 'coach' | 'character' | 'custom'
/** A chat or viewer nobody has set a stance for reacts as themselves (changed from Heckler, 2026-11-15). */
export const DEFAULT_STANCE: Stance = 'character'

export const STANCES: ReadonlyArray<{ id: Stance; label: string; blurb: string }> = [
  { id: 'heckler', label: 'Heckler', blurb: 'Mocks what it sees, in a line or two. No help.' },
  { id: 'coach', label: 'Coach', blurb: 'Notices what you are doing and offers a pointer, without talking down.' },
  { id: 'character', label: 'In character', blurb: 'No act. The character is told what is on screen and reacts as themselves.' },
  { id: 'custom', label: 'Custom', blurb: 'Follows your own instruction, written under Custom instruction on the Who reacts card.' },
]
/**
 * D18″: does this stance, in this chat, get web notes? Look things up is the chat's own switch
 * (`chatChoice`), for every stance. A chat that has never been asked keeps what it had before
 * D18″: one switch for every chat (`legacySwitch`), which only Coach and Custom used.
 */
export function chatLooksUp(chatChoice: boolean | undefined, legacySwitch: boolean, stance: Stance): boolean {
  if (typeof chatChoice === 'boolean') return chatChoice
  return legacySwitch && (stance === 'coach' || stance === 'custom')
}
export function isStance(value: unknown): value is Stance {
  return value === 'heckler' || value === 'coach' || value === 'character' || value === 'custom'
}

export interface ChatState {
  type: 'chat_state'
  /** The chat reactions go to: the active chat, or the pinned one (D5 linked-chat mode). */
  chat: { id: string; name: string; characterId?: string | null; characterName?: string | null } | null
  enabled: boolean
  /** `follow` = today's Mode A; `pinned` = D5, reactions land in `chat` wherever the user is. */
  mode?: 'follow' | 'pinned'
  /** The chat the user is looking at (null on the home screen). Differs from `chat` when pinned. */
  activeChatId?: string | null
  /** Reactions appended to the pinned chat while the user was elsewhere. */
  newReactions?: number
  /** D17: this chat's stance (default In character since 2026-11-15) and its custom instruction, if any. */
  stance?: Stance
  customStance?: string
  /** D18″: Look things up is on in this chat (for a box: for at least one seated viewer). */
  lookUp?: boolean
  /** Box Seat (D13′): present when the watched chat is a group chat. */
  box?: {
    viewers: BoxViewerInfo[]
    /** The group's card mode. Merge carries every card through `assemble`; otherwise a seat brings its own (R8). `solo` for a solo chat. */
    cardMode: string
    /** R7: whether this host can stamp a line as its character (`chat-append-identity-v1`). */
    stamping: boolean
    /** A solo chat made a box by the council members sitting in it (D-052). */
    solo?: boolean
  }
  /**
   * A solo chat with no council member sitting in it yet, while council seating
   * is on: the members who could join, for the tab's tickboxes (D-052).
   */
  council?: BoxViewerInfo[]
}

/** One row of the watched chat's tail, as the Pane shows it (addendum §2 expanded state). */
export interface TailEntry {
  id: string
  /** `beat` = our hidden "saw:" note; `reaction` = our reply; the rest are the chat's own. */
  kind: 'beat' | 'reaction' | 'user' | 'character' | 'system'
  name: string
  /** Trimmed to a few hundred characters; the chat itself has the rest. */
  text: string
  /** Milliseconds since the epoch. */
  at: number
  hidden: boolean
  /** For beats: what was seen and through what. */
  beat?: { source?: string; scene: string | null; hushed?: boolean; quiet?: 'conversation' }
  /** The speaking member's card, when known (a box line, or a real member reply). */
  characterId?: string | null
  /** A council member's avatar (R6), when the speaker has no card. */
  avatarUrl?: string | null
  /** D18: this reply had looked-up notes in front of it. */
  lookedUp?: boolean
  /** D-071: what its prompt said about a hush or a quiet. */
  hushTold?: HushTold
}

/** D18: whether looking things up can work here, for the tab. */
export interface LookupStatus {
  type: 'lookup_status'
  /** The `web_search` permission is granted. */
  granted: boolean
  /** Lumiverse's own Web Search settings are switched on. Null when unknown (not granted, or the read failed). */
  enabled: boolean | null
  /** The last search this session: what was asked, how many notes came back, or why it failed. */
  last?: {
    query: string
    count: number
    /** How many of the notes are passages of the page itself rather than search snippets. */
    pages?: number
    /** Exactly what the Coach is handed, so it can be checked. */
    notes?: { title: string; text: string }[]
    at: number
    error?: string
  }
}

export interface TailPayload {
  type: 'tail'
  chatId: string | null
  chatName: string | null
  entries: TailEntry[]
}

/**
 * What the Pane (and anything else) can read off the capture engine: one
 * immutable snapshot per change, pushed to subscribers. Pure data, no DOM.
 */
/**
 * The backend's progress through one reaction, sent as it goes, so a long Box
 * Seat chain (four seats is four generations) shows who is writing instead of
 * looking like nothing happened.
 */
/**
 * D-063, desktop companion. Sent to every open window; only a phone in companion
 * mode acts on them.
 * - `companion_frame`: a frame some window sent (its thumbnail), as it arrives.
 * - `companion_reaction`: the reaction to it, once written.
 * - `remote_look_request`: (to the window that is sharing) a phone asked for a Look.
 * - `remote_look_result`: whether that could happen, in a line for the phone.
 */
export interface CompanionFrame {
  type: 'companion_frame'
  thumbB64: string
  width: number
  height: number
  source: string
  at: number
}
export interface CompanionReaction {
  type: 'companion_reaction'
  result: ReactionResult
}
export interface RemoteLookRequest {
  type: 'remote_look_request'
  talk?: string
}
export interface RemoteLookResult {
  type: 'remote_look_result'
  ok: boolean
  text: string
}

export interface ReactionProgress {
  type: 'reaction_progress'
  /** `seeing`: the vision model is reading the frame. `searching`: the Coach is looking something up. `writing`: a character is writing. */
  phase: 'seeing' | 'searching' | 'writing'
  /** Who is writing. */
  name?: string
  /** Box Seat: this seat's place in the order, from 1, and how many seats this Look asked for. */
  seat?: number
  of?: number
  /** Box Seat: the lines that have landed so far. */
  lines?: BoxLine[]
}

/** The progress in words, for the widget and the tab. */
export function progressText(p: Pick<ReactionProgress, 'phase' | 'name' | 'seat' | 'of'>): string {
  if (p.phase === 'seeing') return 'Reading the picture…'
  if (p.phase === 'searching') return 'Looking things up…'
  const who = p.name?.trim() || 'The character'
  if (p.seat && p.of && p.of > 1) return `${who} is ${p.seat > 1 ? 'answering' : 'writing'} (${p.seat} of ${p.of})…`
  return `${who} is writing…`
}

export interface EngineSnapshot {
  live: boolean
  busy: boolean
  /** Epoch ms, when live. */
  startedAt: number | null
  autoStopAt: number | null
  /** D-099: when the "Stops in m:ss · Extend" warning begins; null when no session is known. */
  stopWarnAt?: number | null
  /** The last frame that left the browser, as a data: URL thumbnail. */
  lastThumbDataUrl: string | null
  /** The newest reaction, or why there was none. */
  lastReaction: ReactionResult | null
  /** A frame is with the backend and a reaction may follow. */
  awaitingReaction: boolean
  /** While awaiting: what the backend is doing right now, in words ("Marlo is answering (2 of 4)…"). */
  working?: string | null
  /** While awaiting a Box Seat reaction: the lines that have already landed. */
  partialLines?: BoxLine[]
  chat: ChatState
  /** D15: the Watching chip's state. */
  watching: WatchingState
  /** Whether screen capture is possible here at all. */
  canCapture: boolean
  /** D-046: the next-track key belongs to Houselights right now. */
  mediaKeyHeld?: boolean
  /** A one-line status from the engine (what the tab shows under the buttons). */
  status: { text: string; kind: 'info' | 'ok' | 'err' }
}

// ---------------------------------------------------------------------------
// Model pickers — shared between the settings panel and the capture tab
// ---------------------------------------------------------------------------

/** A Lumiverse connection profile as the frontend sees it: one provider, one model. */
export interface ConnectionInfo {
  id: string
  name: string
  model: string
  isDefault: boolean
}

/** The config fields the capture tab's pickers read and write. */
export interface ReactionModelSettings {
  /** The prose model — the character's voice. null = the user's default connection. */
  connectionId: string | null
  visionMode: 'attach' | 'describe'
  /** The model with eyes, in describe mode. null = same as the prose model. */
  visionConnectionId: string | null
  /** D18, before D18″: the one switch every chat shared. Now only the default for a chat that has not been asked. */
  coachSearch?: boolean
  /** Open the Pane's pop-out window when a session starts. */
  popoutOnStart?: boolean
  /** D-046: while a session runs, the next-track media key takes a Look. */
  mediaKeyLook?: boolean
  /** Named Custom stance instructions, shared by every chat (D-050). */
  customPresets?: { name: string; text: string }[]
  /** D16: the speaker toggle. */
  voiceOut?: boolean
  /** D-054: per chat id, the one Box Seat viewer whose lines are spoken aloud. Absent = everyone. */
  boxSpeakers?: Record<string, string>
  /** The Pane (D-034). On unless the user turned it off. */
  showPane?: boolean
  showPaneMobile?: boolean
  /** D-063: on a phone, follow the computer: show what it sends, and ask it to look. Off by default. */
  companionPhone?: boolean
  portraitSizePct?: number
  portraitOpacityPct?: number
  /** D-059: the widget's text size, percent of normal. */
  paneTextPct?: number
  /** D-059: hide the last picture on the widget; the portraits stay. */
  paneHidePicture?: boolean
  /** D-059: show only the characters' lines on the widget. */
  paneLinesOnly?: boolean
  /** The tab's Models fold: open unless the user closed it. Superseded by `folds.models`, still read. */
  modelsOpen?: boolean
  /** The tab's folds, by id: true open, false closed. Absent = the fold's default. */
  folds?: Record<string, boolean>
}

/**
 * D-054 / D-057: the one Box Seat viewer read aloud, decided by the backend
 * with the config as saved at that moment, so every device obeys the same
 * choice — including one that loaded earlier or never got the box's roster.
 * A choice that no longer sits in the box means everyone (null).
 */
export function speakerOf(boxSpeakers: Record<string, string> | undefined, chatId: string, seated: ReadonlyArray<{ id: string }>): string | null {
  const chosen = boxSpeakers?.[chatId]
  return chosen && seated.some((v) => v.id === chosen) ? chosen : null
}
