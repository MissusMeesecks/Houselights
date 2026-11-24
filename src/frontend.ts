/**
 * Frontend entry: the settings panel, the hush button, and the capture tab
 * in the sidebar drawer.
 *
 * Runs in the browser, in the host page. The settings panel holds the knobs
 * that shape the reaction (which model, how often, what it's told); the
 * capture tab (capture-tab.ts) holds the eyes.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { CaptureReceipt, CaptureSettings, ChatState, CompanionFrame, ConnectionInfo, LookupStatus, ReactionProgress, ReactionResult, RemoteLookRequest, RemoteLookResult, TailPayload, WatchingState } from './capture.ts'
import { speakerOf } from './capture.ts'
import { clampPct, createCaptureTab, foldSummary } from './capture-tab.ts'
import { BEAT_STYLES, createBeatDecorator } from './beat-decorator.ts'
import { createPane, HUSH_TITLE, HUSHED_TITLE, type Pane } from './pane.ts'
import { createToolbar, type Toolbar } from './toolbar.ts'
import { composerFrom, createComposerBridge } from './composer.ts'
import { SHARED_STYLES, button, captionHelp, confirmDanger, createUiKit, el, helpTip, note, settingsSearch, statusClass, type HelpContent } from './ui.ts'
import { LIGHT_MODEL_ADVICE } from './reasoning.ts'
import type { IconName } from './icons.ts'
import { STT_PHONE_CHOICES, STT_PROVIDER_CHOICES, createVoice, isSecurePage, sttReasonText, type SttPhoneChoice, type SttProviderChoice, type VoiceSettings } from './voice.ts'

interface HouselightsConfig extends CaptureSettings {
  connectionId: string | null
  maxTokens: number
  showPane: boolean
  showPaneMobile?: boolean
  companionPhone?: boolean
  portraitSizePct?: number
  portraitOpacityPct?: number
  paneTextPct?: number
  paneHidePicture?: boolean
  paneLinesOnly?: boolean
  pinnedChatId: string | null
  temperature: number
  topP: number
  systemPrompt: string
  roastInstruction: string
  coachInstruction?: string
  characterInstruction?: string
  selfRecognition?: string
  talkInstruction: string
  boxFraming?: string
  boxFocus?: string
  boxLines?: number
  boxRebuttal?: boolean
  boxCouncil?: boolean
  coachSearch?: boolean
  popoutOnStart?: boolean
  mediaKeyLook?: boolean
  modelsOpen?: boolean
  folds?: Record<string, boolean>
  customPresets?: { name: string; text: string }[]
  boxSpeakers?: Record<string, string>
  voiceOut?: boolean
  sttProvider?: SttProviderChoice
  /** D-057: the mic recogniser on a phone. Absent = automatic. */
  sttProviderPhone?: SttPhoneChoice
  voiceAutoSend?: boolean
  voiceAutoSendDelaySeconds?: number
  boxVoices?: Record<string, string>
  visionMode: 'attach' | 'describe'
  visionConnectionId: string | null
  visionPrompt: string
  attachFullFrame: boolean
  allowReasoning: boolean
  generationTimeoutSeconds: number
  cooldownSeconds: number
  salienceBar: number
  skipKinds: string[]
  roastMemory: number
  hushMinutes: number
  conversationGraceSeconds: number
  overrideInterest: number
  kindBreakInterest?: number
  hushEndComment?: boolean
  curtainCall?: boolean
}

interface HushState {
  hushed: boolean
  source: 'button' | 'conversation' | null
  remainingMs: number
  busy: boolean
}

/** A muzzled speech bubble. Reads at 16px, which is all the input bar gives us. */
const HUSH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8
  8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8
  8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  <line x1="2" y1="2" x2="22" y2="22"/></svg>`

const SCENE_KINDS = [
  'menu',
  'loading',
  'cutscene',
  'combat',
  'exploration',
  'dialogue',
  'outcome',
  'other',
] as const
/** D-101: a kind whose one word does not say what it is gets a few more. */
const KIND_LABELS: Partial<Record<(typeof SCENE_KINDS)[number], string>> = {
  outcome: 'Outcome (death, game over, victory)',
}

interface StatePayload {
  type: 'state'
  hush?: HushState
  /** D-099: the computer's session, for a phone that follows it. */
  companionSession?: { live: boolean; stopsInMs?: number; windowMs?: number }
  config: HouselightsConfig
  defaults: { systemPrompt: string; roastInstruction: string; coachInstruction?: string; characterInstruction?: string; selfRecognition?: string; talkInstruction?: string; boxFraming?: string; boxFocus?: string; visionPrompt: string }
  sampleScene: string
  connections: ConnectionInfo[]
  /** The watched chat (active, or pinned). */
  activeChat: { id: string; name: string; characterId?: string | null; characterName?: string | null } | null
  chatEnabled: boolean
  chatMode?: 'follow' | 'pinned'
  activeChatId?: string | null
  newReactions?: number
  /** D-057: the full chat state (box and council included). */
  chatState?: ChatState
  chats?: ChatOption[]
  watching?: WatchingState
}

interface ChatOption {
  id: string
  name: string
  characterId: string | null
  characterName: string | null
  updatedAt: number
}

function chatLabel(c: { name: string; characterName?: string | null }): string {
  return c.characterName ? `${c.characterName} · ${c.name}` : c.name
}


/** D-089 (D5): the full settings' card icons. None repeats here or in the tab. */
const SETTINGS_ICONS: Record<string, IconName> = {
  models: 'bot',
  seeing: 'scan-eye',
  capture: 'monitor',
  pacing: 'gauge',
  voice: 'mic',
  box: 'armchair',
  watchingIn: 'pin',
  webSearch: 'globe',
  device: 'smartphone',
  prompts: 'file-text',
  troubleshooting: 'wrench',
}

/** D-088: help text with its {{tokens}} in bold, as on the Custom instruction (D8). */
function boldTokens(text: string): HTMLElement {
  const p = el('p')
  for (const part of text.split(/(\{\{[^}]+\}\})/)) {
    if (!part) continue
    p.append(/^\{\{/.test(part) ? el('strong', { textContent: part }) : document.createTextNode(part))
  }
  return p
}

export function setup(ctx: SpindleFrontendContext) {
  const removeStyle = ctx.dom.addStyle(SHARED_STYLES + BEAT_STYLES)
  const ui = createUiKit(ctx).scope()
  const root = ctx.ui.mount('settings_extensions')

  let config: HouselightsConfig | null = null
  let defaults: StatePayload['defaults'] | null = null
  let connections: ConnectionInfo[] = []
  let activeChat: StatePayload['activeChat'] = null
  let chatMode: 'follow' | 'pinned' = 'follow'
  let chats: ChatOption[] = []
  let sampleScene = ''
  let scene = ''
  let status: { text: string; kind: 'info' | 'ok' | 'err' } | null = null
  let busy = false

  const panel = document.createElement('div')
  panel.className = 'hl-panel'
  root.appendChild(panel)
  // D-086, D1: the search. Built once and never taken out of the page, so a redraw
  // while typing keeps the box, its text and its focus; it filters after every redraw.
  const search = settingsSearch(panel)

  /** Connection picker: '' means "none chosen" (the empty option's value). */
  function connectionRow(
    label: string,
    value: string | null,
    emptyLabel: string,
    onChange: (v: string | null) => void,
    hint?: HelpContent,
  ): HTMLElement {
    const options = [
      { value: '', label: emptyLabel },
      ...connections.map((c) => ({
        value: c.id,
        label: `${c.name} — ${c.model}${c.isDefault ? ' (default)' : ''}`,
      })),
    ]
    return ui.selectRow(label, value ?? '', options, (v) => onChange(v || null), hint)
  }

  // --- persistence ----------------------------------------------------------

  // D-060: each save carries an id, so this window can tell its own change from another's
  // when the backend tells every open window about it.
  const mySaves = new Set<string>()
  let saveSeq = 0
  function patch(changes: Partial<HouselightsConfig>) {
    if (!config) return
    config = { ...config, ...changes }
    const saveId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${saveSeq++}`
    mySaves.add(saveId)
    if (mySaves.size > 50) mySaves.delete(mySaves.values().next().value as string)
    ctx.sendToBackend({ type: 'save_config', config: changes, saveId })
  }

  // --- the hush button ------------------------------------------------------

  let hush: HushState = { hushed: false, source: null, remainingMs: 0, busy: false }
  let hushTicker: ReturnType<typeof setInterval> | null = null

  const hushAction = ctx.ui.registerInputBarAction({
    id: 'houselights-hush',
    label: 'Hush',
    subtitle: HUSH_TITLE,
    iconSvg: HUSH_ICON,
  })

  /** H1: the button shows only the hush you pressed; the quiet after you speak is not its state. */
  const buttonHushed = (): boolean => hush.hushed && hush.source === 'button'

  function hushLabel(): { label: string; subtitle: string } {
    const seconds = Math.max(0, Math.ceil(hush.remainingMs / 1000))
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    if (buttonHushed()) return { label: `Hushed · ${clock}`, subtitle: HUSHED_TITLE }
    if (hush.hushed) return { label: 'Hush', subtitle: `Quiet for ${clock} after you spoke.` }
    return { label: 'Hush', subtitle: HUSH_TITLE }
  }

  function refreshHushButton(): void {
    const { label, subtitle } = hushLabel()
    hushAction.setLabel(label)
    hushAction.setSubtitle(subtitle)

    if (hush.hushed && hushTicker === null) {
      hushTicker = setInterval(() => {
        hush = { ...hush, remainingMs: hush.remainingMs - 1000 }
        if (hush.remainingMs <= 0) hush = { ...hush, hushed: false, source: null, remainingMs: 0 }
        refreshHushButton()
        if (!hush.hushed) pane?.setHush(hush)
        if (!hush.hushed) captureTab.onHush()
        if (!hush.hushed) render()
      }, 1000)
    } else if (!hush.hushed && hushTicker !== null) {
      clearInterval(hushTicker)
      hushTicker = null
    }
  }

  const unsubHushClick = hushAction.onClick(() => {
    ctx.sendToBackend({ type: 'set_hush', hushed: !buttonHushed() })
  })

  // --- the capture tab --------------------------------------------------------

  /** The speaker switch, from wherever it's flipped (settings page, the tab). The widget has its own path. */
  function setVoiceOut(on: boolean): void {
    patch({ voiceOut: on })
    if (!on) voice.stop()
    captureTab.refreshVoice() // the Box Seat's voice rows show only while voice is on
    pane?.refresh()
    render()
  }

  // Voice (D16): the engine behind the Pane's speaker and mic, and the tab's Voice section.
  function voiceSettings(): VoiceSettings {
    return {
      voiceOut: config?.voiceOut === true,
      sttProvider: config?.sttProvider ?? 'default',
      sttProviderPhone: config?.sttProviderPhone ?? 'auto',
      voiceAutoSend: config?.voiceAutoSend === true,
      voiceAutoSendDelaySeconds: config?.voiceAutoSendDelaySeconds ?? 3,
      cooldownSeconds: config?.cooldownSeconds ?? 0,
      boxVoices: config?.boxVoices ?? {},
    }
  }
  // `captureTab` is created just below; the mic only asks once someone presses it.
  const voice = createVoice({ ctx, settings: voiceSettings, phone: () => captureTab.isPhone() })
  let lastChat: ChatState | null = null
  // D19: Lumiverse's own chat box (composer-v1), shared by the phone toolbar and the input bar's Look.
  const composer = createComposerBridge(composerFrom(ctx))
  /** D19: the host can open a chat for us (a route surface, no permission needed). */
  function chatOpener(): ((chatId: string) => void) | null {
    const surfaces = ctx.host?.surfaces
    try {
      if (!surfaces || !surfaces.list(['route']).some((r) => r.id === '/chat/:chatId')) return null
    } catch {
      return null
    }
    return (chatId) => {
      try {
        void Promise.resolve(surfaces.invoke({ kind: 'route', id: '/chat/:chatId' }, { chatId })).catch((err) =>
          console.warn('[Houselights] could not open the chat', err),
        )
      } catch (err) {
        console.warn('[Houselights] could not open the chat', err)
      }
    }
  }
  const openChat = chatOpener()

  const captureTab = createCaptureTab({
    ctx,
    voice,
    composer,
    openChat,
    showTips: () => toolbar?.showTips(),
    boxVoice: {
      get: (viewerId) => config?.boxVoices?.[viewerId] ?? '',
      set: (viewerId, connectionId) => {
        const next = { ...(config?.boxVoices ?? {}) }
        if (connectionId) next[viewerId] = connectionId
        else delete next[viewerId]
        patch({ boxVoices: next })
      },
    },
    popOut: () => pane?.popOut(),
    previewPortrait: (preview) => pane?.previewPortrait(preview),
    // Part 2: the tab's own Hush button and speaker switch.
    hush: { state: () => hush, set: (on) => ctx.sendToBackend({ type: 'set_hush', hushed: on }) },
    setVoiceOut: (on) => setVoiceOut(on),
    getSettings: () => config,
    patch: (changes) => {
      patch(changes)
      // A model picked in the Houselights tab must show in this panel too.
      if ('connectionId' in changes || 'visionConnectionId' in changes) render()
      if ('coachSearch' in changes) captureTab.refreshVoice() // redraws the chat section, where the toggle lives
      if ('showPane' in changes || 'showPaneMobile' in changes) syncPane() // the Show the widget box lives in the tab now
      if ('companionPhone' in changes) pane?.refresh()
      if (['portraitSizePct', 'portraitOpacityPct', 'paneTextPct', 'paneHidePicture', 'paneLinesOnly'].some((k) => k in changes)) pane?.refresh()
    },
    getConnections: () => connections,
    getConnectionName: (id) => {
      const c = id ? connections.find((x) => x.id === id) : connections.find((x) => x.isDefault)
      return c ? `${c.name} — ${c.model}` : id ? 'an unknown connection' : 'your default connection'
    },
  })

  // --- the Pane (release two) ---------------------------------------------------
  // One float widget over the page, fed by the capture tab's engine. Created
  // when settings say so; destroyed when they stop saying so.
  let pane: Pane | null = null
  let toolbar: Toolbar | null = null
  function syncPane(): void {
    // D-055: a phone has its own switch, off by default.
    const wanted = captureTab.isPhone() ? config?.showPaneMobile !== false : config?.showPane !== false
    if (wanted && !pane && captureTab.isPhone()) {
      // D19: on a phone or tablet the widget is a toolbar over the real chat.
      toolbar = createToolbar({
        ctx,
        engine: {
          subscribe: (l) => captureTab.subscribe(l),
          snapshot: () => captureTab.snapshot(),
          takePhoto: () => captureTab.takePhoto(),
          choosePicture: () => captureTab.choosePicture(),
          companion: () => captureTab.isCompanion(),
          remoteLook: (talk) => captureTab.remoteLook(talk),
          extend: () => captureTab.extend(),
        },
        voice: {
          canSpeak: () => {
            const a = voice.availability()
            return a.tts && a.media === true
          },
          voiceOut: () => config?.voiceOut === true,
          setVoiceOut: (on) => setVoiceOut(on),
        },
        composer,
        onHush: (hushed) => ctx.sendToBackend({ type: 'set_hush', hushed }),
        openChat,
      })
      pane = toolbar
      pane.setHush(hush)
    } else if (wanted && !pane) {
      pane = createPane({
        ctx,
        engine: {
          subscribe: (l) => captureTab.subscribe(l),
          snapshot: () => captureTab.snapshot(),
          // As the tab's own Look button: starts a session if there is none, and pops out on start when that is ticked.
          look: () => captureTab.pressLook(),
          // D-055, phone mode: the camera app and a picture, from the widget. Inside the click.
          takePhoto: () => captureTab.takePhoto(),
          choosePicture: () => captureTab.choosePicture(),
          // D-063: a phone following the computer asks it to look.
          companion: () => captureTab.isCompanion(),
          remoteLook: () => captureTab.remoteLook(),
          stop: () => captureTab.stop(),
          extend: () => captureTab.extend(),
          talk: (text, withLook) => captureTab.talk(text, withLook),
          confirmWatching: (text) => captureTab.confirmWatching(text),
          dismissWatching: () => captureTab.dismissWatching(),
          setStance: (stance) => captureTab.setStance(stance),
        },
        voice: {
          canSpeak: () => {
            const a = voice.availability()
            return a.tts && a.media === true
          },
          voiceOut: () => config?.voiceOut === true,
          setVoiceOut: (on) => {
            patch({ voiceOut: on })
            render()
            captureTab.refreshVoice() // the Box Seat's voice rows show only while voice is on
          },
          canListen: () => voice.canListen(),
          listening: () => voice.listening(),
          listen: (callbacks) => voice.listen(callbacks),
          cancelListening: () => voice.cancelListening(),
          stop: () => voice.stop(),
          autoSend: () => ({ enabled: config?.voiceAutoSend === true, delaySeconds: config?.voiceAutoSendDelaySeconds ?? 3 }),
        },
        phone: captureTab.isPhone(),
        composer,
        openChat,
        onHush: (hushed) => ctx.sendToBackend({ type: 'set_hush', hushed }),
        portrait: () => ({
          sizePct: clampPct(config?.portraitSizePct, 25, 10, 90),
          opacityPct: clampPct(config?.portraitOpacityPct, 100, 10, 100),
        }),
        // D-059: text size and the corner toggles, saved like the portrait.
        view: () => ({
          textPct: clampPct(config?.paneTextPct, 100, 70, 200),
          hidePicture: config?.paneHidePicture === true,
          linesOnly: config?.paneLinesOnly === true,
        }),
        setView: (changes) => {
          patch({
            ...(changes.hidePicture !== undefined ? { paneHidePicture: changes.hidePicture } : {}),
            ...(changes.linesOnly !== undefined ? { paneLinesOnly: changes.linesOnly } : {}),
          })
          captureTab.onSettings() // the tab's tickboxes for the same two switches
        },
        // Absolute: the pop-out window's document has no base URL to resolve against.
        avatarUrl: (characterId) => new URL(`/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=sm`, location.origin).href,
      })
      pane.setHush(hush)
      pane.noteActivity()
    } else if (!wanted && pane) {
      pane.destroy()
      pane = null
      toolbar = null
    }
  }

  // --- what the character saw, under each beat -------------------------------

  const beatDecorator = createBeatDecorator(ctx)

  // --- render ---------------------------------------------------------------

  /** The nearest ancestor that scrolls (the host's settings pane), so a redraw can keep its place. */
  function scrollHost(): HTMLElement | null {
    for (let n = panel.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY
      if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n
    }
    return (document.scrollingElement as HTMLElement | null) ?? null
  }

  /** Redraw the settings page without jumping: emptying it collapses the pane for a moment. */
  function render() {
    const host = scrollHost()
    const top = host?.scrollTop ?? 0
    const minHeight = panel.style.minHeight
    panel.style.minHeight = `${panel.offsetHeight}px` // hold the height while it's rebuilt
    try {
      renderPanel()
    } finally {
      panel.style.minHeight = minHeight
      if (host) host.scrollTop = top
    }
  }

  /** Where a reset stands: asking, or what happened. */
  let resetNote: { text: string; kind: 'info' | 'ok' | 'err' } | null = null

  function renderPanel() {
    ui.reset()
    for (const child of Array.from(panel.children)) if (child !== search.root) child.remove()

    // Prepended, so the search (if it is in the page) stays where it is and keeps its focus.
    // D-088: the opening paragraph moved to the guide (SET-002); the heading stays (SET-001).
    panel.prepend(el('h3', { textContent: 'Houselights' }))

    if (!config || !defaults) {
      search.root.remove()
      panel.appendChild(el('div', { className: 'hl-status', textContent: 'Loading…' }))
      return
    }
    if (search.root.parentNode !== panel) panel.appendChild(search.root) // under the introduction, above the cards

    // Vision — how the picture becomes words (or doesn't).
    const visionGroup = el('div', { className: 'hl-group' })
    visionGroup.appendChild(
      ui.selectRow(
        'How the character sees',
        config.visionMode,
        [
          { value: 'describe', label: 'Describe' },
          { value: 'attach', label: 'Attach' },
        ],
        (v) => {
          patch({ visionMode: v })
          render()
        },
        [
          'Describe: the vision model turns the picture into a sentence or two, and only that text reaches the character.',
          'Attach: the picture itself goes to the reaction model, which must accept images.',
          'Pacing\'s interest settings work only in Describe.',
        ],
      ),
    )
    const visionModelRow =
      config.visionMode === 'describe'
        ? connectionRow('Vision model', config.visionConnectionId, 'Same as the reaction model', (v) => {
            patch({ visionConnectionId: v })
            captureTab.onSettings()
          })
        : null
    visionGroup.appendChild(
      ui.checkboxRow(
        'Keep the full-size picture on the hidden note',
        config.attachFullFrame,
        (v) => patch({ attachFullFrame: v }),
        'Every reaction leaves a hidden note in the chat, with a thumbnail under it. When on, the full-size picture is ' +
          'kept too, and a press on the thumbnail shows it. Later prompts carry the note\'s description, never the picture.',
      ),
    )

    // Pacing — the difference between delightful and unbearable.
    const paceGroup = el('div', { className: 'hl-group' })
    const attach = config.visionMode === 'attach'
    // D-088: in Attach the interest settings are greyed and tagged; the tag's caption look comes with the look PR.
    const describeOnly = attach ? ' (Describe only)' : ''
    if (attach) {
      // A plain status line, not red: nothing failed (and "Interrupt anyway" was never a setting's name).
      paceGroup.appendChild(
        el('div', { className: 'hl-status', textContent: 'How the character sees is set to Attach, so the interest settings on this card are off. The timers still work.' }),
      )
    }
    const paceHelp: HelpContent =
      'How choosy Houselights is about speaking up by itself in Continuous. A Look you press always gets a reaction. ' +
      'The interest settings need Describe; the timers work in both.'
    paceGroup.appendChild(
      ui.numberRow('Minimum gap between reactions (seconds)', config.cooldownSeconds, { min: 0, max: 600, step: 5 }, (v) =>
        patch({ cooldownSeconds: v }),
      ),
    )
    paceGroup.appendChild(
      ui.numberRow(`How interesting a moment must be (0–10)${describeOnly}`, config.salienceBar, { min: 0, max: 10, step: 1, disabled: attach }, (v) =>
        patch({ salienceBar: v }),
        'The vision model rates each moment from 0 to 10. At 0 everything gets a reaction; at 7 and above only deaths, ' +
          'boss fights and disasters do. Start around 4.',
      ),
    )
    paceGroup.appendChild(el('span', { className: 'hl-subhead hl-subhead-gap', textContent: `Never comment on${describeOnly}` }))
    const kindWrap = el('div', { className: 'hl-kinds' })
    for (const kind of SCENE_KINDS) {
      kindWrap.appendChild(
        ui.checkboxRow(KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1), config.skipKinds.includes(kind), (on) => {
          const next = on ? [...config!.skipKinds, kind] : config!.skipKinds.filter((k) => k !== kind)
          patch({ skipKinds: next })
          render()
        }, undefined, attach),
      )
    }
    paceGroup.appendChild(kindWrap)
    // D-101: interest beats kind.
    paceGroup.appendChild(
      ui.numberRow(`Big moments get through skipped kinds (interest at or above, 0–10, or 11 = never)${describeOnly}`, config.kindBreakInterest ?? 8, { min: 0, max: 11, step: 1, disabled: attach }, (v) =>
        patch({ kindBreakInterest: v }),
        "A death or victory screen can look like a menu. At or above this, it's commented on anyway. " +
          'It still has to clear How interesting a moment must be. At 11 a skipped kind is always skipped.',
      ),
    )

    paceGroup.appendChild(
      ui.numberRow('Recent reactions to remember', config.roastMemory, { min: 0, max: 20, step: 1 }, (v) =>
        patch({ roastMemory: v }),
        'The model is shown this many of its recent reactions and told not to repeat their shape. ' +
          'Raise it if the same joke keeps coming back.',
      ),
    )
    paceGroup.appendChild(el('span', { className: 'hl-subhead hl-subhead-gap', textContent: 'Getting a word in' }))
    paceGroup.appendChild(
      ui.numberRow('Hush lasts (minutes)', config.hushMinutes, { min: 1, max: 120, step: 1 }, (v) =>
        patch({ hushMinutes: v }),
      ),
    )
    paceGroup.appendChild(
      ui.numberRow('Stay quiet after you speak (seconds)', config.conversationGraceSeconds, { min: 0, max: 600, step: 5 }, (v) =>
        patch({ conversationGraceSeconds: v }),
        'After you send a message, Houselights holds its automatic reactions for this long, so you can answer back ' +
          'without being talked over. The time starts again when the reply finishes. 0 turns it off.',
      ),
    )
    paceGroup.appendChild(
      ui.numberRow(`Something big enough breaks through a hush (0–10, or 11 = never)${describeOnly}`, config.overrideInterest, { min: 0, max: 11, step: 1, disabled: attach }, (v) =>
        patch({ overrideInterest: v }),
        'At 11, the default, nothing breaks through a hush. Lower it and a moment rated this high gets a reaction anyway, ' +
          'though never sooner than the minimum gap or over a reply being written. More in the guide.',
      ),
    )
    paceGroup.appendChild(
      ui.checkboxRow(
        `Comment when a hush ends${describeOnly}`,
        config.hushEndComment !== false,
        (v) => patch({ hushEndComment: v }),
        'On by default. When a hush you pressed ends, the character says one thing about the most interesting moment it saw ' +
          'meanwhile. It needs a Continuous session in Describe, and does not happen after the quiet that follows your own message.',
        attach,
      ),
    )
    // D-100: the curtain call. Both modes: in Attach it looks back on what was said, not on what was seen.
    paceGroup.appendChild(
      ui.checkboxRow(
        'Curtain call when a session ends',
        config.curtainCall !== false,
        (v) => patch({ curtainCall: v }),
        'One closing line about the session when it stops. On by default. Not after a session under two minutes or one ' +
          'with nothing worth mentioning, and not while hushed.',
      ),
    )

    // Test harness — a typed scene, no screen needed.
    const testGroup = el('div', { className: 'hl-group' })
    // D-088: the group's caption and its [?] (TRB-002, TRB-008).
    testGroup.appendChild(
      captionHelp(
        el('span', { className: 'hl-subhead', textContent: 'Test with a typed scene' }),
        'Test with a typed scene',
        'Type what a vision model might say about a screen. The character reacts to that text, and nothing is captured.',
      ),
    )
    testGroup.appendChild(
      el('p', {
        className: 'hl-sub',
        textContent: activeChat
          ? chatMode === 'pinned'
            ? `The reaction goes into the pinned chat, "${chatLabel(activeChat)}", even if React in this chat is off.`
            : `The reaction goes into your open chat, "${chatLabel(activeChat)}", even if React in this chat is off.`
          : 'No chat is open. Open a chat with a character first.',
      }),
    )

    const sceneBox = el('textarea', { value: scene, rows: 4 })
    sceneBox.className = 'hl-input hl-scene' // D-086: Lumiverse's input look, in the pane's font
    sceneBox.placeholder = 'e.g. A menu with three save files'
    sceneBox.id = 'hl-scene-box'
    sceneBox.addEventListener('input', () => {
      scene = sceneBox.value
    })
    const sceneLabel = el('label', { className: 'hl-sub', textContent: 'Scene' })
    sceneLabel.htmlFor = sceneBox.id
    testGroup.append(sceneLabel, sceneBox)

    const fire = button(busy ? 'Reacting…' : 'Send a test reaction', () => {
      busy = true
      status = { text: 'Asking your character…', kind: 'info' }
      render()
      ctx.sendToBackend({ type: 'test_roast', scene })
    }, true)
    fire.disabled = busy || !activeChat

    const resetScene = button('Restore the sample scene', () => {
      scene = sampleScene
      render()
    })

    testGroup.append(el('div', { className: 'hl-btns' }, [fire, resetScene]))
    if (status) {
      testGroup.appendChild(el('div', { className: statusClass(status.kind), textContent: status.text }))
    }

    // Model + generation settings.
    const genGroup = el('div', { className: 'hl-group' })
    genGroup.appendChild(
      connectionRow('Reaction model', config.connectionId, 'Your default connection', (v) => {
        patch({ connectionId: v })
        captureTab.onSettings()
      }, [
        // D-088: "whichever chat is active" was wrong with a pinned chat; Lumiverse assembles the chat reactions go to.
        'The model that writes the reaction. Lumiverse adds the chat\'s history, persona, world info and memories itself.',
        LIGHT_MODEL_ADVICE,
      ]),
    )
    if (visionModelRow) genGroup.appendChild(visionModelRow)
    genGroup.appendChild(
      ui.numberRow('Temperature', config.temperature, { min: 0, max: 2, step: 0.05 }, (v) => patch({ temperature: v })),
    )
    genGroup.appendChild(ui.numberRow('Top P', config.topP, { min: 0, max: 1, step: 0.05 }, (v) => patch({ topP: v })))
    genGroup.appendChild(
      ui.numberRow('Max tokens', config.maxTokens, { min: 32, max: 2048, step: 16 }, (v) => patch({ maxTokens: v })),
    )
    genGroup.appendChild(
      ui.checkboxRow(
        'Let the models think',
        config.allowReasoning,
        (v) => patch({ allowReasoning: v }),
        'Off by default: Houselights asks the model not to reason before it answers. When on, raise Max tokens well ' +
          'above its usual value and expect each reaction to take seconds longer. More in the guide.',
      ),
    )
    genGroup.appendChild(
      ui.numberRow('Give up after (seconds)', config.generationTimeoutSeconds, { min: 10, max: 600, step: 10 }, (v) =>
        patch({ generationTimeoutSeconds: v }),
        'How long each model call may take before Houselights stops waiting and says so.',
      ),
    )


    // Voice (D16): opt-in, off by default; the controls live on the Pane.
    const voiceGroup = el('div', { className: 'hl-group' })
    const va = voice.availability()
    // D-085: what voice is goes behind the card's `[?]`; why it cannot be turned on stays in view.
    if (!va.tts && !va.stt) {
      voiceGroup.appendChild(
        note('This Lumiverse cannot speak or listen yet, so there is nothing to turn on. Updating Lumiverse may add it.'),
      )
    } else if (va.media === false) {
      voiceGroup.appendChild(
        note('Lumiverse has not granted Houselights the media permission, so the speaker and the mic stay hidden. ' +
          'Press Allow voice on this card.'),
      )
    }
    const voiceHelp: HelpContent | undefined =
      (!va.tts && !va.stt) || va.media === false
        ? undefined
        : 'Off until you turn it on. Speak reactions aloud is on the During the show card and on the widget; the widget\'s ' +
              'mic takes one thing you say per press. Each character speaks in the voice on its Voice tab in Lumiverse\'s character editor, or your default TTS voice. ' +
              'More in the guide.'
    // D-087 (D3a): "Speak reactions aloud" lives once, under During the show in the Houselights tab.
    // D-057: a phone keeps its own recogniser, so choosing one there leaves the computer's alone.
    // Either way the mic is the device's own: the host opens the microphone of the browser it runs in.
    const onPhone = captureTab.isPhone()
    voiceGroup.appendChild(
      ui.selectRow(
        'Mic recogniser on your computer',
        config.sttProvider ?? 'default',
        STT_PROVIDER_CHOICES.map((c) => ({ value: c.id, label: c.label })),
        (v) => patch({ sttProvider: v as SttProviderChoice }),
        'What turns your speech into text. Whistle runs on your own machine. Browser speech recognition and an STT connection ' +
          'send the audio elsewhere.',
      ),
    )
    voiceGroup.appendChild(
      ui.selectRow(
        'Mic recogniser on mobile',
        config.sttProviderPhone ?? 'auto',
        STT_PHONE_CHOICES.map((c) => ({ value: c.id, label: c.label })),
        (v) => patch({ sttProviderPhone: v as SttPhoneChoice }),
        [
          'The mic is always the phone\'s or tablet\'s own. Automatic uses the first of these that works there:',
          '1. Lumiverse\'s Voice & Speech setting. 2. Browser speech recognition. 3. Your STT connection. 4. Whistle.',
        ],
      ),
    )
    // What actually works on this device, as the host reports it — so nobody has to try each one to find out.
    if (va.stt) {
      const label: Record<string, string> = { webspeech: 'Browser speech recognition', whistle: 'Whistle', connection: 'Your STT connection' }
      const rows = va.providers.map((p) => `${label[p.id] ?? p.name}: ${p.available ? 'works here' : sttReasonText(p.unavailableReason)}`)
      const secure = isSecurePage()
      voiceGroup.appendChild(
        note(
          `On this ${onPhone ? 'phone or tablet' : 'computer'}: ${rows.join('; ')}.` +
            (secure
              ? ''
              : ' This page is open over plain http, so the browser gives it no microphone. Open Lumiverse at an https address ' +
                '(Lumiverse\'s Tailscale guide sets one up) and the mic can work here.'),
        ),
      )
    }
    voiceGroup.appendChild(
      ui.checkboxRow(
        'Send what the mic heard by itself',
        config.voiceAutoSend === true,
        (v) => patch({ voiceAutoSend: v }),
        'When on, what the mic heard appears in the Talk back box and is sent after a short wait. Press Escape or edit it to hold ' +
          'it back. When off, it waits for Enter.',
      ),
    )
    voiceGroup.appendChild(
      ui.numberRow('Wait before sending (seconds)', config.voiceAutoSendDelaySeconds ?? 3, { min: 0, max: 15, step: 1 }, (v) =>
        patch({ voiceAutoSendDelaySeconds: v }),
      ),
    )

    // The Box Seat (D13′): a group chat as the watched chat.
    const boxGroup = el('div', { className: 'hl-group' })
    const boxHelp =
        'In a group chat, the members watch together as a Box Seat. Each Look goes viewer by viewer, one model call each, and ' +
          'every line is its own message. Each viewer\'s stance is set on the Who reacts card in the Houselights tab. More in the guide.'
    boxGroup.appendChild(
      ui.numberRow('Lines per Look', config.boxLines ?? 2, { min: 1, max: 4, step: 1 }, (v) => patch({ boxLines: v }), 'At most this many viewers speak on each Look.'),
    )
    boxGroup.appendChild(
      ui.checkboxRow(
        'Let a second viewer answer the first',
        config.boxRebuttal !== false,
        (v) => patch({ boxRebuttal: v }),
        'When on, the next viewer answers the first one\'s line. When off, each Look gets exactly one line, from the viewer whose turn it is.',
      ),
    )
    boxGroup.appendChild(
      ui.checkboxRow(
        'Seat your council members too',
        config.boxCouncil === true,
        (v) => patch({ boxCouncil: v }),
        'When on, your Lumiverse council members can watch too. A group chat seats them all to begin with; a solo chat seats only ' +
          'the ones you turn on, on the Who reacts card, and then runs as a Box Seat.',
      ),
    )

    // Watching in (addendum §2): follow the active chat, or pin one (D5).
    const watchGroup = el('div', { className: 'hl-group' })
    const pinned = config.pinnedChatId ?? ''
    const options: { value: string; label: string }[] = [{ value: '', label: 'Whichever chat is open' }]
    for (const c of chats) options.push({ value: c.id, label: chatLabel(c) })
    if (pinned && !chats.some((c) => c.id === pinned)) options.push({ value: pinned, label: activeChat && activeChat.id === pinned ? chatLabel(activeChat) : 'Pinned chat' })
    watchGroup.appendChild(
      ui.selectRow('Reactions go to', pinned, options, (v) => {
        ctx.sendToBackend({ type: 'pin_chat', chatId: v || null })
      },
        'Reactions go to whichever chat is open, if React in this chat is on there. Choose a chat to pin it: reactions then ' +
          'always land in it, and the Houselights tab counts the ones you have not seen. Pinning a chat turns reactions on for it.',
      ),
    )

    // Prompts.
    const promptGroup = el('div', { className: 'hl-group' })
    promptGroup.appendChild(
      ui.textField(
        'Framing',
        'The situation, from the character\'s side. Lumiverse macros such as {{char}} and {{user}} work here. ' +
          'Lumiverse adds the character card, persona, world info and memories itself, so leave them out.',
        config.systemPrompt,
        6,
        (v) => patch({ systemPrompt: v }),
        () => {
          patch({ systemPrompt: defaults!.systemPrompt })
          render()
        },
      ),
    )
    promptGroup.appendChild(
      ui.textField(
        'Self-recognition',
        'What the character does when it sees itself on screen. It applies under every stance. Leave it empty to turn it off.',
        config.selfRecognition ?? defaults!.selfRecognition ?? '',
        3,
        (v) => patch({ selfRecognition: v }),
        () => {
          patch({ selfRecognition: defaults!.selfRecognition ?? '' })
          render()
        },
      ),
    )
    // D-073: what the three stance fields share, said once above them.
    promptGroup.appendChild(
      captionHelp(
        el('span', { className: 'hl-subhead hl-subhead-gap', textContent: 'Stances' }),
        'Stances',
        // D-088: the tokens bold, as on the Custom instruction (D8).
        boldTokens(
          'A stance\'s instruction is sent after the chat\'s history. {{scene}} is replaced with what was seen. ' +
            '{{hushed}} is empty unless a hush is part of the moment; wrap hush-only text in {{ifhushed}}…{{/ifhushed}}. More in the guide.',
        ),
      ),
    )
    promptGroup.appendChild(
      ui.textField(
        'Heckler instruction',
        'The Heckler mocks what it sees, one thing at a time.',
        config.roastInstruction,
        10,
        (v) => patch({ roastInstruction: v }),
        () => {
          patch({ roastInstruction: defaults!.roastInstruction })
          render()
        },
      ),
    )
    promptGroup.appendChild(
      ui.textField(
        'Coach instruction',
        'The Coach is helpful and encouraging.',
        config.coachInstruction ?? defaults!.coachInstruction ?? '',
        8,
        (v) => patch({ coachInstruction: v }),
        () => {
          patch({ coachInstruction: defaults!.coachInstruction ?? '' })
          render()
        },
      ),
    )
    promptGroup.appendChild(
      ui.textField(
        'In character instruction',
        'In character has no act to put on.',
        config.characterInstruction ?? defaults!.characterInstruction ?? '',
        8,
        (v) => patch({ characterInstruction: v }),
        () => {
          patch({ characterInstruction: defaults!.characterInstruction ?? '' })
          render()
        },
      ),
    )
    promptGroup.appendChild(
      ui.textField(
        'Talk back instruction',
        'How the character answers when you say something with Talk back. Your line is already in the chat when this is sent.',
        config.talkInstruction ?? defaults!.talkInstruction ?? '',
        6,
        (v) => patch({ talkInstruction: v }),
        () => {
          patch({ talkInstruction: defaults!.talkInstruction ?? '' })
          render()
        },
      ),
    )
    promptGroup.appendChild(
      ui.textField(
        'Box Seat framing',
        'Used in a Box Seat in place of Framing. {{viewers}} becomes the viewers\' names. It carries its own self-recognition text.',
        config.boxFraming ?? defaults!.boxFraming ?? '',
        6,
        (v) => patch({ boxFraming: v }),
        () => {
          patch({ boxFraming: defaults!.boxFraming ?? '' })
          render()
        },
      ),
    )
    promptGroup.appendChild(
      ui.textField(
        'Box Seat focus',
        'Tells the model to write one viewer\'s line and nobody else\'s. {{seat}} is the viewer and {{stance}} their stance in a few words. More in the guide.',
        config.boxFocus ?? defaults!.boxFocus ?? '',
        5,
        (v) => patch({ boxFocus: v }),
        () => {
          patch({ boxFocus: defaults!.boxFocus ?? '' })
          render()
        },
      ),
    )
    if (config.visionMode === 'describe') {
      promptGroup.appendChild(
        ui.textField(
          'Vision prompt',
          'What the vision model is asked. Its answer must be JSON with scene, interest and kind.',
          config.visionPrompt,
          8,
          (v) => patch({ visionPrompt: v }),
          () => {
            patch({ visionPrompt: defaults!.visionPrompt })
            render()
          },
        ),
      )
    }

    // D-088 (D6): Reset to factory, the Prompts card's last line. It asks first.
    // D-089: its own words (asked for after 0.1.4), so it is never mistaken for Troubleshooting's.
    const promptFactory = button('Reset prompts to factory', () => {
      void confirmDanger(ctx, 'Reset Prompts', 'Every prompt on this card goes back to its stock text. Your saved instructions stay.', 'Reset').then((yes) => {
        if (!yes || !defaults) return
        patch({
          systemPrompt: defaults.systemPrompt,
          selfRecognition: defaults.selfRecognition ?? '',
          roastInstruction: defaults.roastInstruction,
          coachInstruction: defaults.coachInstruction ?? '',
          characterInstruction: defaults.characterInstruction ?? '',
          talkInstruction: defaults.talkInstruction ?? '',
          boxFraming: defaults.boxFraming ?? '',
          boxFocus: defaults.boxFocus ?? '',
          visionPrompt: defaults.visionPrompt,
        })
        render()
      })
    }, 'small')
    promptFactory.classList.add('hl-reset')
    promptGroup.appendChild(el('div', { className: 'hl-card-foot' }, [promptFactory]))

    // Settings-pass Part 2: set once, in this order; each section folds and remembers it.
    // Open on a fresh install: Models, Seeing, Pacing. Prompts and Troubleshooting start closed.
    const withHead = (head: string, body: HTMLElement) => el('div', {}, [el('span', { className: 'hl-subhead hl-subhead-gap', textContent: head }), body])
    voiceGroup.appendChild(withHead('What works here', captureTab.backPanel('voiceCheck')))
    testGroup.appendChild(captureTab.backPanel('troubleshooting'))
    testGroup.appendChild(resetBlock())
    const sections: Array<[string, string, HTMLElement, boolean]> = [
      ['models', 'Models', genGroup, true],
      ['seeing', 'Seeing', visionGroup, true],
      ['capture', 'Capture', captureTab.backPanel('capture'), false],
      ['pacing', 'Pacing', paceGroup, true],
      ['voice', 'Voice', voiceGroup, false],
      ['box', 'Box Seat', boxGroup, false],
      ['watchingIn', 'Pinned chat', watchGroup, false],
      ['webSearch', 'Web search', captureTab.backPanel('webSearch'), false],
      // D-088 (D4, D3c): "Mobile", and only on a computer; a phone or tablet has its switches in the tab.
      ...(captureTab.isPhone() ? [] : [['device', 'Mobile', captureTab.backPanel('device'), false] as [string, string, HTMLElement, boolean]]),
      ['prompts', 'Prompts', promptGroup, false],
      ['troubleshooting', 'Troubleshooting', testGroup, false],
    ]
    const sectionHelp: Record<string, HelpContent | undefined> = { pacing: paceHelp, voice: voiceHelp, box: boxHelp, prompts: 'Most people never need to open this. Each prompt has its own Reset to stock.' }
    for (const [id, title, body, open] of sections) panel.appendChild(settingsFold(id, title, body, open, sectionHelp[id]))
    search.apply()
  }

  /**
   * Troubleshooting: the two whole-extension resets, the card's last line (D-088, D6). Each asks
   * through Lumiverse's own dialog; the warning that matters stays in view beside them.
   */
  function resetBlock(): HTMLElement {
    const run = (which: 'settings' | 'factory'): void => {
      ctx.sendToBackend({ type: 'reset_config', scope: which })
      resetNote = { text: 'Resetting…', kind: 'info' }
      render()
    }
    const settingsBtn = button('Reset settings', () => {
      void confirmDanger(ctx, 'Reset settings', 'Every setting goes back to how it came. Your prompts and saved instructions stay.', 'Reset').then((yes) => {
        if (yes) run('settings')
      })
    }, 'danger')
    const factoryBtn = button('Reset to factory', () => {
      void confirmDanger(
        ctx,
        'Reset to factory',
        'Everything Houselights has stored is cleared: settings, prompts, saved instructions and every chat\'s choices. This cannot be undone.',
        'Clear everything',
      ).then((yes) => {
        if (yes) run('factory')
      })
    }, 'danger')
    const settingsTip = helpTip(
      'Reset settings',
      'Puts every setting back to how it came. Your prompts and saved instructions stay, and each chat keeps its switch, stance and Custom instruction.',
    )
    const factoryTip = helpTip(
      'Reset to factory',
      'Clears everything Houselights has stored for you: settings, prompts, saved instructions, each chat\'s switch, stance and Custom ' +
        'instruction, the Watching name and its memory of recent reactions.',
    )
    const box = el('div', { className: 'hl-card-foot' }, [
      el('span', { className: 'hl-status', textContent: 'Reset to factory cannot be undone.' }),
      settingsBtn,
      settingsTip.button,
      factoryBtn,
      factoryTip.button,
    ])
    box.style.flexWrap = 'wrap'
    const wrap = el('div', { className: 'hl-stack' }, [box, settingsTip.note, factoryTip.note])
    if (resetNote) wrap.appendChild(el('div', { className: statusClass(resetNote.kind), textContent: resetNote.text }))
    return wrap
  }

  /** A settings-page section that folds, remembering open/closed in `folds` (key `set.<id>`). */
  function settingsFold(id: string, title: string, body: HTMLElement, defaultOpen: boolean, help?: HelpContent): HTMLDetailsElement {
    const key = `set.${id}`
    const d = el('details', { className: 'hl-group hl-fold' }) as HTMLDetailsElement
    d.dataset.section = id
    // D-085: a card's `[?]` sits after its title; pressing it opens the card, never folds it.
    const tip = help ? helpTip(title, help, () => { d.open = true }) : null
    d.appendChild(foldSummary(title, 'hl-fold-title', tip?.button, SETTINGS_ICONS[id]))
    if (tip) d.appendChild(tip.note)
    if (body.classList.contains('hl-group')) body.className = 'hl-fold-body'
    else body.classList.add('hl-fold-body')
    d.appendChild(body)
    const saved = config?.folds?.[key]
    d.open = typeof saved === 'boolean' ? saved : defaultOpen
    // A press on the title is the user's own: the search will not close this card again.
    d.querySelector('summary')?.addEventListener('click', () => {
      delete d.dataset.hlBySearch
    })
    d.addEventListener('toggle', () => {
      if (d.dataset.hlBySearch) return // opened by the search: not remembered
      const now = config?.folds?.[key]
      if ((typeof now === 'boolean' ? now : defaultOpen) === d.open) return // set by us, not by a click
      patch({ folds: { ...(config?.folds ?? {}), [key]: d.open } })
    })
    return d
  }

  // --- backend wiring -------------------------------------------------------

  const unsubscribe = ctx.onBackendMessage((payload: unknown) => {
    const msg = payload as { type?: string; [k: string]: unknown }

    if (msg.type === 'state') {
      const s = msg as unknown as StatePayload
      config = s.config
      defaults = s.defaults
      connections = s.connections ?? []
      activeChat = s.activeChat
      chatMode = s.chatMode ?? 'follow'
      chats = s.chats ?? []
      sampleScene = s.sampleScene ?? ''
      if (!scene) scene = sampleScene
      if (s.hush) {
        hush = s.hush
        refreshHushButton()
      }
      captureTab.onSettings()
      if (s.watching) captureTab.onWatching(s.watching)
      // D-099: a phone that opens mid-session learns when the computer's session stops itself.
      if (s.companionSession) captureTab.onCompanionSession(s.companionSession.live === true, s.companionSession.stopsInMs !== undefined && s.companionSession.windowMs ? { stopsInMs: s.companionSession.stopsInMs, windowMs: s.companionSession.windowMs } : null)
      // D-057: the whole chat state, box and council included, so the tab and voice know who
      // sits in the box from the first message rather than from the next chat switch.
      const startChat: ChatState = s.chatState ?? {
        type: 'chat_state',
        chat: s.activeChat,
        enabled: s.chatEnabled === true,
        mode: s.chatMode ?? 'follow',
        activeChatId: s.activeChatId ?? null,
        newReactions: s.newReactions ?? 0,
      }
      lastChat = startChat
      captureTab.onChatState(startChat)
      syncPane()
      render()
      return
    }

    // D-060: a setting changed in another window (the phone, another tab): take it, and redraw.
    // A host that can't address one window sends everyone the `config_saved` reply instead.
    const otherWindowsSave =
      (msg.type === 'config_changed' || msg.type === 'config_saved') &&
      typeof msg.saveId === 'string' &&
      !mySaves.has(msg.saveId)
    if (msg.type === 'config_changed' && !otherWindowsSave) return // our own change; config_saved has it
    if (otherWindowsSave) {
      const m = msg as unknown as { config: HouselightsConfig }
      const wasSpeaking = config?.voiceOut === true
      config = m.config
      if (wasSpeaking && config.voiceOut !== true) voice.stop()
      syncPane()
      pane?.refresh()
      captureTab.onSettings()
      captureTab.refreshVoice()
      render()
      return
    }

    if (msg.type === 'config_saved') {
      config = (msg as unknown as { config: HouselightsConfig }).config
      syncPane()
      pane?.refresh()
      return
    }

    if (msg.type === 'watching_state') {
      captureTab.onWatching(msg as unknown as WatchingState)
      return
    }

    if (msg.type === 'reset_done') {
      const factory = msg.scope === 'factory'
      resetNote = { text: factory ? 'Everything Houselights stored is cleared.' : 'Settings are back to how they came. Your prompts stayed.', kind: 'ok' }
      ctx.sendToBackend({ type: 'get_state' }) // everything shown comes back from the source
      render()
      return
    }

    if (msg.type === 'chat_state') {
      const s = msg as unknown as ChatState
      // Who is in the box, for voice: which viewer a spoken line belongs to (D16 fallback
      // voices, D-054 "Speaks aloud"). Kept here — this branch returns.
      lastChat = s
      activeChat = s.chat
      chatMode = s.mode ?? 'follow'
      captureTab.onChatState(s)
      render()
      return
    }

    if (msg.type === 'chats') {
      chats = (msg as unknown as { chats: ChatOption[] }).chats ?? []
      render()
      return
    }

    if (msg.type === 'capture_received') {
      captureTab.onReceipt(msg as unknown as CaptureReceipt)
      return
    }

    // D19: a line the user said is in the chat. Whatever took it from the chat box (or the
    // toolbar's own input) may clear it now; a different line or chat leaves the box alone.
    if (msg.type === 'talk_landed') {
      const chatId = typeof msg.chatId === 'string' ? msg.chatId : ''
      const text = typeof msg.text === 'string' ? msg.text : ''
      composer.landed(chatId, text)
      toolbar?.landed(chatId, text)
      return
    }

    // D-063: desktop companion. Every window hears these; the tab decides what applies to it.
    if (msg.type === 'companion_frame') {
      captureTab.onCompanionFrame(msg as unknown as CompanionFrame)
      return
    }
    if (msg.type === 'companion_reaction') {
      captureTab.onCompanionReaction((msg as unknown as { result: ReactionResult }).result)
      return
    }
    if (msg.type === 'companion_session') {
      const stopsInMs = Number(msg.stopsInMs)
      const windowMs = Number(msg.windowMs)
      captureTab.onCompanionSession(msg.live === true, Number.isFinite(stopsInMs) && Number.isFinite(windowMs) && windowMs > 0 ? { stopsInMs, windowMs } : null)
      return
    }
    if (msg.type === 'remote_extend_request') {
      captureTab.onRemoteExtendRequest()
      return
    }
    if (msg.type === 'remote_look_request') {
      captureTab.onRemoteLookRequest(msg as unknown as RemoteLookRequest)
      return
    }
    if (msg.type === 'remote_look_result') {
      captureTab.onRemoteLookResult(msg as unknown as RemoteLookResult)
      return
    }

    if (msg.type === 'reaction_progress') {
      captureTab.onProgress(msg as unknown as ReactionProgress)
      return
    }

    if (msg.type === 'reaction_result') {
      const result = msg as unknown as ReactionResult
      // D-060: only the window that asked speaks. On a host that can't address one window,
      // every open Houselights (a phone, a second tab) gets every reaction; each used to
      // read it aloud by its own copy of the settings, so voice "off" here still spoke there.
      // D-068: a comment after a hush was asked by nobody; the window that is sharing speaks it.
      // D-100: nor was a curtain call; the window whose session just ended speaks it.
      const mine =
        captureTab.onReaction(result) ||
        (result.origin === 'after-hush' && result.ok && captureTab.isLive()) ||
        (result.origin === 'curtain-call' && result.ok && captureTab.justEnded())
      if (!mine) return
      // D16: spoken after it lands — only the character's lines, never the beat.
      // D-054: in a box, maybe only one viewer speaks aloud. A choice that no longer sits in the box means everyone.
      // D-057: the backend decides who speaks, from the config as saved when the Look ran,
      // and stamps each line with its viewer, so a phone that loaded before the choice was
      // made (or before it heard who sits in the box) obeys it without a re-pick.
      const viewers = lastChat?.box?.viewers ?? []
      const only =
        result.speakOnly !== undefined
          ? result.speakOnly
          : speakerOf(config?.boxSpeakers, result.chatId ?? '', viewers.filter((x) => x.seated !== false))
      voice.speakReaction(
        result,
        (line) => {
          if (line.viewerId) return line.viewerId
          const v = viewers.find((x) => (line.characterId && x.id === line.characterId) || x.name === line.name)
          return v?.id ?? null
        },
        only,
      )
      return
    }

    if (msg.type === 'roast_result') {
      busy = false
      status = msg.ok
        ? { text: `Sent to the chat: "${String(msg.roast)}"`, kind: 'ok' }
        : { text: `Failed: ${String(msg.error)}`, kind: 'err' }
      render()
      return
    }

    if (msg.type === 'lookup_status') {
      captureTab.onLookupStatus(msg as unknown as LookupStatus)
      return
    }

    if (msg.type === 'tail') {
      pane?.setTail(msg as unknown as TailPayload)
      return
    }

    if (msg.type === 'hush_state') {
      const next = msg as unknown as HushState
      const changed = next.hushed !== hush.hushed || next.source !== hush.source
      // D16/H2: a hush stops speech in progress, once, as it starts. Not on every
      // repeat of the state: a Look you press while hushed still gets its say.
      const silence = next.hushed && changed
      hush = next
      refreshHushButton()
      pane?.setHush(hush)
      captureTab.onHush()
      if (silence) voice.stop()
      if (changed) render()
      return
    }
  })

  // Any message landing anywhere (ours included) may change the tail.
  const unsubMessageSent = ctx.events.on('MESSAGE_SENT', () => pane?.noteActivity())

  render()
  ctx.sendToBackend({ type: 'get_state' })
  // D16: the media check is async; the voice controls appear once it answers.
  void voice.refreshPermissions().then(() => {
    render()
    pane?.refresh()
    captureTab.refreshVoice()
  })

  return () => {
    unsubMessageSent()
    pane?.destroy()
    pane = null
    toolbar = null
    composer.destroy()
    voice.destroy()
    beatDecorator.destroy()
    captureTab.destroy()
    if (hushTicker !== null) clearInterval(hushTicker)
    unsubHushClick()
    hushAction.destroy()
    unsubscribe()
    removeStyle()
    ctx.dom.cleanup()
  }
}
