/**
 * The Pane — release two, addendum §2, glance state.
 *
 * One float widget over the Lumiverse page (host DOM, `ui_panels`), or — on
 * browsers with Document Picture-in-Picture, which spike R1 showed stays on
 * top of a fullscreen game in Chrome, Edge and Firefox — the same DOM popped
 * out into an always-on-top window.
 *
 * It owns no state of its own. Everything it shows comes from the capture
 * engine's snapshots (`EngineSnapshot`, pushed by the capture tab on every
 * change) plus the hush state the frontend already tracks. Everything it does
 * (Look, Hush, Stop, Extend) is a call back into the same engine the tab uses,
 * so the two can never disagree.
 *
 * Glance: the glass (last thumbnail), the viewer's avatar, the newest reaction
 * as a caption, a status strip (LIVE + countdown, "Watching in: chat"), and
 * the controls. Expanded: the watched chat's tail under the glass (beats as
 * small "saw:" markers), Extend, "Open in Lumiverse"; a corner grip resizes
 * the widget. Talk-back (D14) comes next.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { DEFAULT_STANCE, HOUSELIGHTS_ICON, STANCES, stopWarningText, watchingLine, type EngineSnapshot, type Stance, type TailEntry, type TailPayload } from './capture.ts'
import type { ListenCallbacks, ListenPhase } from './voice.ts'
import { icon, type IconName } from './icons.ts'
import type { ComposerBridge } from './composer.ts'

export interface PaneHush {
  hushed: boolean
  source: 'button' | 'conversation' | null
  remainingMs: number
}

export interface PaneEngine {
  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void
  snapshot(): EngineSnapshot
  /** A Look button press: inside the click, so a session can start (and pop out) from it. */
  look(): void
  /** D-055, phone mode: open the camera app / pick a picture. Inside the click. */
  takePhoto?(): void
  choosePicture?(): void
  /** D-063: this phone follows the computer (desktop companion). */
  companion?(): boolean
  /** D-063: ask the computer to look. */
  remoteLook?(): void
  stop(): void
  extend(): void
  /** Talk-back (D14). `withLook` sends a fresh frame with the line. */
  talk(text: string, withLook: boolean): Promise<void>
  /** D15: the chip's answers. Empty text clears what's confirmed. */
  confirmWatching(text: string): void
  dismissWatching(): void
  /** D17: the watched chat's stance. */
  setStance(stance: Stance): void
}

/** Voice (D16), as the Pane sees it: a speaker toggle and a push-to-talk mic. */
export interface PaneVoice {
  /** The host can speak and `media` is granted: the speaker toggle renders. */
  canSpeak(): boolean
  voiceOut(): boolean
  setVoiceOut(on: boolean): void
  /** The host can listen and `media` is granted: the mic renders. */
  canListen(): boolean
  listening(): boolean
  /** Inside the click handler. False when it could not start. */
  listen(callbacks: ListenCallbacks): boolean
  cancelListening(): void
  stop(): void
  autoSend(): { enabled: boolean; delaySeconds: number }
}

export interface PaneDeps {
  ctx: SpindleFrontendContext
  engine: PaneEngine
  voice: PaneVoice
  /** Hush (true) or lift the hush (false) — said explicitly, so a stale view can never invert it. */
  onHush(hushed: boolean): void
  /** Absolute URL of a character's avatar — absolute, because the pop-out document has no base URL. */
  avatarUrl(characterId: string): string
  /**
   * D-055: a phone or tablet. Phone mode swaps Look (screen sharing, which phones
   * can't do) for Photo and Picture, and drops the send-and-look eye.
   */
  phone?: boolean
  /** The portrait's saved size (a share of the picture's height) and opacity, in percent. */
  portrait?(): { sizePct: number; opacityPct: number }
  /** D-059: text size (percent of the normal size) and the two corner toggles, as saved. */
  view?(): PaneView
  /** D-095: Lumiverse's chat box. With the widget's own box empty, Send + look sends what is typed there. */
  composer?: ComposerBridge
  /** D-095: open a chat by id; null when the host can't. */
  openChat?: ((chatId: string) => void) | null
  /** D-059: save a corner toggle. */
  setView?(changes: Partial<Pick<PaneView, 'hidePicture' | 'linesOnly'>>): void
}

export interface Pane {
  /** False when the host offers no float widgets (older host, or `ui_panels` not granted). */
  available: boolean
  setHush(hush: PaneHush): void
  /** The watched chat's tail, answered by the backend to `get_tail`. */
  setTail(tail: TailPayload): void
  /** Redraw from the current snapshot (e.g. after a permission check answers). */
  refresh(): void
  /** Open the pop-out window if it is not open. Must be called inside a user gesture. */
  popOut(): void
  /** Show a portrait size or opacity, or a text size, while its slider is dragged. Null: back to the saved values. */
  previewPortrait(preview: { sizePct?: number; opacityPct?: number; textPct?: number } | null): void
  /** Something happened in a chat (a message landed); refetch the tail if it's showing. */
  noteActivity(): void
  destroy(): void
}

const TAIL_LIMIT = 14

/** D-056: the folded eye on a phone — AdventureTime's launcher size, bottom-right and clear of the input bar. */
export const DISC_SIZE = 56
const DISC_MARGIN = { right: 16, bottom: 96 }
/** A press on the disc that moved this far is a drag, not a tap. */
const DISC_TAP_SLOP = 8

/**
 * D-059: what the viewer chose to see. `hidePicture` hides the last picture and
 * keeps the portraits; `linesOnly` hides every line that isn't a character's
 * (the strip, progress, notes, "saw:" rows, your own lines, times).
 */
export interface PaneView {
  textPct: number
  hidePicture: boolean
  linesOnly: boolean
}

/** The widget's base text size, in pixels; the text size setting scales it. */
const BASE_FONT_PX = 12

const GLANCE = { width: 260, height: 214 }
const EXPANDED = { width: 320, height: 420 }
const MIN_SIZE = { width: 200, height: 150 }

/** Theme variables copied into a pop-out window, which is its own document. */
const THEME_VARS = [
  // D-062: the solid colour the widget's surface actually shows (see `surfaceColor`).
  '--hl-surface',
  '--lumiverse-text',
  '--lumiverse-text-muted',
  '--lumiverse-text-dim',
  '--lumiverse-fill',
  '--lumiverse-fill-subtle',
  '--lumiverse-border',
  '--lumiverse-border-hover',
  '--lumiverse-accent',
  '--lumiverse-accent-fg',
  // D-058: what the theme engine actually sets for the accent (the documented pair above is unset).
  '--lumiverse-primary',
  '--lumiverse-primary-contrast',
  '--lumiverse-radius',
  '--lumiverse-transition-fast',
]

type DocPiP = { requestWindow(options: { width: number; height: number }): Promise<Window> }

/**
 * Rewrite a stylesheet so every `var(--lumiverse-…, fallback)` becomes the
 * value the host page resolves it to right now, or the fallback when the host
 * doesn't define it. The pop-out is its own document: handing it a sheet with
 * no `var()` left in it means its colours cannot depend on anything the
 * pop-out window does or doesn't inherit.
 */
export function resolveThemeCss(css: string, lookup: (name: string) => string): string {
  // Innermost first: a fallback may itself be a var(). Three passes cover
  // every nesting this file uses, with room to spare.
  const one = /var\((--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g
  let out = css
  for (let pass = 0; pass < 3 && out.includes('var('); pass++) {
    out = out.replace(one, (_m, name: string, fallback?: string) => {
      const value = lookup(name).trim()
      return value || (fallback ?? '').trim()
    })
  }
  return out
}

type Rgba = { r: number; g: number; b: number; a: number }

export function parseColor(text: string): Rgba | null {
  const m = /^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i.exec(text.trim())
  if (!m) return null
  let a = 1
  if (m[4] !== undefined) a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Math.min(1, Math.max(0, a)) }
}

/** `top` painted over `bottom` (ordinary source-over compositing). */
export function over(bottom: Rgba, top: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const ch = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a }
}

export function cssColor(c: Rgba): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
}

export function isDark(c: Rgba): boolean {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 128
}

/**
 * The solid colour the page paints underneath `el`. The host's theme fills are
 * translucent blacks layered over its page surface, so a pop-out only looks
 * like the page if its canvas starts from that same colour.
 *
 * The surface is not necessarily an ancestor: float widgets are portalled to
 * `body`, and the host paints its theme on the app shell beside them. So this
 * looks at what is actually stacked under the widget's centre
 * (`elementsFromPoint`), bottom-most first, and composites every background
 * colour on the way up, skipping the widget itself. Falls back to the
 * ancestor chain, and to white, when that isn't available.
 */
export function compositeStack(stack: Element[], backgroundOf: (el: Element) => string): Rgba {
  let result: Rgba = { r: 255, g: 255, b: 255, a: 1 }
  for (let i = stack.length - 1; i >= 0; i--) {
    const c = parseColor(backgroundOf(stack[i]))
    if (c && c.a > 0) result = over(result, c)
  }
  return result
}

function effectiveBackground(el: Element): Rgba {
  const backgroundOf = (node: Element) => getComputedStyle(node).backgroundColor
  let stack: Element[] = []
  if (typeof document.elementsFromPoint === 'function') {
    const r = el.getBoundingClientRect()
    const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2))
    const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2))
    // Skip ourselves, and any other Pane (a previous one being torn down, say).
    stack = document.elementsFromPoint(x, y).filter((node) => !el.contains(node) && !node.closest('.hl-pane'))
  }
  if (stack.length === 0) {
    for (let node: Element | null = el.parentElement; node; node = node.parentElement) stack.unshift(node)
  }
  return compositeStack(stack, backgroundOf)
}

/** H1: what a hush means, in the tooltip. */
export const HUSH_TITLE = 'They keep watching. They just can\'t talk about it.'
export const HUSHED_TITLE = 'Press to let them talk again.'

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function createPane(deps: PaneDeps): Pane {
  const { ctx, engine } = deps
  const create = ctx.ui?.createFloatWidget
  if (typeof create !== 'function') return unavailable()
  let widget: ReturnType<SpindleFrontendContext['ui']['createFloatWidget']>
  try {
    widget = create.call(ctx.ui, {
      width: GLANCE.width,
      height: GLANCE.height,
      // Dead centre on first appearance (the host's default corner sits under
      // the settings side panel). The host remembers wherever it's dragged to.
      initialPosition: {
        x: Math.max(0, Math.round((window.innerWidth - GLANCE.width) / 2)),
        y: Math.max(0, Math.round((window.innerHeight - GLANCE.height) / 2)),
      },
      snapToEdge: true,
      tooltip: 'Houselights',
      chromeless: true,
    })
  } catch {
    // `ui_panels` not granted on this install, or a host without float widgets.
    return unavailable()
  }

  // --- state -------------------------------------------------------------------
  let snapshot = engine.snapshot()
  let hush: PaneHush = { hushed: false, source: null, remainingMs: 0 }
  // When the dim ends, as a clock time: the Pane counts down itself, so it
  // never shows "Undim" after the dim has already run out.
  let hushEndsAt = 0
  const hushNow = (): PaneHush => {
    if (!hush.hushed) return hush
    const remainingMs = hushEndsAt - Date.now()
    return remainingMs > 0 ? { ...hush, remainingMs } : { hushed: false, source: null, remainingMs: 0 }
  }
  let expanded = false
  let popout: Window | null = null
  let alive = true
  // The size the user last gave each state (resize grip, this session). The
  // host remembers the last geometry across reloads on its own.
  const sizes = { glance: { ...GLANCE }, expanded: { ...EXPANDED } }

  // --- DOM ----------------------------------------------------------------------
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const node = document.createElement(tag)
    node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const root = el('div', 'hl-pane')
  const glass = el('div', 'hl-pane-glass')
  const frame = el('img', 'hl-pane-frame') as HTMLImageElement
  frame.alt = 'The last picture the character saw'
  frame.decoding = 'async'
  const phone = deps.phone === true
  // D-090/D-091: the phone's own rules (an opaque backing; icons only, as on a computer).
  if (phone) root.classList.add('hl-pane-phone')
  const empty = el('div', 'hl-pane-empty', phone ? 'Nothing seen yet. Take a photo.' : 'Nothing seen yet. Press Look.')
  const avatar = el('img', 'hl-pane-avatar') as HTMLImageElement
  avatar.alt = ''
  const live = el('div', 'hl-pane-live')
  const caption = el('div', 'hl-pane-caption')
  // D-059: the corner of the picture — LIVE, then two one-tap toggles. Each label says what a tap does.
  const corner = el('div', 'hl-pane-corner')
  const cornerBtn = (title: string, onClick: () => void) => {
    const b = el('button', 'hl-pane-btn hl-pane-corner-btn')
    b.type = 'button'
    b.title = title
    b.addEventListener('click', (ev) => {
      ev.stopPropagation()
      onClick()
    })
    // A press on the corner is a press, not the start of a widget drag.
    b.addEventListener('pointerdown', (ev) => ev.stopPropagation())
    return b
  }
  const toggleView = (key: 'hidePicture' | 'linesOnly') => {
    const next = !currentView()[key]
    // Saved, so it holds across reloads and devices; without a saver it holds for this widget only.
    if (deps.setView) deps.setView({ [key]: next })
    else viewOverride = { ...viewOverride, [key]: next }
    render() // the portrait's size depends on whether the picture is there
  }
  const picBtn = cornerBtn('', () => toggleView('hidePicture'))
  const linesBtn = cornerBtn('', () => toggleView('linesOnly'))
  corner.append(picBtn, linesBtn, live) // LIVE wraps under the toggles on a narrow widget, clear of the portrait
  glass.append(frame, empty, avatar, corner, caption)

  const strip = el('div', 'hl-pane-strip')
  // D-099: the last two minutes of a session: "Stops in 1:42 · Extend", with Extend right there.
  // Its own line, not part of the strip, so "Lines only" (which hides the strip) can't hide it.
  const stopWarn = el('div', 'hl-pane-warn')
  const stopWarnText = el('span', 'hl-pane-warn-text')
  const stopWarnBtn = el('button', 'hl-pane-warn-btn', 'Extend') as HTMLButtonElement
  stopWarnBtn.type = 'button'
  stopWarnBtn.addEventListener('click', () => engine.extend())
  stopWarn.append(stopWarnText, stopWarnBtn)
  stopWarn.hidden = true
  const controls = el('div', 'hl-pane-controls')
  // D-090: a button says what it does; nothing it needs to say hides in a hover title.
  const btn = (label: string, onClick: () => void) => {
    const b = el('button', 'hl-pane-btn', label)
    b.type = 'button'
    b.addEventListener('click', (ev) => {
      ev.stopPropagation()
      onClick()
    })
    return b
  }
  /**
   * D-090 (D5): an icon button. Its name is its accessible name and, as the style guide allows,
   * its title. D-091: icons only on a phone too (asked for after 0.1.6; the words made the row wrap).
   */
  const iconBtn = (name: IconName, word: string, onClick: () => void) => {
    const b = btn('', onClick)
    b.classList.add('hl-pane-icon-btn')
    setIcon(b, name, word)
    return b
  }
  const setIcon = (b: HTMLButtonElement, name: IconName, word: string) => {
    if (b.dataset.icon === name && b.getAttribute('aria-label') === word) return
    b.dataset.icon = name
    b.replaceChildren(icon(name, 14))
    b.setAttribute('aria-label', word)
    b.title = word
  }
  const lookBtn = btn('Look', () => void engine.look())
  // H1: the button only ever shows the hush you pressed; the quiet after you speak is the strip's.
  const buttonHushed = (): boolean => { const h = hushNow(); return h.hushed && h.source === 'button' }
  const hushBtn = btn('Hush', () => deps.onHush(!buttonHushed()))
  const stopBtn = btn('Stop', engine.stop)
  const expandBtn = iconBtn('maximize-2', 'Expand', () => setExpanded(!expanded))
  const popBtn = iconBtn('picture-in-picture-2', 'Pop out', () => void togglePopout())
  popBtn.hidden = !('documentPictureInPicture' in window)
  // D16: the speaker toggle — voice out, opt-in. Renders only where the host can speak.
  const voiceBtn = iconBtn('volume-x', 'Speak aloud', () => {
    const next = !deps.voice.voiceOut()
    deps.voice.setVoiceOut(next)
    if (!next) deps.voice.stop()
    render()
  })
  voiceBtn.classList.add('hl-pane-voice')
  // D-055, phone mode: the camera app and a picture instead of Look.
  const photoBtn = iconBtn('camera', 'Photo', () => engine.takePhoto?.())
  const pictureBtn = iconBtn('image', 'Picture', () => engine.choosePicture?.())
  // D-063: on a phone following the computer, ask the computer to look.
  const remoteBtn = iconBtn('monitor', 'Ask computer', () => engine.remoteLook?.())
  photoBtn.hidden = !phone
  pictureBtn.hidden = !phone
  remoteBtn.hidden = true
  if (phone) {
    lookBtn.hidden = true
    popBtn.hidden = true
    hushBtn.hidden = true // D-056: not on a phone — the widget folds to the eye instead
  }
  for (const b of [voiceBtn, expandBtn, popBtn]) b.classList.add('hl-pane-btn-compact')
  controls.append(lookBtn, remoteBtn, photoBtn, pictureBtn, hushBtn, stopBtn, voiceBtn, expandBtn, popBtn)

  // D15: the Watching chip — a guess to confirm, the confirmed name, or "not set".
  // Lives in the expanded state only; the glance stays uncluttered.
  const chip = el('div', 'hl-pane-chip')
  const chipText = el('span', 'hl-pane-chip-text')
  // ✓ confirms the guess on offer, or (D-099) the name being asked about again.
  const chipYes = iconBtn('check', 'Confirm', () => engine.confirmWatching(snapshot.watching.candidate?.text ?? snapshot.watching.lastConfirmed ?? ''))
  const chipEdit = iconBtn('pencil', 'Edit', () => editChip())
  const chipClear = iconBtn('x', 'Clear', () => engine.confirmWatching(''))
  // D-090: Clear sits apart, at the far end, in the danger colour (finding 39).
  chipClear.classList.add('hl-pane-btn-danger')
  chip.append(chipText, chipYes, chipEdit, chipClear)
  let chipEditing = false
  function editChip(): void {
    const w = snapshot.watching
    const input = el('input', 'hl-pane-chip-input') as HTMLInputElement
    input.type = 'text'
    input.maxLength = 80
    input.value = w.candidate?.text ?? w.confirmed ?? w.lastConfirmed ?? '' // D-099: "Still <name>?" edits from that name
    input.placeholder = 'e.g. Palworld'
    input.setAttribute('aria-label', 'What is on screen')
    const done = (save: boolean) => {
      chipEditing = false
      if (save) engine.confirmWatching(input.value)
      renderChip()
    }
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation()
      if (ev.key === 'Enter') done(true)
      if (ev.key === 'Escape') done(false)
    })
    input.addEventListener('pointerdown', (ev) => ev.stopPropagation())
    const ok = iconBtn('check', 'Save', () => done(true))
    // D-100: pressing ✓ took the focus from the box first, and losing focus cancelled the edit
    // before the click arrived, so only Enter saved. The press no longer moves the focus, and a
    // focus that does move to ✓ (the keyboard's Tab) is not a cancel.
    ok.addEventListener('mousedown', (ev) => ev.preventDefault())
    input.addEventListener('blur', (ev) => {
      if (chipEditing && ev.relatedTarget !== ok) done(false)
    })
    chipEditing = true
    chip.replaceChildren(input, ok)
    input.focus()
  }
  function renderChip(): void {
    if (chipEditing) return
    const w = snapshot.watching
    chip.replaceChildren(chipText, chipYes, chipEdit, chipClear)
    chip.classList.toggle('hl-pane-chip-unset', !w.candidate && !w.confirmed && !w.lastConfirmed)
    chip.classList.toggle('hl-pane-chip-ask', !w.candidate && !w.confirmed && !!w.lastConfirmed)
    chipText.title = ''
    if (!w.candidate && !w.confirmed && w.lastConfirmed) {
      // D-099: the name ran out with its session, or the screen stopped matching. Nothing is sent meanwhile.
      chipText.textContent = `Still ${w.lastConfirmed}?`
      chipText.title = w.doubt === 'screen' ? 'The screen stopped looking like this. Nothing is sent until you confirm or change it.' : 'From your last session. Nothing is sent until you confirm or change it.'
      chipYes.hidden = false
      chipClear.hidden = true
    } else if (w.candidate) {
      chipText.textContent = `Watching: ${w.candidate.text}?`
      chipYes.hidden = false
      chipClear.hidden = true
    } else if (w.confirmed) {
      chipText.textContent = `Watching: ${w.confirmed}`
      chipYes.hidden = true
      chipClear.hidden = false
    } else {
      chipText.textContent = 'Watching: not set'
      chipYes.hidden = true
      chipClear.hidden = true
    }
  }

  // Expanded: the watched chat's tail (beats as small "saw:" markers), then
  // Extend and "Open in Lumiverse".
  const more = el('div', 'hl-pane-more')
  const tailList = el('div', 'hl-pane-tail')
  const tailEmpty = el('div', 'hl-pane-tail-empty', 'Nothing in this chat yet.')
  // Talk-back (D14): a line for the character, with or without a fresh look.
  const talkRow = el('div', 'hl-pane-talk')
  const talkInput = el('input', 'hl-pane-talk-input') as HTMLInputElement
  talkInput.type = 'text'
  talkInput.placeholder = 'Say something about what they can see'
  talkInput.maxLength = 2000
  talkInput.setAttribute('aria-label', 'Say something to the character')
  // The line just sent, until the backend answers: if the send is held back or
  // fails, it comes back into the input instead of vanishing.
  let pendingLine: string | null = null
  /**
   * D-095: what is typed in Lumiverse's chat box, when it is the watched chat's and the widget's
   * own box is empty. Send + look takes it then; the widget's own words always come first.
   */
  const chatBoxDraft = (): { chatId: string; text: string } | null => {
    if (talkInput.value.trim()) return null
    const draft = deps.composer?.current()
    const watched = snapshot.chat.chat
    return draft && draft.text && watched && draft.chatId === watched.id ? draft : null
  }
  const sendTalk = (withLook: boolean) => {
    const text = talkInput.value.trim()
    if (!text) {
      const draft = withLook ? chatBoxDraft() : null
      if (!draft) return
      // It stays in the chat box until it lands (composer.ts), so a failed look loses nothing.
      deps.composer?.sent(draft.chatId, draft.text)
      void engine.talk(draft.text, true)
      if (countdown) cancelCountdown()
      setTalkNote('', 'info')
      return
    }
    talkInput.value = ''
    pendingLine = text
    void engine.talk(text, withLook)
    if (countdown) cancelCountdown()
    setTalkNote('', 'info')
  }
  talkInput.addEventListener('keydown', (ev) => {
    ev.stopPropagation() // The host has its own shortcuts; typing here is ours.
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      sendTalk(ev.ctrlKey || ev.metaKey)
    }
  })
  talkInput.addEventListener('pointerdown', (ev) => ev.stopPropagation())
  const sendBtn = btn('Send', () => sendTalk(false))
  const lookSendBtn = iconBtn('eye', 'Send + look', () => sendTalk(true))
  lookSendBtn.classList.add('hl-pane-talk-eye')
  /** D-095: the eye says when it would send the chat box's words rather than the widget's. */
  function renderEye(): void {
    const fromChatBox = chatBoxDraft() !== null
    setIcon(lookSendBtn, 'eye', fromChatBox ? 'Send + look: sends what\'s typed in the chat box' : 'Send + look')
    lookSendBtn.classList.toggle('hl-pane-btn-on', fromChatBox)
  }
  talkInput.addEventListener('input', () => renderEye())
  const unsubComposer = deps.composer?.onChange(() => renderEye()) ?? (() => {})
  // D16: push-to-talk. One press, one utterance; the words land in the input and,
  // unless the user steps in, go as a talk line a few seconds later.
  const micBtn = iconBtn('mic', 'Talk', () => {
    if (deps.voice.listening()) {
      deps.voice.cancelListening()
      return
    }
    cancelCountdown()
    const started = deps.voice.listen({
      onStatus: (phase) => setListenPhase(phase),
      onInterim: (text) => {
        if (text.trim()) talkInput.value = text
      },
      onTranscript: (text) => {
        setListenPhase(null)
        if (!text) {
          setTalkNote('Heard nothing.', 'info')
          return
        }
        talkInput.value = text
        const auto = deps.voice.autoSend()
        if (auto.enabled) startCountdown(Math.max(0, auto.delaySeconds))
        else setTalkNote('Press Enter to send, or edit it first.', 'info')
      },
      onError: (message) => {
        setListenPhase(null)
        setTalkNote(message, 'err')
      },
      onEnd: () => {
        setListenPhase(null)
        render()
      },
    })
    if (started) setListenPhase('loading')
    render()
  })
  micBtn.classList.add('hl-pane-talk-mic')
  talkRow.append(talkInput, sendBtn, lookSendBtn, micBtn)
  // A line under the talk row: listening phase, countdown, or what went wrong.
  const talkNote = el('div', 'hl-pane-talk-note')
  talkNote.hidden = true
  let listenPhase: ListenPhase | null = null
  let countdown: { remaining: number; timer: ReturnType<typeof setInterval> } | null = null
  // D-058: whether the note on show is only a listening phase. When the session ends,
  // only that kind is cleared: an error or "Heard nothing." set just before the end
  // used to be wiped at once, so a failed press looked like a silent cancel.
  let noteIsPhase = false
  function setTalkNote(text: string, kind: 'info' | 'err', phase = false): void {
    noteIsPhase = phase && !!text
    talkNote.textContent = text
    talkNote.classList.toggle('hl-pane-talk-note-err', kind === 'err')
    talkNote.hidden = !text
  }
  function setListenPhase(phase: ListenPhase | null): void {
    listenPhase = phase
    if (phase === 'loading') setTalkNote('Getting the recogniser ready…', 'info', true)
    else if (phase === 'listening') setTalkNote('Listening. Say one thing, then pause.', 'info', true)
    else if (phase === 'processing') setTalkNote('Transcribing…', 'info', true)
    else if (!countdown && noteIsPhase) setTalkNote('', 'info')
    render()
  }
  // Escape anywhere in the Pane's document cancels the countdown, focus or not.
  const onDocEscape = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape' || !countdown) return
    cancelCountdown()
    setTalkNote('Kept. Press Enter when you are ready.', 'info')
  }
  function cancelCountdown(): void {
    if (!countdown) return
    clearInterval(countdown.timer)
    countdown = null
    talkInput.ownerDocument.removeEventListener('keydown', onDocEscape, true)
    setTalkNote('', 'info')
  }
  function startCountdown(seconds: number): void {
    cancelCountdown()
    if (seconds === 0) {
      sendTalk(false)
      return
    }
    talkInput.ownerDocument.addEventListener('keydown', onDocEscape, true)
    try {
      talkInput.focus({ preventScroll: true })
    } catch {
      // A pop-out document may refuse focus; the document listener still works.
    }
    const tick = () => {
      if (!countdown) return
      if (countdown.remaining <= 0) {
        cancelCountdown()
        sendTalk(false)
        return
      }
      setTalkNote(`Sending in ${countdown.remaining} seconds. Press Escape or edit it to hold it back.`, 'info')
      countdown.remaining -= 1
    }
    countdown = { remaining: seconds, timer: setInterval(tick, 1000) }
    tick()
  }
  talkInput.addEventListener('keydown', (ev) => {
    if (!countdown) return
    cancelCountdown()
    setTalkNote(ev.key === 'Escape' ? 'Kept. Press Enter when you are ready.' : '', 'info')
  })
  talkInput.addEventListener('pointerdown', () => cancelCountdown())

  // D17: the stance, per chat. The Custom text itself lives in the Houselights tab.
  const stanceRow = el('div', 'hl-pane-stance')
  const stanceLabel = el('span', 'hl-pane-stance-label', 'Stance')
  const stanceSelect = el('select', 'hl-pane-stance-select') as HTMLSelectElement
  stanceSelect.setAttribute('aria-label', 'Stance for this chat')
  for (const s of STANCES) {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = s.label
    stanceSelect.appendChild(opt)
  }
  stanceSelect.addEventListener('pointerdown', (ev) => ev.stopPropagation())
  stanceSelect.addEventListener('keydown', (ev) => ev.stopPropagation())
  stanceSelect.addEventListener('change', () => engine.setStance(stanceSelect.value as Stance))
  stanceRow.append(stanceLabel, stanceSelect)

  const moreRow = el('div', 'hl-pane-more-row')
  const extendBtn = btn('Extend', engine.extend)
  const openBtn = btn('Open in Lumiverse', () => openInLumiverse())
  moreRow.append(extendBtn, openBtn)
  more.append(chip, stanceRow, tailList, tailEmpty, talkRow, talkNote, moreRow)
  more.hidden = true
  let tail: TailPayload | null = null
  let tailRequestedAt = 0
  let tailRetry: ReturnType<typeof setTimeout> | null = null
  let lastSeenReaction: EngineSnapshot['lastReaction'] = null
  let lastSeenChatId: string | null | undefined

  function requestTail(): void {
    if (!alive || !expanded) return
    const now = Date.now()
    const wait = 500 - (now - tailRequestedAt)
    if (wait > 0) {
      // A burst (a beat and its reply land together) ends in one fetch, after the last.
      if (tailRetry === null) tailRetry = setTimeout(() => { tailRetry = null; requestTail() }, wait)
      return
    }
    tailRequestedAt = now
    ctx.sendToBackend({ type: 'get_tail', limit: TAIL_LIMIT })
  }

  function hhmm(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function renderTail(): void {
    // Keep the reader's place: stick to the bottom only if they were there.
    const atBottom = tailList.childElementCount === 0 || tailList.scrollHeight - tailList.scrollTop - tailList.clientHeight < 12
    const keepTop = tailList.scrollTop
    tailList.replaceChildren()
    const entries = tail?.entries ?? []
    const watched = snapshot.chat.chat?.id ?? null
    const stale = tail && tail.chatId !== watched
    tailEmpty.hidden = entries.length > 0 && !stale
    if (stale) {
      tailEmpty.textContent = 'Loading…'
      return
    }
    tailEmpty.textContent = tail ? 'Nothing in this chat yet.' : 'Loading…'
    for (const e of entries) tailList.appendChild(tailRow(e))
    tailList.scrollTop = atBottom ? tailList.scrollHeight : keepTop
  }

  function tailRow(e: TailEntry): HTMLElement {
    const row = el('div', `hl-pane-tail-row hl-pane-tail-${e.kind}`)
    if (e.hidden && e.kind !== 'beat') row.classList.add('hl-pane-tail-hidden')
    if (e.kind === 'beat') {
      const via = e.beat?.source === 'webcam' ? 'webcam' : e.beat?.source === 'camera' ? 'phone' : e.beat?.source === 'file' ? 'picture' : null
      row.textContent = `saw${via ? ` (${via})` : ''}${e.beat?.hushed ? (e.beat.quiet === 'conversation' ? ' (held back)' : ' (hushed)') : ''}: ${e.beat?.scene ?? '(not described)'} · ${hhmm(e.at)}`
      row.title = e.text
      return row
    }
    const who = el('span', 'hl-pane-tail-name', e.kind === 'user' ? (e.name || 'You') : e.name)
    const text = el('span', 'hl-pane-tail-text', e.text)
    // D-071: what the prompt said about a hush, so a mention can be traced from here.
    const marks = [e.lookedUp ? 'had notes' : '', e.hushTold === 'hush' ? 'told: hush' : e.hushTold === 'quiet' ? 'told: held back' : ''].filter(Boolean)
    const when = el('span', 'hl-pane-tail-time', [...marks, hhmm(e.at)].join(' · '))
    // In a box, a small avatar says who spoke without reading the name.
    if (snapshot.chat.box && e.kind !== 'user' && (e.avatarUrl || e.characterId)) {
      const pic = el('img', 'hl-pane-tail-avatar') as HTMLImageElement
      pic.alt = ''
      pic.src = e.avatarUrl ? new URL(e.avatarUrl, location.origin).href : deps.avatarUrl(e.characterId!)
      row.appendChild(pic)
    }
    row.append(who, text, when)
    row.title = e.text
    return row
  }

  /**
   * Go to the watched chat in Lumiverse. The host lists a `character_chat`
   * entity action on newer builds; when it's there and takes a chat id, use
   * it. Otherwise all we can do is bring the window forward, which is what
   * the pop-out needs anyway.
   */
  function openInLumiverse(): void {
    try {
      window.focus()
    } catch {
      // Browsers may refuse; harmless.
    }
    const chat = snapshot.chat.chat
    if (!chat) return
    if (snapshot.chat.activeChatId === chat.id) return // Already looking at it.
    // D-095: straight to the chat (the host's own route; no permission needed).
    if (deps.openChat) {
      deps.openChat(chat.id)
      return
    }
    try {
      const surfaces = (ctx.host as { surfaces?: { list(kinds?: readonly string[]): Array<{ kind: string; id: string; params?: Record<string, unknown> }>; invoke(ref: { kind: string; id: string }, params?: Record<string, unknown>): unknown } } | undefined)?.surfaces
      const action = surfaces?.list(['entity_action']).find((s) => s.id === 'character_chat')
      if (!action) return
      const keys = Object.keys(action.params ?? {})
      const params: Record<string, string> = {}
      for (const k of keys) {
        if (/chat/i.test(k)) params[k] = chat.id
        else if (/character/i.test(k) && chat.characterId) params[k] = chat.characterId
      }
      console.info(`[Houselights] opening chat via character_chat with ${JSON.stringify(params)}`)
      void surfaces!.invoke({ kind: 'entity_action', id: 'character_chat' }, params)
    } catch (err) {
      console.warn('[Houselights] could not open the chat in Lumiverse:', err)
    }
  }

  const status = el('div', 'hl-pane-status')
  status.hidden = true
  // While a reaction is in flight: what is happening, on its own line so it is
  // never cut off the end of the strip ("Marlo is answering (2 of 4)…").
  const workingLine = el('div', 'hl-pane-working')
  workingLine.hidden = true

  // Resize grip (bottom-right corner). Chromeless widgets get no resize chrome
  // from the host, so the Pane supplies its own and sizes the widget through
  // `setSize`, which the host clamps and remembers. The attribute is the
  // host's own opt-out for its whole-surface drag; stopping `pointerdown` is
  // the belt to that brace on hosts that don't know the attribute.
  const grip = el('div', 'hl-pane-grip')
  grip.title = 'Drag to resize'
  grip.setAttribute('data-spindle-float-resize-handle', '')
  grip.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    ev.stopPropagation()
    ev.preventDefault()
    const startW = root.offsetWidth
    const startH = root.offsetHeight
    // Pointer deltas are rendered pixels; the host may zoom the page, and
    // `setSize` wants layout pixels. The ratio comes from the element itself.
    const rect = root.getBoundingClientRect()
    const scale = startW > 0 ? rect.width / startW : 1
    const x0 = ev.clientX
    const y0 = ev.clientY
    const id = ev.pointerId
    let frameReq = 0
    let next = { width: startW, height: startH }
    const paint = () => {
      frameReq = 0
      try {
        widget.setSize(next.width, next.height)
      } catch {
        // Host refused (destroyed or fullscreen); nothing to do.
      }
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      const width = Math.max(MIN_SIZE.width, Math.round(startW + (e.clientX - x0) / scale))
      next = {
        width,
        // At a glance the height follows the picture; expanded, it's the user's.
        height: expanded ? Math.max(MIN_SIZE.height, Math.round(startH + (e.clientY - y0) / scale)) : glanceHeight(width),
      }
      if (!frameReq) frameReq = requestAnimationFrame(paint)
    }
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      grip.removeEventListener('pointermove', onMove)
      grip.removeEventListener('pointerup', finish)
      grip.removeEventListener('pointercancel', finish)
      if (frameReq) cancelAnimationFrame(frameReq)
      paint()
      sizes[expanded ? 'expanded' : 'glance'] = { ...next }
      try {
        grip.releasePointerCapture(id)
      } catch {
        // Already released.
      }
    }
    try {
      grip.setPointerCapture(id)
    } catch {
      // Some hosts refuse capture during a drag; moves still arrive while over the grip.
    }
    grip.addEventListener('pointermove', onMove)
    grip.addEventListener('pointerup', finish)
    grip.addEventListener('pointercancel', finish)
  })
  grip.addEventListener('click', (ev) => ev.stopPropagation())

  // 2026-11-16: the progress line sits at the bottom of the picture area, over it, so the
  // chat below never moves when it comes and goes.
  glass.appendChild(workingLine)
  root.append(glass, strip, stopWarn, controls, more, status, grip)
  // The host sizes its surface and a 100% content box, but hands us a plain,
  // unsized div inside that. Without this the Pane's `height: 100%` means
  // "auto", it grows with the tail, and a chromeless surface shows the overflow.
  widget.root.style.display = 'block'
  widget.root.style.width = '100%'
  widget.root.style.height = '100%'
  widget.root.appendChild(root)
  const removeStyle = ctx.dom.addStyle(PANE_STYLES)

  // In the page the host's fill is translucent and the Pane can drift over the
  // chat list; give it the page's own surface colour underneath, as the pop-out gets.
  // D-091: not on a phone or tablet. There the one sample, taken as the widget is created, could
  // catch a dark page (still loading, or a dark chat background) and keep it for good, so a light
  // theme's widget came out near-black. The phone's stylesheet gives it the theme's own page
  // colour instead, which also follows a change of theme.
  if (!phone) {
    try {
      root.style.backgroundColor = cssColor(effectiveBackground(widget.root))
    } catch {
      // Sampling failed (no layout yet); the fill alone is what it was.
    }
  }

  /** The glance height for a width: the 16:9 glass plus whatever is under it. */
  function glanceHeight(width: number): number {
    const inner = width - 18 // padding 8 + 8, border 1 + 1
    const nopic = currentView().hidePicture
    const size = portraitPreview?.sizePct ?? deps.portrait?.().sizePct ?? 25
    let h = 18 + (nopic ? Math.max(glass.offsetHeight, portraitPx(inner, size) + 12) : Math.round((inner * 9) / 16))
    // Hidden by the `hidden` attribute or by Lines only: either way it takes no room.
    const parts: HTMLElement[] = [strip, stopWarn, controls, status].filter((n) => !n.hidden && n.getClientRects().length > 0)
    for (const n of parts) h += n.offsetHeight || (n === controls ? 28 : 16)
    h += 6 * parts.length // gaps after the glass
    return Math.max(MIN_SIZE.height, h)
  }

  /** Glance only: snap the widget (or pop-out) height to the content after it changed. */
  function fitGlance(): void {
    if (expanded || !alive) return
    const width = root.offsetWidth
    if (!width) return
    const h = glanceHeight(width)
    if (popout) {
      const chrome = popout.outerHeight - popout.innerHeight
      if (Math.abs(popout.innerHeight - h) > 2) {
        try {
          popout.resizeTo?.(popout.outerWidth, h + chrome)
        } catch {
          // Chrome only lets a pop-out resize itself right after a click; otherwise the window stays as it is.
        }
      }
    } else if (Math.abs(root.offsetHeight - h) > 2) {
      try {
        widget.setSize(width, h)
      } catch {
        // Host refused; the glass keeps its ratio and the rest just sits lower.
      }
    }
    sizes.glance = { width, height: h }
  }

  // --- the portrait: size and opacity from the settings, or a slider being dragged.
  let portraitPreview: { sizePct?: number; opacityPct?: number } | null = null
  function applyPortrait(): void {
    const saved = deps.portrait?.() ?? { sizePct: 25, opacityPct: 100 }
    const size = portraitPreview?.sizePct ?? saved.sizePct
    const opacity = portraitPreview?.opacityPct ?? saved.opacityPct
    // D-060: with the picture hidden there is no picture to be a share of, so the portrait
    // gets the pixel size it would have had over it, and the top area shrinks to fit it.
    if (currentView().hidePicture) {
      const px = portraitPx(root.clientWidth - 16, size)
      avatar.style.height = `${px}px`
      avatar.style.width = `${px}px`
    } else {
      avatar.style.height = `${size}%`
      avatar.style.width = ''
    }
    avatar.style.opacity = String(Math.min(1, Math.max(0.1, opacity / 100)))
  }

  /** The portrait's height over the picture: a share of the glass, 16:9 at a glance, the expanded band otherwise. */
  function portraitPx(innerWidth: number, sizePct: number): number {
    const width = innerWidth > 0 ? innerWidth : GLANCE.width - 16
    const glassHeight = expanded
      ? Math.min(360, Math.max(72, Math.round((root.clientHeight || EXPANDED.height) * 0.36)))
      : (width * 9) / 16
    return Math.max(18, Math.round((glassHeight * sizePct) / 100))
  }

  // --- D-059: text size and the corner toggles -----------------------------------
  let viewOverride: Partial<PaneView> = {}
  let textPreview: number | null = null
  let viewKey = ''
  function currentView(): PaneView {
    const saved = deps.view?.() ?? { textPct: 100, hidePicture: false, linesOnly: false }
    return { ...saved, ...viewOverride }
  }
  function applyView(): void {
    const v = currentView()
    const pct = Math.min(200, Math.max(70, textPreview ?? v.textPct))
    root.style.fontSize = `${Math.round(BASE_FONT_PX * pct) / 100}px`
    root.classList.toggle('hl-pane-nopic', v.hidePicture)
    glass.classList.toggle('hl-pane-glass-nopic', v.hidePicture)
    root.classList.toggle('hl-pane-lines-only', v.linesOnly)
    picBtn.textContent = v.hidePicture ? 'Show picture' : 'Hide picture'
    picBtn.classList.toggle('hl-pane-corner-on', v.hidePicture)
    linesBtn.textContent = v.linesOnly ? 'All text' : 'Lines only'
    linesBtn.classList.toggle('hl-pane-corner-on', v.linesOnly)
    // Refit only on a change: render runs every second. With the picture hidden the top
    // area's height follows the newest line, so that counts as a change too.
    const key = `${pct}|${v.hidePicture}|${v.linesOnly}|${v.hidePicture ? glass.offsetHeight : 0}`
    if (key !== viewKey) {
      viewKey = key
      requestAnimationFrame(fitGlance)
    }
  }

  // --- rendering ----------------------------------------------------------------
  let avatarFor: string | null = null
  /**
   * D-062: the theme's fills are translucent, so a fill alone says little about what is
   * behind the text. Over a picture a dark frame shows through a light theme's fill (the
   * corner and the caption went unreadable), and a native dropdown paints a translucent
   * option over white (the stance list in a dark pop-out). The page under the widget with
   * the widget's own fill on top is the solid colour the theme really looks like here;
   * those places paint with it. Measured in the page; the pop-out takes it along.
   */
  let surfaceAt = 0
  function refreshSurface(): void {
    if (popout || Date.now() - surfaceAt < 3000) return
    surfaceAt = Date.now()
    try {
      const page = effectiveBackground(widget.root)
      const fill = parseColor(getComputedStyle(root).backgroundColor)
      root.style.setProperty('--hl-surface', cssColor(fill ? over(page, fill) : page))
    } catch {
      // Not laid out yet; the fallbacks in the stylesheet hold until the next try.
    }
  }

  function render(): void {
    if (!alive) return
    refreshSurface()
    const s = snapshot
    const reaction = s.lastReaction

    // The glass.
    if (s.lastThumbDataUrl) {
      if (frame.src !== s.lastThumbDataUrl) frame.src = s.lastThumbDataUrl
      frame.hidden = false
      empty.hidden = true
    } else {
      frame.hidden = true
      empty.hidden = false
    }

    // The viewer: in a box, whoever spoke last (addendum §2); otherwise the chat's character.
    const partialNow = s.awaitingReaction ? (s.partialLines ?? []) : []
    const lastLine = partialNow.length
      ? partialNow[partialNow.length - 1]
      : reaction?.ok && reaction.chatId === s.chat.chat?.id && reaction.lines?.length ? reaction.lines[reaction.lines.length - 1] : null
    const characterId = s.chat.chat?.characterId ?? null
    const avatarSrc = lastLine?.avatarUrl
      ? new URL(lastLine.avatarUrl, location.origin).href
      : lastLine?.characterId
        ? deps.avatarUrl(lastLine.characterId)
        : characterId
          ? deps.avatarUrl(characterId)
          : null
    if (avatarSrc !== avatarFor) {
      avatarFor = avatarSrc
      if (avatarSrc) {
        avatar.src = avatarSrc
        avatar.hidden = false
      } else {
        avatar.removeAttribute('src')
        avatar.hidden = true
      }
    }

    // LIVE + countdown.
    if (s.live && s.autoStopAt) {
      live.textContent = `LIVE · ${clock(s.autoStopAt - Date.now())}`
      live.hidden = false
    } else {
      live.hidden = true
    }

    // The caption: the newest reaction, or why there was none. It keeps the
    // last reaction while the next one is pending; the strip says "thinking".
    let captionText = ''
    const partial = s.awaitingReaction ? (s.partialLines ?? []) : []
    if (partial.length) captionText = partial.map((l) => (l.name ? `${l.name}: ${l.text}` : l.text)).join('\n')
    else if (reaction?.ok && reaction.lines?.length) captionText = reaction.lines.map((l) => (l.name ? `${l.name}: ${l.text}` : l.text)).join('\n')
    else if (reaction?.ok && reaction.text) captionText = reaction.text
    else if (reaction && !reaction.ok) captionText = quietReason(reaction)
    caption.textContent = captionText
    caption.hidden = !captionText
    // D-059: a reason for silence is not a character's line; "Lines only" hides it.
    caption.classList.toggle('hl-pane-caption-quiet', !partial.length && !!reaction && !reaction.ok)
    // D18: where the tip came from, when the reaction had looked-up notes.
    if (captionText && !partial.length && reaction?.ok && reaction.lookedUp) {
      const mark = el('span', 'hl-pane-looked', ' · had notes')
      caption.appendChild(mark)
    }

    // The strip.
    const bits: string[] = []
    // D-099: what the character is being told is on screen, where it can be seen at a glance.
    const watchingBit = watchingLine(s.watching)
    if (watchingBit) bits.push(watchingBit)
    const chatLabel = s.chat.chat ? (s.chat.chat.characterName ? `${s.chat.chat.characterName} · ${s.chat.chat.name}` : s.chat.chat.name) : ''
    const pinned = s.chat.mode === 'pinned'
    if (!s.chat.chat) bits.push('No chat open')
    else if (!s.chat.enabled) bits.push(`Reactions off in ${chatLabel}`)
    // D-090 (D4): "Watching" is what is on screen, so the chat line says where reactions go.
    else bits.push(`${pinned ? 'Pinned to' : 'Reacting in'}: ${chatLabel}`)
    const waiting = s.chat.newReactions ?? 0
    if (waiting > 0) bits.push(`${waiting} new`)
    strip.title = s.chat.chat ? chatLabel : '' // the whole name, when the strip cuts it short
    // D-046: say why the skip key is not skipping.
    if (s.live && s.mediaKeyHeld) bits.push('⏭ = Look')
    const h = hushNow()
    // The button carries the countdown for a hush you pressed; the strip only says the automatic one.
    if (h.hushed && h.source === 'conversation') bits.push(`quiet while you talk ${clock(h.remainingMs)}`)
    strip.textContent = bits.join(' · ')
    const warn = s.live ? stopWarningText(s.autoStopAt, s.stopWarnAt, Date.now()) : ''
    stopWarnText.textContent = warn ? `${warn} · ` : ''
    if (stopWarn.hidden !== !warn) {
      stopWarn.hidden = !warn
      requestAnimationFrame(fitGlance)
    }

    // Controls.
    lookBtn.disabled = !s.canCapture || s.busy || s.awaitingReaction || !s.chat.chat || !s.chat.enabled
    photoBtn.disabled = pictureBtn.disabled = s.busy || s.awaitingReaction || !s.chat.chat || !s.chat.enabled
    // Send-and-look needs a screen to look at: on a phone, the computer's (D-063), or none.
    const companion = phone && engine.companion?.() === true
    if (phone) lookSendBtn.hidden = !companion
    remoteBtn.hidden = !companion
    remoteBtn.disabled = s.busy || s.awaitingReaction || !s.chat.chat || !s.chat.enabled
    lookBtn.textContent = s.busy || s.awaitingReaction ? '…' : 'Look'
    const workingWas = workingLine.hidden
    workingLine.textContent = s.awaitingReaction ? (s.working ?? 'Waiting for the reaction…') : ''
    workingLine.hidden = !s.awaitingReaction
    if (workingWas !== workingLine.hidden) requestAnimationFrame(fitGlance)
    applyPortrait()
    applyView()
    sendBtn.disabled = s.awaitingReaction || !s.chat.chat
    lookSendBtn.disabled = s.awaitingReaction || !s.chat.chat || (!s.canCapture && !companion) || s.busy
    renderEye()
    talkInput.disabled = !s.chat.chat
    // D16: voice controls render only where the host can, and media is granted.
    voiceBtn.hidden = !deps.voice.canSpeak()
    const out = deps.voice.voiceOut()
    setIcon(voiceBtn, out ? 'volume-2' : 'volume-x', 'Speak aloud')
    voiceBtn.setAttribute('aria-pressed', String(out))
    voiceBtn.classList.toggle('hl-pane-voice-on', out)
    micBtn.hidden = !deps.voice.canListen()
    const listening = deps.voice.listening() || listenPhase !== null
    setIcon(micBtn, listening ? 'square' : 'mic', listening ? 'Stop' : 'Talk')
    micBtn.classList.toggle('hl-pane-talk-mic-on', listening)
    micBtn.disabled = !s.chat.chat
    const pressed = buttonHushed()
    hushBtn.textContent = pressed ? `Hushed · ${clock(hushNow().remainingMs)}` : 'Hush'
    hushBtn.classList.toggle('hl-pane-btn-on', pressed)
    grip.hidden = popout !== null // A pop-out window resizes like any window.
    stopBtn.hidden = !s.live
    extendBtn.hidden = !s.live
    const elsewhere = !!s.chat.chat && s.chat.activeChatId !== undefined && s.chat.activeChatId !== s.chat.chat.id
    openBtn.hidden = phone || (popout === null && !elsewhere)
    openBtn.textContent = popout ? 'Back to Lumiverse' : 'Open in Lumiverse'
    // D-090: on a phone or tablet the widget folds to the popcorn disc (the old "eye" was wrong since D-077).
    setIcon(expandBtn, phone || expanded ? 'minimize-2' : 'maximize-2', phone ? 'Fold away' : expanded ? 'Shrink' : 'Expand')
    setIcon(popBtn, 'picture-in-picture-2', popout ? 'Pop in' : 'Pop out')

    // Expanded: the tail. Refetch when a reaction landed or the chat changed.
    if (expanded) {
      if (reaction !== lastSeenReaction || s.chat.chat?.id !== lastSeenChatId) requestTail()
      // Redraw the list only when the chat changed; every other redraw comes
      // from `setTail`. The ticker runs this every second and must not touch it.
      if (s.chat.chat?.id !== lastSeenChatId) renderTail()
    }
    if (reaction !== lastSeenReaction && reaction?.trigger === 'talk' && pendingLine !== null) {
      if (!reaction.ok && !talkInput.value) talkInput.value = pendingLine
      pendingLine = null
    }
    lastSeenReaction = reaction
    lastSeenChatId = s.chat.chat?.id

    // D17: the stance select follows the chat; a Custom stance with no text yet says so.
    const stance = s.chat.stance ?? DEFAULT_STANCE
    if (stanceSelect.value !== stance) stanceSelect.value = stance
    stanceSelect.disabled = !s.chat.chat
    // A group chat sets stances per viewer, in the tab: no chat-wide switch to slip on.
    stanceRow.hidden = !!s.chat.box

    // Errors from the engine, briefly.
    renderChip()
    chip.hidden = phone // D-056: the game-name chip means nothing to a camera
    const statusWas = status.hidden
    if (s.status.kind === 'err' && s.status.text) {
      status.textContent = s.status.text
      status.hidden = false
    } else {
      status.hidden = true
    }
    if (statusWas !== status.hidden) requestAnimationFrame(fitGlance)
  }

  function quietReason(r: NonNullable<EngineSnapshot['lastReaction']>): string {
    if (r.error) return `Reaction failed: ${r.error}`
    switch (r.reason) {
      case 'no-chat':
        return 'No chat to react in.'
      case 'chat-off':
        return 'Reactions are off for this chat.'
      case 'busy':
        return 'Held back: a reply was being written.'
      case 'already-reacting':
        return 'Still on the previous picture.'
      case 'hush':
        return 'Staying quiet.'
      case 'cooldown':
        return 'Saw it. Saving the next remark.'
      case 'kind':
        return 'Nothing worth saying here.'
      case 'boring':
        return 'Saw it. Not worth a word.'
      case 'repeat':
        return 'Nothing new since the last reaction.'
      default:
        return 'Nothing said.'
    }
  }

  function setExpanded(next: boolean): void {
    // D-056: on a phone there is no glance state — shrinking folds the widget to the eye.
    if (phone && !next) {
      foldToDisc()
      return
    }
    expanded = next
    root.classList.toggle('hl-pane-expanded', expanded)
    more.hidden = !expanded
    if (expanded) {
      requestTail()
      renderTail()
    }
    const size = sizes[expanded ? 'expanded' : 'glance']
    if (popout) {
      try {
        popout.resizeTo?.(size.width, size.height + (popout.outerHeight - popout.innerHeight))
      } catch {
        // Needs a user activation; the toggle button is one, but be safe.
      }
    } else widget.setSize(size.width, size.height)
    render()
    if (!expanded) requestAnimationFrame(fitGlance)
  }

  // --- D-056: on a phone, the widget folds to an eye on a disc ----------------------
  // Like AdventureTime's mobile launcher: a small chromeless widget in the
  // theme's accent colour, over the chat while the widget is folded. A tap
  // opens the widget (expanded); the host drags the disc like any widget, so a
  // press that moved is a drag, not a tap.
  let disc: ReturnType<SpindleFrontendContext['ui']['createFloatWidget']> | null = null
  function mountDisc(): boolean {
    if (disc) return true
    try {
      disc = create!.call(ctx.ui, {
        width: DISC_SIZE,
        height: DISC_SIZE,
        initialPosition: {
          x: Math.max(0, window.innerWidth - DISC_SIZE - DISC_MARGIN.right),
          y: Math.max(0, window.innerHeight - DISC_SIZE - DISC_MARGIN.bottom),
        },
        snapToEdge: true,
        tooltip: 'Houselights',
        chromeless: true,
      })
    } catch (err) {
      console.warn('[Houselights] the folded eye could not be made; the widget stays open', err)
      disc = null
      return false
    }
    const face = disc.root
    face.classList.add('hl-disc')
    face.setAttribute('role', 'button')
    face.setAttribute('tabindex', '0')
    face.setAttribute('aria-label', 'Open Houselights')
    face.innerHTML = HOUSELIGHTS_ICON
    let pressed: { x: number; y: number } | null = null
    face.addEventListener('pointerdown', (ev) => { pressed = { x: ev.clientX, y: ev.clientY } }, true)
    face.addEventListener('click', (ev) => {
      const from = pressed
      pressed = null
      if (from && (Math.abs(ev.clientX - from.x) > DISC_TAP_SLOP || Math.abs(ev.clientY - from.y) > DISC_TAP_SLOP)) return
      openFromDisc()
    })
    face.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      ev.preventDefault()
      openFromDisc()
    })
    return true
  }
  function foldToDisc(): void {
    if (!mountDisc()) return
    widget.setVisible(false)
    disc!.setVisible(true)
  }
  function openFromDisc(): void {
    disc?.setVisible(false)
    widget.setVisible(true)
    setExpanded(true)
  }

  // --- pop-out (R1) ---------------------------------------------------------------
  /**
   * D-092: a change of theme reaches the widget and the pop-out while they are open. Both used to
   * fix their colours once (the widget's backing sampled when it was made, the pop-out's variables
   * copied when it opened), so a switch between light and dark needed a reload. Lumiverse applies a
   * theme by setting variables on the page's root element; watching that is enough.
   */
  let popoutStyle: HTMLStyleElement | null = null
  function readTheme(computed: CSSStyleDeclaration): { theme: Map<string, string>; canvas: Rgba } {
    const theme = new Map<string, string>()
    for (const name of THEME_VARS) theme.set(name, computed.getPropertyValue(name).trim())
    return { theme, canvas: effectiveBackground(widget.root) }
  }
  function paintPopout(doc: Document, theme: Map<string, string>, canvas: Rgba): void {
    doc.documentElement.style.colorScheme = isDark(canvas) ? 'dark' : 'light'
    doc.documentElement.style.background = cssColor(canvas)
    for (const [name, value] of theme) if (value) doc.documentElement.style.setProperty(name, value)
    if (popoutStyle) popoutStyle.textContent = resolveThemeCss(PANE_STYLES + POPOUT_STYLES, (name) => theme.get(name) ?? '')
  }
  function syncTheme(): void {
    if (!alive) return
    try {
      if (popout) {
        // The pop-out's root lives in its own document now: read the theme from the page's.
        const { theme, canvas } = readTheme(getComputedStyle(document.documentElement))
        const fill = parseColor(theme.get('--lumiverse-fill') ?? '')
        theme.set('--hl-surface', cssColor(fill ? over(canvas, fill) : canvas))
        paintPopout(popout.document, theme, canvas)
        // The root carries the page's sample inline, which would beat the pop-out's own values.
        root.style.removeProperty('--hl-surface')
        if (!phone) root.style.backgroundColor = cssColor(canvas)
        return
      }
      // In the page: sample the backing again (not on a phone, which paints the theme's own colour).
      if (!phone) root.style.backgroundColor = cssColor(effectiveBackground(widget.root))
      surfaceAt = 0
      refreshSurface()
    } catch {
      // Not laid out yet; the next change of theme tries again.
    }
  }
  let themeTimer: ReturnType<typeof setTimeout> | null = null
  const onThemeChange = (): void => {
    if (themeTimer) clearTimeout(themeTimer)
    // A theme is applied variable by variable: wait for the last one.
    themeTimer = setTimeout(() => {
      themeTimer = null
      syncTheme()
    }, 150)
  }
  const themeObserver = typeof MutationObserver === 'function' ? new MutationObserver(onThemeChange) : null
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
  const schemeQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  schemeQuery?.addEventListener?.('change', onThemeChange)

  async function togglePopout(): Promise<void> {
    if (popout) {
      popout.close()
      return
    }
    const api = (window as Window & { documentPictureInPicture?: DocPiP }).documentPictureInPicture
    if (!api) return
    try {
      const size = sizes[expanded ? 'expanded' : 'glance']
      // Read the theme while the Pane is still in the page: the resolved value
      // of every variable we use, and the solid colour the page paints under
      // the Pane (the host's fills are translucent and only look right on it).
      const { theme, canvas } = readTheme(getComputedStyle(root))
      console.info(`[Houselights] pop-out theme canvas=${cssColor(canvas)} text=${theme.get('--lumiverse-text') || '(unset)'} fill=${theme.get('--lumiverse-fill') || '(unset)'}`)

      const w = await api.requestWindow({ width: size.width, height: size.height })
      popout = w
      const doc = w.document
      doc.title = 'Houselights'
      popoutStyle = doc.createElement('style')
      doc.head.appendChild(popoutStyle)
      paintPopout(doc, theme, canvas)
      doc.body.appendChild(root) // Adopted across documents; listeners survive.
      widget.setVisible(false)
      requestAnimationFrame(fitGlance)
      w.addEventListener('pagehide', () => {
        popout = null
        popoutStyle = null
        if (!alive) return
        widget.root.appendChild(root)
        widget.setVisible(true)
        syncTheme() // the theme may have changed while it was out
        render()
      })
      render()
    } catch (err) {
      snapshot = { ...snapshot, status: { text: `Could not pop out: ${err instanceof Error ? err.message : String(err)}`, kind: 'err' } }
      render()
    }
  }

  const unsubscribe = engine.subscribe((s) => {
    snapshot = s
    render()
  })
  const ticker = setInterval(() => {
    if (snapshot.live || hush.hushed || snapshot.awaitingReaction) render()
    if (hush.hushed && !hushNow().hushed) hush = hushNow() // ran out: settle once
  }, 1000)
  render()
  // Opens expanded (D-056 on a phone; everywhere since 2026-11-16): the chat under the picture is the point.
  setExpanded(true)

  return {
    available: true,
    setHush(next) {
      hush = next
      hushEndsAt = next.hushed ? Date.now() + Math.max(0, next.remainingMs) : 0
      render()
    },
    refresh() {
      render()
    },
    popOut() {
      if (!popout) void togglePopout()
    },
    previewPortrait(preview) {
      textPreview = preview?.textPct ?? null
      portraitPreview = preview && (preview.sizePct !== undefined || preview.opacityPct !== undefined) ? preview : null
      applyView()
      applyPortrait()
    },
    setTail(next) {
      tail = next
      if (expanded) renderTail()
    },
    noteActivity() {
      requestTail()
    },
    destroy() {
      alive = false
      clearInterval(ticker)
      if (tailRetry !== null) clearTimeout(tailRetry)
      themeObserver?.disconnect()
      schemeQuery?.removeEventListener?.('change', onThemeChange)
      if (themeTimer) clearTimeout(themeTimer)
      unsubscribe()
      unsubComposer()
      cancelCountdown()
      deps.voice.cancelListening()
      if (popout) {
        try {
          popout.close()
        } catch {
          // Already closed.
        }
        popout = null
      }
      removeStyle()
      disc?.destroy()
      widget.destroy()
    },
  }
}

function unavailable(): Pane {
  return { available: false, setHush() {}, setTail() {}, refresh() {}, popOut() {}, previewPortrait() {}, noteActivity() {}, destroy() {} }
}

export const PANE_STYLES = `
  .hl-pane [hidden] { display: none !important; }
  .hl-pane { display: flex; flex-direction: column; gap: 6px; padding: 8px; box-sizing: border-box;
             width: 100%; height: 100%; overflow: hidden;
             font: calc(12px * var(--lumiverse-font-scale, 1))/1.4 system-ui, sans-serif; color: var(--lumiverse-text, inherit);
             background: var(--lumiverse-fill, rgba(20,20,28,0.95));
             border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
             border-radius: var(--lumiverse-radius, 8px); user-select: none; }
  .hl-pane-glass { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden;
                   border-radius: var(--lumiverse-radius, 6px);
                   background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.12)); flex: 0 0 auto; }
  /* Expanded: the glass is sized from a share of the height and shrink-wraps the frame, so a wide
     Pane doesn't leave the picture floating in a wide empty box. */
  .hl-pane-expanded .hl-pane-glass { width: auto; height: clamp(72px, 36%, 360px); max-width: 100%;
                                     align-self: center; }
  .hl-pane-frame { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hl-pane-expanded .hl-pane-frame { object-fit: contain; }
  .hl-pane-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                   color: var(--lumiverse-text-dim, inherit); opacity: 0.8; text-align: center; padding: 8px; }
  .hl-pane-avatar { position: absolute; top: 6px; left: 6px; height: 25%; width: auto; aspect-ratio: 1 / 1;
                    min-width: 18px; min-height: 18px; max-height: calc(100% - 12px); box-sizing: border-box;
                    border-radius: 50%; object-fit: cover; border: 2px solid var(--lumiverse-fill, rgba(0,0,0,0.6));
                    background: var(--lumiverse-fill-subtle, transparent); }
  /* D-059: the picture's top-right corner: LIVE and the two view toggles, one tap each. */
  .hl-pane-corner { position: absolute; top: 6px; right: 6px; display: flex; flex-wrap: wrap; gap: 4px;
                    align-items: center; justify-content: flex-end; max-width: 62%; }
  /* D-062: solid, so the picture under them can't drown the text (light theme over a dark frame). */
  .hl-pane-corner .hl-pane-corner-btn { flex: 0 0 auto; padding: 2px 7px; font-size: 0.78em; line-height: 1.4;
                                        border-radius: 999px; white-space: nowrap;
                                        background: var(--hl-surface, var(--lumiverse-fill, rgba(20,20,28,0.85)));
                                        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); }
  .hl-pane-corner .hl-pane-corner-on { opacity: 1; border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  /* Hide pic: the picture and its placeholder go; the portraits and the lines stay. D-060: the
     top area shrinks to the portrait (the size it would have over the picture), with the corner
     and the newest line beside it; a long line makes it taller. */
  .hl-pane-nopic .hl-pane-frame, .hl-pane-nopic .hl-pane-empty { display: none !important; }
  .hl-pane .hl-pane-glass.hl-pane-glass-nopic { aspect-ratio: auto; height: auto; width: 100%; max-width: 100%;
                                               display: grid; grid-template-columns: auto minmax(0, 1fr);
                                               grid-template-rows: auto 1fr; column-gap: 8px; row-gap: 4px;
                                               padding: 6px; box-sizing: border-box; }
  .hl-pane-glass-nopic .hl-pane-avatar { position: static; grid-row: 1 / 3; grid-column: 1; max-height: none; }
  .hl-pane-glass-nopic .hl-pane-corner { position: static; grid-row: 1; grid-column: 2; max-width: none; justify-self: end; }
  .hl-pane-glass-nopic .hl-pane-caption { position: static; grid-row: 2; grid-column: 2; padding: 0; background: none;
                                          -webkit-line-clamp: 4; align-self: start; }
  /* Lines only: every line that isn't a character's. Controls and the talk box stay usable. */
  .hl-pane-lines-only .hl-pane-strip, .hl-pane-lines-only .hl-pane-status, .hl-pane-lines-only .hl-pane-working,
  .hl-pane-lines-only .hl-pane-chip, .hl-pane-lines-only .hl-pane-empty, .hl-pane-lines-only .hl-pane-looked,
  .hl-pane-lines-only .hl-pane-caption-quiet, .hl-pane-lines-only .hl-pane-tail-beat,
  .hl-pane-lines-only .hl-pane-tail-system,
  .hl-pane-lines-only .hl-pane-tail-time, .hl-pane-lines-only .hl-pane-tail-empty { display: none !important; }
  .hl-pane-live { padding: 2px 6px; border-radius: 999px; flex: 0 0 auto;
                  font-size: 0.78em; font-weight: 600; letter-spacing: 0.04em;
                  background: var(--lumiverse-accent, var(--lumiverse-primary, #c33)); color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); }
  .hl-pane-caption { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 8px 6px;
                     color: var(--lumiverse-text, #fff);
                     /* D-062: solid behind the text, fading out only in the top padding. */
                     background: linear-gradient(to top, var(--hl-surface, var(--lumiverse-fill, rgba(0,0,0,0.85))) calc(100% - 18px), transparent);
                     display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .hl-pane-expanded .hl-pane-caption { display: none; }
  .hl-pane-strip { font-size: 0.92em; color: var(--lumiverse-text-muted, inherit); white-space: nowrap;
                   overflow: hidden; text-overflow: ellipsis; flex: none; }
  .hl-pane-chip { display: flex; align-items: center; gap: 4px; flex: none; font-size: 0.92em; }
  .hl-pane-chip-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                       padding: 3px 6px; border-radius: 999px;
                       background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.12));
                       border: 1px solid var(--lumiverse-accent, var(--lumiverse-primary, rgba(128,128,128,0.4))); }
  .hl-pane-chip .hl-pane-btn { flex: 0 0 auto; padding: 2px 6px; }
  .hl-pane-chip-unset .hl-pane-chip-text { border-style: dashed; color: var(--lumiverse-text-dim, inherit); }
  /* D-099: "Still <name>?": a question waiting for an answer. */
  .hl-pane-chip-ask .hl-pane-chip-text { border-style: dashed; border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-pane-warn { flex: none; font-size: 0.92em; color: var(--lumiverse-warning, var(--lumiverse-text, inherit)); white-space: nowrap; }
  .hl-pane-warn-btn { font: inherit; cursor: pointer; padding: 1px 8px; color: var(--lumiverse-text, inherit);
                      background: var(--lumiverse-fill-subtle, transparent); border: 1px solid var(--lumiverse-warning, var(--lumiverse-border, rgba(128,128,128,0.3)));
                      border-radius: var(--lumiverse-radius, 6px); }
  .hl-pane-chip-input { flex: 1; min-width: 0; padding: 3px 6px; font: inherit; color: var(--lumiverse-text, inherit);
                        background: var(--lumiverse-fill-subtle, transparent);
                        border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                        border-radius: var(--lumiverse-radius, 6px); user-select: text; }
  .hl-pane-controls { display: flex; gap: 4px; flex: none; }
  /* Buttons keep one size whatever the text size: the row has to fit the widget. */
  .hl-pane-btn { flex: 1; min-width: 0; padding: 5px 6px; font: inherit; font-size: 0.92em; cursor: pointer;
                 color: var(--lumiverse-text, inherit); background: var(--lumiverse-fill-subtle, transparent);
                 border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                 border-radius: var(--lumiverse-radius, 6px); transition: border-color var(--lumiverse-transition-fast, 120ms); }
  .hl-pane-btn:hover { border-color: var(--lumiverse-border-hover, var(--lumiverse-accent, var(--lumiverse-primary, currentColor))); }
  .hl-pane-btn:disabled { opacity: 0.5; cursor: default; }
  /* The icon buttons keep their size; the word buttons (Look / 📷 🖼 on a phone, Hush, Stop) share the rest. */
  .hl-pane-controls .hl-pane-btn-compact { flex: 0 0 auto; }
  /* D-090 (D5): icon buttons, a 28 px square with a 14 px line icon; the word shows on a phone. */
  .hl-pane-icon-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px;
                      min-width: 28px; min-height: 28px; padding: 0 6px; flex: 0 0 auto; }
  .hl-pane-icon-btn .hl-icon { display: inline-flex; line-height: 0; }
  .hl-pane-icon-btn .hl-icon svg { display: block; }
  /* D-091 (asked for after 0.1.6): icons only on a phone too; the words made the row wrap. */
  /* D-091: on a phone or tablet the widget gets an opaque backing in the theme's own page colour.
     It is chromeless, and a light theme's fill is a 6 % black wash, so it used to show whatever was
     behind it: over a dark chat background, a light theme's dark text sat on near-black. */
  .hl-pane.hl-pane-phone { background-color: var(--lumiverse-bg, Canvas);
                           background-image: linear-gradient(var(--lumiverse-fill, transparent), var(--lumiverse-fill, transparent)); }
  .hl-pane-chip .hl-pane-btn-danger { margin-left: 6px; color: var(--lumiverse-danger, rgb(220,70,70)); }
  .hl-pane-more { display: flex; flex-direction: column; gap: 6px; min-height: 5em; flex: 1 1 auto; min-height: 0; }
  .hl-pane-tail { flex: 1 1 auto; min-height: 3em; overflow: auto; display: flex; flex-direction: column; gap: 4px;
                  padding-right: 2px; }
  .hl-pane-tail-empty { color: var(--lumiverse-text-dim, inherit); font-size: 0.92em; }
  .hl-pane-tail-row { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.35; }
  .hl-pane-tail-name { font-weight: 600; margin-right: 4px; }
  .hl-pane-tail-avatar { width: 16px; height: 16px; border-radius: 50%; object-fit: cover; vertical-align: -3px; margin-right: 4px; }
  .hl-pane-caption { white-space: pre-line; }
  .hl-pane-looked { font-size: 0.92em; opacity: 0.75; white-space: nowrap; }
  .hl-pane-tail-time { color: var(--lumiverse-text-dim, inherit); font-size: 0.84em; margin-left: 6px; white-space: nowrap; }
  .hl-pane-tail-user { color: var(--lumiverse-text-muted, inherit); }
  .hl-pane-tail-beat { font-size: 0.92em; color: var(--lumiverse-text-dim, inherit); padding-left: 8px;
                       border-left: 2px solid var(--lumiverse-border, rgba(128,128,128,0.3)); }
  .hl-pane-tail-system { font-size: 0.92em; color: var(--lumiverse-text-dim, inherit); }
  .hl-pane-tail-hidden { opacity: 0.5; }
  .hl-pane-talk { display: flex; gap: 4px; flex: none; }
  .hl-pane-talk-input { flex: 1; min-width: 0; padding: 5px 6px; font: inherit; color: var(--lumiverse-text, inherit);
                        background: var(--lumiverse-fill-subtle, transparent);
                        border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                        border-radius: var(--lumiverse-radius, 6px); user-select: text; }
  .hl-pane-talk-input:focus { outline: none; border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-pane-stance { display: flex; align-items: center; gap: 6px; flex: none; font-size: 0.92em; }
  .hl-pane-stance-label { color: var(--lumiverse-text-dim, inherit); }
  .hl-pane-stance-select { flex: 1; min-width: 0; padding: 3px 4px; font: inherit; color: var(--lumiverse-text, inherit);
                           background: var(--lumiverse-fill-subtle, transparent);
                           border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                           border-radius: var(--lumiverse-radius, 6px); }
  /* D-062: a native list draws a translucent option over white; give its rows the solid surface. */
  .hl-pane-stance-select option { background-color: var(--hl-surface, Canvas); color: var(--lumiverse-text, CanvasText); }
  .hl-pane-stance-select:focus { outline: none; border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-pane-talk .hl-pane-btn { flex: 0 0 auto; }
  .hl-pane-talk-mic-on, .hl-pane-voice-on, .hl-pane-btn-on { border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-pane-talk-note { font-size: 0.92em; color: var(--lumiverse-text-dim, inherit); flex: none; }
  .hl-pane-talk-note-err { color: var(--lumiverse-text, inherit); border-left: 3px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); padding-left: 6px; }
  .hl-pane-more-row { display: flex; gap: 4px; flex: none; }
  .hl-pane-more-row .hl-pane-btn { flex: 1; }
  .hl-pane-more-text { white-space: pre-wrap; }
  .hl-pane-more-seen { font-size: 0.92em; color: var(--lumiverse-text-dim, inherit); }
  .hl-pane-working { position: absolute; left: 6px; bottom: 6px; max-width: calc(100% - 12px); z-index: 2;
                     padding: 2px 8px; border-radius: 999px; font-size: 0.92em;
                     color: var(--lumiverse-text, inherit); background: var(--hl-surface, var(--lumiverse-fill, rgba(0,0,0,0.85)));
                     border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.35));
                     white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-sizing: border-box; }
  /* At a glance the caption also sits at the bottom: lift it above the progress pill while it shows. */
  .hl-pane-glass:has(.hl-pane-working:not([hidden])) .hl-pane-caption { bottom: 26px; }
  /* D-056: the folded eye on a phone, a disc in the theme's accent colour. */
  .hl-disc { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
             box-sizing: border-box; border-radius: 50%; cursor: pointer; touch-action: none; user-select: none;
             -webkit-user-select: none; background: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2));
             color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); }
  .hl-disc svg { width: 58%; height: 58%; display: block; }
  .hl-disc:active { filter: brightness(1.1); }
  .hl-pane-status { font-size: 0.92em; color: var(--lumiverse-text, inherit); padding: 4px 6px;
                    border-left: 3px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); flex: none; }
  .hl-pane { position: relative; }
  .hl-pane-grip { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
                  touch-action: none; opacity: 0.55;
                  background: linear-gradient(135deg, transparent 0 50%, var(--lumiverse-text-dim, rgba(128,128,128,0.6)) 50% 60%,
                              transparent 60% 70%, var(--lumiverse-text-dim, rgba(128,128,128,0.6)) 70% 80%, transparent 80%); }
  .hl-pane-grip:hover { opacity: 1; }
  /* D-090: the phone, in one block at the end (style guide §6, Lumiverse's own test for a phone):
     every button reaches the 28 px floor. The desktop reads none of it. */
  @media (pointer: coarse), (max-width: 600px) {
    .hl-pane .hl-pane-btn, .hl-pane .hl-pane-corner .hl-pane-corner-btn { min-height: 28px; min-width: 28px; }
    .hl-pane .hl-pane-chip-input, .hl-pane .hl-pane-talk-input { min-height: 28px; }
  }
`

const POPOUT_STYLES = `
  html, body { margin: 0; height: 100%; }
  body { background: var(--lumiverse-fill, rgba(0,0,0,0.15)); }
  .hl-pane { border: none; border-radius: 0; height: 100vh; }
`
