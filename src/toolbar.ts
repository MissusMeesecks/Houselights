/**
 * D19 — on a phone or tablet, the widget is a toolbar over the real chat.
 *
 * The popcorn disc unfolds into one small row of buttons (two rows only if the
 * screen is too narrow), not a window. Reactions are read in Lumiverse's own
 * chat, where they land as ordinary messages, so the toolbar shows no picture
 * and no chat tail: the expanded phone widget (D-055/D-056) was Lumiverse inside
 * Lumiverse, the trap D12 was written to avoid.
 *
 * Buttons, in order: Look (following the computer only), Photo and Picture (the
 * phone's own camera; always, D-095), Hush, the speaker, ? and Fold. Under them,
 * one line while something is happening, and nothing when idle.
 *
 * Look is one button whose label follows Lumiverse's chat box (`composer-v1`, see
 * composer.ts; D-096): empty, it reads Look and the computer takes a plain look;
 * with something typed it reads Send + look and sends that with a fresh look
 * through talk-back (D14). The chat box belongs to the chat on screen: when that
 * is not the chat reactions go to, the button becomes Go to chat, because the
 * reaction has to land where it can be seen. On a host without `composer-v1` the
 * button stays Look, and a small pencil beside it opens a one-line input.
 *
 * ? turns on explain mode: the next tap on a button says what it does, on the
 * status line, instead of doing it. (No long-press: the host uses it on widgets.)
 *
 * The host drags it and snaps it to an edge; this module remembers where it was
 * left (per device) and keeps it above the on-screen keyboard and the chat box.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { HOUSELIGHTS_ICON, stopWarningText, watchingLine, type EngineSnapshot } from './capture.ts'
import type { ComposerBridge } from './composer.ts'
import { icon, type IconName } from './icons.ts'
import type { Pane, PaneHush } from './pane.ts'
import { DISC_SIZE } from './pane.ts'

export interface ToolbarEngine {
  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void
  snapshot(): EngineSnapshot
  /** The phone's camera app / a picture from its files. Inside the click. */
  takePhoto(): void
  choosePicture(): void
  /** D-063: this phone follows the computer. */
  companion(): boolean
  /** D-063: ask the computer to look, with a line to send (D14) or without. */
  remoteLook(talk?: string): void
  /** D-099: ask the computer for more time before its session stops itself. */
  extend(): void
}

export interface ToolbarDeps {
  ctx: SpindleFrontendContext
  engine: ToolbarEngine
  voice: { canSpeak(): boolean; voiceOut(): boolean; setVoiceOut(on: boolean): void }
  composer: ComposerBridge
  /** Hush (true) or lift the hush (false). */
  onHush(hushed: boolean): void
  /** Open a chat by id; null when the host can't (then the toolbar says which chat to open). */
  openChat: ((chatId: string) => void) | null
}

export interface Toolbar extends Pane {
  /** The backend appended a line the user said: clear the fallback input if it was that line. */
  landed(chatId: string, text: string): void
  /** D-096: "Show tips again": the one-time hint comes back. */
  showTips(): void
}

/** Space kept clear under the toolbar for Lumiverse's chat box (the disc uses the same). */
const CLEAR_BOTTOM = 96
const EDGE = 16
const TAP_SLOP = 8
/** How long a finished step or a failure stays on the status line. */
const STATUS_HOLD_MS = 15_000
/** Explain mode gives up after this long without a tap. */
const EXPLAIN_IDLE_MS = 6_000
const STORE = {
  pos: 'houselights.toolbar.pos',
  folded: 'houselights.toolbar.folded',
  disc: 'houselights.toolbar.disc',
  hintSeen: 'houselights.toolbar.hintSeen',
}
/** D-096: the one-time hint at the Look button. */
export const TOOLBAR_HINT = 'Type in the chat box, then tap here. They\'ll take a fresh look and answer you.'

function readStore<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode or blocked storage: the toolbar still works, it just won't remember
  }
}

function clock(ms: number): string {
  const secs = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

export function createToolbar(deps: ToolbarDeps): Toolbar {
  const { ctx, engine, composer } = deps
  const create = ctx.ui?.createFloatWidget
  const inert: Toolbar = {
    available: false,
    setHush() {},
    setTail() {},
    refresh() {},
    popOut() {},
    previewPortrait() {},
    noteActivity() {},
    destroy() {},
    landed() {},
    showTips() {},
  }
  if (typeof create !== 'function') return inert

  let widget: ReturnType<SpindleFrontendContext['ui']['createFloatWidget']>
  const saved = readStore<{ x: number; y: number }>(STORE.pos)
  try {
    widget = create.call(ctx.ui, {
      width: 240,
      height: 48,
      initialPosition: saved ?? { x: EDGE, y: Math.max(0, window.innerHeight - 48 - CLEAR_BOTTOM) },
      snapToEdge: true,
      tooltip: 'Houselights',
      chromeless: true,
    })
  } catch (err) {
    console.warn('[Houselights] the toolbar could not be made', err)
    return inert
  }
  const removeStyle = ctx.dom.addStyle(TOOLBAR_STYLES)

  const root = widget.root
  root.classList.add('hl-tb-host')
  const bar = document.createElement('div')
  bar.className = 'hl-tb'
  const row = document.createElement('div')
  row.className = 'hl-tb-row'
  // The second row, when the buttons are stacked into a box (see arrange()).
  const row2 = document.createElement('div')
  row2.className = 'hl-tb-row hl-tb-row2'
  row2.hidden = true
  const statusLine = document.createElement('div')
  statusLine.className = 'hl-tb-status'
  statusLine.setAttribute('role', 'status')
  statusLine.setAttribute('aria-live', 'polite')
  const inputRow = document.createElement('div')
  inputRow.className = 'hl-tb-input-row'
  const input = document.createElement('input')
  input.className = 'hl-tb-input'
  input.type = 'text'
  input.placeholder = 'Say something, then Enter'
  input.setAttribute('aria-label', 'Your line')
  input.enterKeyHint = 'send'
  inputRow.appendChild(input)
  inputRow.hidden = true
  // D-096: the one-time hint, a bubble over the Look button. Part of the bar, so it can't be clipped.
  const hint = document.createElement('button')
  hint.type = 'button'
  hint.className = 'hl-tb-hint'
  hint.textContent = TOOLBAR_HINT
  hint.setAttribute('aria-label', `${TOOLBAR_HINT} Tap to dismiss.`)
  hint.hidden = true
  // D-099: the last two minutes of the computer's session: "Stops in 1:42 · Extend".
  const warnLine = document.createElement('div')
  warnLine.className = 'hl-tb-warn'
  const warnText = document.createElement('span')
  const extendBtn = document.createElement('button')
  extendBtn.type = 'button'
  extendBtn.className = 'hl-tb-warn-btn'
  extendBtn.textContent = 'Extend'
  extendBtn.addEventListener('click', () => engine.extend())
  warnLine.append(warnText, extendBtn)
  warnLine.hidden = true
  bar.append(hint, row, row2, inputRow, statusLine, warnLine)
  root.appendChild(bar)

  function iconButton(name: IconName, word: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'hl-tb-btn hl-tb-icon-btn'
    b.addEventListener('click', onClick)
    setIcon(b, name, word)
    return b
  }
  function setIcon(b: HTMLButtonElement, name: IconName, word: string): void {
    if (b.dataset.icon !== name) {
      b.replaceChildren(icon(name, 18))
      b.dataset.icon = name
    }
    b.setAttribute('aria-label', word)
    b.title = word
  }
  function wordButton(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'hl-tb-btn hl-tb-word-btn'
    b.textContent = text
    b.addEventListener('click', onClick)
    return b
  }

  // --- the buttons (D19's order; D-096 made Look one button and added ?) ------------
  // Look: an eye and a word. Both words sit in one grid cell, so the button is as wide as the
  // longer one and the row keeps its shape when the label changes.
  const lookBtn = document.createElement('button')
  lookBtn.type = 'button'
  lookBtn.className = 'hl-tb-btn hl-tb-look'
  const lookLabel = document.createElement('span')
  lookLabel.className = 'hl-tb-label'
  const lookWord = document.createElement('span')
  lookWord.textContent = 'Look'
  const sendWord = document.createElement('span')
  sendWord.textContent = 'Send + look'
  lookLabel.append(lookWord, sendWord)
  lookBtn.append(icon('eye', 18), lookLabel)
  lookBtn.addEventListener('click', () => look())
  function setLook(sends: boolean): void {
    lookWord.classList.toggle('hl-tb-ghost', sends)
    sendWord.classList.toggle('hl-tb-ghost', !sends)
    lookBtn.setAttribute('aria-label', sends ? 'Send + look' : 'Look')
  }
  // Without composer-v1 the button only ever looks; the pencil opens the one-line input.
  const pencilBtn = iconButton('pencil', 'Type a line', () => {
    inputRow.hidden = !inputRow.hidden
    render()
    if (!inputRow.hidden) input.focus()
  })
  sendWord.hidden = !composer.available
  pencilBtn.hidden = composer.available
  const mainGroup = document.createElement('div')
  mainGroup.className = 'hl-tb-main'
  mainGroup.append(lookBtn, pencilBtn)
  const goBtn = wordButton('Go to chat', () => {
    const target = snapshot.chat.chat
    if (target && deps.openChat) deps.openChat(target.id)
  })
  goBtn.classList.add('hl-tb-main')
  const photoBtn = iconButton('camera', 'Photo', () => engine.takePhoto())
  const pictureBtn = iconButton('image', 'Picture', () => engine.choosePicture())
  const hushBtn = wordButton('Hush', () => deps.onHush(!buttonHushed()))
  const voiceBtn = iconButton('volume-x', 'Speak aloud', () => {
    deps.voice.setVoiceOut(!deps.voice.voiceOut())
    render()
  })
  const helpBtn = iconButton('circle-help', 'What do these do?', () => setExplain(!explain))
  const foldBtn = iconButton('minimize-2', 'Fold away', () => fold())
  row.append(mainGroup, goBtn, photoBtn, pictureBtn, hushBtn, voiceBtn, helpBtn, foldBtn)

  // --- state ------------------------------------------------------------------------
  let snapshot = engine.snapshot()
  let hush: PaneHush = { hushed: false, source: null, remainingMs: 0 }
  let hushEndsAt = 0
  const buttonHushed = (): boolean => hush.hushed && hush.source === 'button' && hushEndsAt > Date.now()
  /**
   * The status line holds a finished step or a failure for a while, then empties. Kept by the
   * engine's status object, not its text: once a status has run out it stays gone (in 0.1.11 a
   * redraw brought an old failure back), and the same failure a second time is shown again.
   */
  let statusSeen: { status: EngineSnapshot['status']; at: number } | null = null
  /** D-096: explain mode, and the explanation it last gave. */
  let explain = false
  let explainTimer: ReturnType<typeof setTimeout> | null = null
  let explained: { text: string; at: number } | null = null
  /** The fallback input's line, sent and not yet landed. */
  let pendingInput: { chatId: string; text: string } | null = null
  let alive = true

  // --- Look / Send + look ----------------------------------------------------------
  function look(): void {
    dismissHint()
    const target = snapshot.chat.chat
    if (!target) return
    // Older host: the button only looks; a line goes through the pencil's input.
    if (!composer.available) return engine.remoteLook()
    const draft = composer.current()
    // The button only shows while the chat box is the watched chat's; a stale press does nothing.
    if (!draft || draft.chatId !== target.id) return
    if (draft.text) {
      composer.sent(draft.chatId, draft.text)
      engine.remoteLook(draft.text)
    } else engine.remoteLook()
  }

  // --- the one-time hint (D-096) -----------------------------------------------------
  function dismissHint(): void {
    if (hint.hidden) return
    hint.hidden = true
    writeStore(STORE.hintSeen, true)
    requestAnimationFrame(fit)
  }
  hint.addEventListener('click', () => dismissHint())

  // --- explain mode (D-096) ----------------------------------------------------------
  /** What each button does, in one line. */
  function explanation(b: HTMLButtonElement): string {
    if (b === lookBtn) {
      return composer.available
        ? 'Your computer takes a fresh look. With something typed in the chat box, it sends that too.'
        : 'Your computer takes a fresh look.'
    }
    if (b === pencilBtn) return 'Type a line here to send it with a fresh look.'
    if (b === goBtn) return 'Opens the chat the reactions land in.'
    if (b === photoBtn) return 'Opens your camera. They react to the photo.'
    if (b === pictureBtn) return 'Pick a picture from your files. They react to it.'
    if (b === hushBtn) return buttonHushed() ? 'Hushed. Tap to let them talk again.' : 'They keep watching. They just can\'t talk about it.'
    if (b === voiceBtn) return 'Reads each reaction aloud.'
    if (b === foldBtn) return 'Folds this away to the popcorn. Tap the popcorn to bring it back.'
    if (b === extendBtn) return 'Gives the session on your computer more time before it stops itself.'
    return ''
  }
  function setExplain(on: boolean): void {
    explain = on
    if (explainTimer !== null) clearTimeout(explainTimer)
    explainTimer = on ? setTimeout(() => setExplain(false), EXPLAIN_IDLE_MS) : null
    if (on) explained = null
    render()
  }
  // Ahead of the buttons' own handlers: in explain mode a tap explains and does nothing else.
  bar.addEventListener('click', (ev) => {
    if (!explain) return
    const b = (ev.target as HTMLElement | null)?.closest('button') as HTMLButtonElement | null
    if (!b || b === helpBtn || b === hint) return
    ev.preventDefault()
    ev.stopPropagation()
    explained = { text: explanation(b), at: Date.now() }
    setExplain(false)
  }, true)

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      inputRow.hidden = true
      render()
      return
    }
    if (ev.key !== 'Enter' || ev.isComposing) return
    ev.preventDefault()
    const target = snapshot.chat.chat
    if (!target || !looksAllowed()) return
    const line = input.value.trim()
    if (line) {
      // Kept in the box (hidden) until it lands, so a failed look loses nothing.
      pendingInput = { chatId: target.id, text: line }
      engine.remoteLook(line)
    } else engine.remoteLook()
    inputRow.hidden = true
    render()
  })

  // --- render -----------------------------------------------------------------------
  /** A Look can be asked for right now. */
  function looksAllowed(): boolean {
    const s = snapshot
    return !s.busy && !s.awaitingReaction && !!s.chat.chat && s.chat.enabled
  }
  function statusText(s: EngineSnapshot, note: string | null, idle: string): { text: string; err: boolean; wrap?: boolean } {
    if (explain) return { text: 'Tap a button to see what it does.', err: false, wrap: true }
    if (explained && Date.now() - explained.at <= STATUS_HOLD_MS) return { text: explained.text, err: false, wrap: true }
    if (note) return { text: note, err: false }
    if (s.awaitingReaction || s.busy) return { text: s.working ?? s.status.text ?? 'Waiting for the reaction…', err: false }
    // Nothing happening: what the character is being told is on the computer's screen (D-099), or nothing.
    if (!s.status.text) return { text: idle, err: false }
    if (statusSeen?.status !== s.status) statusSeen = { status: s.status, at: Date.now() }
    if (Date.now() - statusSeen.at > STATUS_HOLD_MS) return { text: idle, err: false }
    // A failure is read in full: the box is narrow, and "Your computer is not sha…" tells nobody anything.
    return { text: s.status.text, err: s.status.kind === 'err', wrap: s.status.kind === 'err' }
  }

  function render(): void {
    if (!alive) return
    const s = snapshot
    const companion = engine.companion()
    const target = s.chat.chat
    const idle = looksAllowed()
    let note: string | null = null
    // In explain mode every button can be tapped, greyed or not: the tap only explains.
    const off = (b: HTMLButtonElement, disabled: boolean) => { b.disabled = explain ? false : disabled }

    // Following the computer adds Look. Photo and Picture (the phone's own camera) are always
    // there (D-095): following the computer doesn't take the camera away.
    off(photoBtn, !idle)
    off(pictureBtn, !idle)
    mainGroup.hidden = !companion
    goBtn.hidden = true
    let sends = false
    if (companion && composer.available && target) {
      const draft = composer.current()
      if (!draft || draft.chatId !== target.id) {
        // The chat box belongs to another chat (or there is none): the reaction must land where it's seen.
        mainGroup.hidden = true
        if (deps.openChat) goBtn.hidden = false
        else note = `Open ${target.name} to reply here.`
      } else sends = !!draft.text
    }
    setLook(sends)
    off(lookBtn, !idle)
    off(pencilBtn, !idle)
    if (inputRow.hidden === false && (!companion || composer.available)) inputRow.hidden = true

    // The hint shows once, at the Look button, while that button reads the chat box.
    const hintWanted = !mainGroup.hidden && composer.available && readStore<boolean>(STORE.hintSeen) !== true
    if (hint.hidden === hintWanted) hint.hidden = !hintWanted

    const pressed = buttonHushed()
    if (!pressed) hushShort = false
    hushBtn.classList.add('hl-tb-hush')
    const left = clock(hushEndsAt - Date.now())
    // D-095: on a narrow screen the countdown alone, so the row keeps its shape (see fit()).
    hushBtn.textContent = pressed ? (stacked || hushShort ? left : `Hushed · ${left}`) : 'Hush'
    hushBtn.setAttribute('aria-label', pressed ? `Hushed, ${left} left` : 'Hush')
    hushBtn.classList.toggle('hl-tb-on', pressed)
    hushBtn.setAttribute('aria-pressed', String(pressed))
    hushBtn.title = pressed ? 'Press to let them talk again.' : 'They keep watching. They just can\'t talk about it.'

    voiceBtn.hidden = !deps.voice.canSpeak()
    const out = deps.voice.voiceOut()
    setIcon(voiceBtn, out ? 'volume-2' : 'volume-x', 'Speak aloud')
    voiceBtn.setAttribute('aria-pressed', String(out))
    voiceBtn.classList.toggle('hl-tb-on', out)

    helpBtn.classList.toggle('hl-tb-on', explain)
    helpBtn.setAttribute('aria-pressed', String(explain))
    bar.classList.toggle('hl-tb-explaining', explain)

    // Watching is about the computer's screen, so it shows only while following the computer.
    const st = statusText(s, note, companion ? watchingLine(s.watching) : '')
    const warn = companion ? stopWarningText(s.autoStopAt, s.stopWarnAt, Date.now()) : ''
    warnText.textContent = warn ? `${warn} · ` : ''
    warnLine.hidden = !warn
    extendBtn.disabled = false
    statusLine.textContent = st.text
    statusLine.hidden = !st.text
    statusLine.classList.toggle('hl-tb-status-err', st.err)
    statusLine.classList.toggle('hl-tb-status-wrap', st.wrap === true)
    requestAnimationFrame(fit)
  }

  // --- size, place, keyboard ---------------------------------------------------------
  let size = { width: 0, height: 0 }
  /** The hushed button shows only its countdown: "Hushed · 4:32" made the row wrap. Until the hush ends. */
  let hushShort = false
  /** How many lines the buttons take. */
  function rows(): number {
    const tops = new Set<number>()
    for (const c of row.children) if (!(c as HTMLElement).hidden) tops.add((c as HTMLElement).offsetTop)
    return tops.size
  }
  /**
   * D-096/D-097: where the buttons don't fit one row (a phone held upright) they make a small box
   * of two rows: Look, Hush and ? on top, Photo, Picture, the speaker and Fold below. Where they
   * fit (a tablet, a phone on its side), one row in D19's order. Decided as if not hushed and with
   * Look as wide as its longer label, so nothing a press or a keystroke does changes the shape.
   */
  let stacked = false
  let arrangedFor = ''
  function arrange(): boolean {
    const was = stacked
    const hasMain = !mainGroup.hidden || !goBtn.hidden
    const shownText = hushBtn.textContent
    bar.classList.remove('hl-tb-stacked')
    row2.hidden = true
    row.append(mainGroup, goBtn, photoBtn, pictureBtn, hushBtn, voiceBtn, helpBtn, foldBtn)
    hushBtn.textContent = 'Hush'
    stacked = hasMain && rows() > 1
    hushBtn.textContent = shownText
    if (stacked) {
      row.append(mainGroup, goBtn, hushBtn, helpBtn)
      row2.append(photoBtn, pictureBtn, voiceBtn, foldBtn)
      row2.hidden = false
      bar.classList.add('hl-tb-stacked')
    }
    return stacked !== was
  }
  function fit(): void {
    if (!alive) return
    bar.style.maxWidth = `${Math.max(120, window.innerWidth - 2 * EDGE)}px`
    // Only when something that decides the shape changed: the screen, or which buttons there are.
    const key = [window.innerWidth, mainGroup.hidden, goBtn.hidden, voiceBtn.hidden, sendWord.hidden, pencilBtn.hidden].join('|')
    if (key !== arrangedFor) {
      arrangedFor = key
      if (arrange()) {
        render() // the hushed button's words depend on the shape
        return
      }
    }
    // One row, hushed, and "Hushed · 4:32" pushed a button off the row: the countdown alone.
    if (!stacked && buttonHushed() && !hushShort && rows() > 1) {
      hushShort = true
      render()
      return
    }
    const r = bar.getBoundingClientRect()
    const width = Math.ceil(r.width)
    const height = Math.ceil(r.height)
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) {
      size = { width, height }
      widget.setSize(width, height)
      keepClear()
    }
  }

  /** Where the user left it, before the keyboard pushed it up; null when it is where they left it. */
  let pushedFrom: { x: number; y: number } | null = null
  /**
   * Keep the toolbar above the chat box: with the keyboard up, the visible part of the page
   * (`visualViewport`) ends at the keyboard, and the chat box sits just above that.
   */
  function keepClear(): void {
    if (!alive || !widget.isVisible()) return
    const vv = window.visualViewport
    const top = vv ? vv.offsetTop : 0
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
    const limit = Math.max(top + 8, bottom - CLEAR_BOTTOM - size.height)
    const at = widget.getPosition()
    if (at.y > limit) {
      if (!pushedFrom) pushedFrom = at
      widget.moveTo(at.x, limit)
    } else if (pushedFrom) {
      // More room (the keyboard went down): back towards where it was left, as far as fits.
      const y = Math.min(pushedFrom.y, limit)
      if (y !== at.y) widget.moveTo(pushedFrom.x, y)
      if (y === pushedFrom.y) pushedFrom = null
    }
  }
  const vv = window.visualViewport
  vv?.addEventListener('resize', keepClear)
  vv?.addEventListener('scroll', keepClear)
  window.addEventListener('resize', keepClear)

  /**
   * Remember where a drag left `el`'s widget. The press starts on `el`; the release may land
   * anywhere (the host can capture the pointer), so it is heard on the window.
   */
  function rememberDrags(el: HTMLElement, onMoved: () => void): () => void {
    let downAt: { x: number; y: number } | null = null
    const down = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY } }
    const up = (ev: PointerEvent) => {
      const from = downAt
      downAt = null
      if (!from || (Math.abs(ev.clientX - from.x) <= TAP_SLOP && Math.abs(ev.clientY - from.y) <= TAP_SLOP)) return
      setTimeout(() => alive && onMoved(), 250) // the host has settled it (and snapped it) by then
    }
    el.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      el.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }
  const forgetToolbarDrags = rememberDrags(root, () => {
    pushedFrom = null // a drag is a new place to remember
    writeStore(STORE.pos, widget.getPosition())
    keepClear()
  })
  let forgetDiscDrags: (() => void) | null = null

  // --- fold to the popcorn disc ------------------------------------------------------
  let disc: ReturnType<SpindleFrontendContext['ui']['createFloatWidget']> | null = null
  function mountDisc(): boolean {
    if (disc) return true
    const at = readStore<{ x: number; y: number }>(STORE.disc)
    try {
      disc = create!.call(ctx.ui, {
        width: DISC_SIZE,
        height: DISC_SIZE,
        initialPosition: at ?? {
          x: Math.max(0, window.innerWidth - DISC_SIZE - EDGE),
          y: Math.max(0, window.innerHeight - DISC_SIZE - CLEAR_BOTTOM),
        },
        snapToEdge: true,
        tooltip: 'Houselights',
        chromeless: true,
      })
    } catch (err) {
      console.warn('[Houselights] the popcorn could not be made; the toolbar stays open', err)
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
      // A press that moved is a drag, not a tap.
      if (from && (Math.abs(ev.clientX - from.x) > TAP_SLOP || Math.abs(ev.clientY - from.y) > TAP_SLOP)) return
      unfold()
    })
    forgetDiscDrags = rememberDrags(face, () => disc && writeStore(STORE.disc, disc.getPosition()))
    face.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      ev.preventDefault()
      unfold()
    })
    return true
  }
  function fold(): void {
    if (!mountDisc()) return
    inputRow.hidden = true
    widget.setVisible(false)
    disc!.setVisible(true)
    writeStore(STORE.folded, true)
  }
  function unfold(): void {
    disc?.setVisible(false)
    widget.setVisible(true)
    writeStore(STORE.folded, false)
    render()
    keepClear()
  }

  // --- wiring -----------------------------------------------------------------------
  const unsubscribe = engine.subscribe((s) => {
    snapshot = s
    render()
  })
  const unsubComposer = composer.onChange(() => render())
  const ticker = setInterval(() => {
    // Once a second while something on it is counting down or about to run out.
    const holding = !!statusSeen && Date.now() - statusSeen.at <= STATUS_HOLD_MS + 1000
    const explaining = !!explained && Date.now() - explained.at <= STATUS_HOLD_MS + 1000
    // D-099: and through the last minutes of the computer's session, for the countdown.
    const stopping = !!snapshot.autoStopAt && !!snapshot.stopWarnAt && Date.now() >= snapshot.stopWarnAt - 1000 && Date.now() <= snapshot.autoStopAt + 2000
    if (hush.hushed || snapshot.awaitingReaction || holding || explaining || stopping) render()
  }, 1000)
  render()
  if (readStore<boolean>(STORE.folded) === true) fold()

  return {
    available: true,
    setHush(next) {
      hush = next
      hushEndsAt = next.hushed ? Date.now() + Math.max(0, next.remainingMs) : 0
      render()
    },
    setTail() {},
    refresh() {
      render()
    },
    popOut() {},
    previewPortrait() {},
    noteActivity() {},
    landed(chatId, text) {
      if (!pendingInput || pendingInput.chatId !== chatId || text !== pendingInput.text.slice(0, 2000)) return
      if (input.value.trim() === pendingInput.text) input.value = ''
      pendingInput = null
    },
    showTips() {
      writeStore(STORE.hintSeen, false)
      render()
    },
    destroy() {
      alive = false
      clearInterval(ticker)
      if (explainTimer !== null) clearTimeout(explainTimer)
      unsubscribe()
      unsubComposer()
      vv?.removeEventListener('resize', keepClear)
      vv?.removeEventListener('scroll', keepClear)
      window.removeEventListener('resize', keepClear)
      forgetToolbarDrags()
      forgetDiscDrags?.()
      widget.destroy()
      disc?.destroy()
      disc = null
      removeStyle()
    },
  }
}

/** The toolbar's own sheet: documented `--lumiverse-*` variables only, like the widget's. */
export const TOOLBAR_STYLES = `
  .hl-tb-host [hidden] { display: none !important; }
  .hl-tb { display: inline-flex; flex-direction: column; gap: 4px; padding: 6px; box-sizing: border-box;
           width: max-content; font: calc(13px * var(--lumiverse-font-scale, 1))/1.35 system-ui, sans-serif;
           color: var(--lumiverse-text, inherit);
           background-color: var(--lumiverse-bg, Canvas);
           background-image: linear-gradient(var(--lumiverse-fill, transparent), var(--lumiverse-fill, transparent));
           border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
           border-radius: calc(var(--lumiverse-radius, 6px) + 4px); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35); }
  .hl-tb-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .hl-tb-btn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
               min-width: 36px; min-height: 36px; padding: 0 8px; font: inherit; cursor: pointer;
               color: var(--lumiverse-text, inherit); background: var(--lumiverse-fill-subtle, transparent);
               border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3)); border-radius: var(--lumiverse-radius, 6px); }
  .hl-tb-btn:disabled { opacity: 0.5; cursor: default; }
  .hl-tb-icon-btn { padding: 0; }
  /* D-096: Look, an eye and a word. Both words share one grid cell, so the button is as wide as
     the longer and never changes size; the one not showing is only invisible. */
  .hl-tb-main { display: flex; gap: 4px; flex: 0 0 auto; }
  .hl-tb-look { gap: 6px; flex: 1 1 auto; font-weight: 600; }
  .hl-tb-look .hl-icon { display: inline-flex; line-height: 0; }
  .hl-tb-label { display: inline-grid; }
  .hl-tb-label > span { grid-area: 1 / 1; white-space: nowrap; text-align: left; }
  .hl-tb-ghost { visibility: hidden; }
  /* A small box where one row won't hold them: Look, Hush and ? on top; the rest share the second row. */
  .hl-tb-stacked .hl-tb-row { flex-wrap: nowrap; }
  .hl-tb-stacked .hl-tb-main { flex: 1 0 auto; }
  .hl-tb-stacked .hl-tb-row2 > * { flex: 1 1 0; }
  /* Hush and its countdown are the same width there, so pressing it moves nothing. */
  .hl-tb-stacked .hl-tb-hush { min-width: 58px; }
  /* Explain mode: every button is askable, and looks it. */
  .hl-tb-explaining .hl-tb-btn { border-style: dashed; }
  /* The one-time hint: a bubble over the Look button, with a tail pointing down at it. */
  .hl-tb-hint { position: relative; width: 0; min-width: 100%; box-sizing: border-box; margin-bottom: 4px; padding: 6px 8px;
                font: inherit; text-align: left; cursor: pointer; color: var(--lumiverse-text, inherit);
                background-color: var(--lumiverse-bg, Canvas);
                background-image: linear-gradient(var(--lumiverse-fill, transparent), var(--lumiverse-fill, transparent));
                border: 1px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor));
                border-radius: var(--lumiverse-radius, 6px); }
  .hl-tb-hint::after { content: ''; position: absolute; left: 18px; bottom: -6px; width: 10px; height: 10px;
                       background-color: var(--lumiverse-bg, Canvas);
                       background-image: linear-gradient(var(--lumiverse-fill, transparent), var(--lumiverse-fill, transparent));
                       transform: rotate(45deg);
                       border-right: 1px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor));
                       border-bottom: 1px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-tb-icon-btn .hl-icon { display: inline-flex; line-height: 0; }
  .hl-tb-icon-btn .hl-icon svg { display: block; }
  .hl-tb-on { border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-tb-status { width: 0; min-width: 100%; font-size: 0.92em; padding: 0 2px; overflow: hidden;
                  white-space: nowrap; text-overflow: ellipsis; color: var(--lumiverse-text-muted, var(--lumiverse-text, inherit)); }
  .hl-tb-status-err { color: var(--lumiverse-danger, rgb(220,70,70)); }
  /* A failure and an explanation are read whole: they wrap. After the rule above, and one class
     more specific, so it wins (in 0.1.12 and 0.1.13 it sat before it and never applied). */
  .hl-tb-status.hl-tb-status-wrap { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
  /* D-099: "Stops in 1:42 · Extend", with Extend a button of its own. */
  .hl-tb-warn { width: 0; min-width: 100%; font-size: 0.92em; padding: 0 2px; white-space: nowrap;
                color: var(--lumiverse-warning, var(--lumiverse-text, inherit)); }
  .hl-tb-warn-btn { font: inherit; cursor: pointer; min-height: 28px; padding: 0 10px; color: var(--lumiverse-text, inherit);
                    background: var(--lumiverse-fill-subtle, transparent);
                    border: 1px solid var(--lumiverse-warning, var(--lumiverse-border, rgba(128,128,128,0.3)));
                    border-radius: var(--lumiverse-radius, 6px); }
  .hl-tb-input-row { display: flex; width: 0; min-width: 100%; }
  /* 16 px: anything smaller makes iOS zoom the page when the input takes focus. */
  .hl-tb-input { flex: 1; min-width: 0; min-height: 36px; box-sizing: border-box; padding: 4px 8px; font: inherit; font-size: 16px;
                 color: var(--lumiverse-text, inherit); background: var(--lumiverse-fill-subtle, transparent);
                 border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3)); border-radius: var(--lumiverse-radius, 6px); }
  .hl-disc { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
             box-sizing: border-box; border-radius: 50%; cursor: pointer; touch-action: none; user-select: none;
             -webkit-user-select: none; background: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2));
             color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); }
  .hl-disc svg { width: 58%; height: 58%; display: block; }
  .hl-disc:active { filter: brightness(1.1); }
`
