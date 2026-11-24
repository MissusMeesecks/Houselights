/**
 * Backend (the "Mouth").
 *
 * Runs in a sandboxed Bun process inside Lumiverse. Its job: take what's on
 * screen, ask the character to be funny about it, and put the result in the
 * chat.
 *
 * Houselights Phase 2 — Mode A. A frame arrives from the capture tab; in
 * `describe` mode a vision model writes a neutral scene report, in `attach`
 * mode the image itself goes to the character's model. Either way the
 * reaction is produced through Lumiverse's own assembly (`spindle.assemble`
 * with our block graph → `generate.quiet`), so chat history, persona, world
 * info and memories come for free, then the beat (what was seen) is appended
 * to the chat as a hidden message and the reaction as a visible one.
 */

import { LOOKUP_RESULT_COUNT, buildQuery, lookupTerms, noteRows, passageFrom, referenceText, shouldSearch, type LookupMemory, type LookupResult } from './lookup.ts'
import { DEFAULT_VOICE_SETTINGS, type SttPhoneChoice, type SttProviderChoice } from './voice.ts'
import type { ChatDTO, GenerationRequestDTO, GenerationResponseDTO, LlmMessageDTO } from 'lumiverse-spindle-types'
import { sameGame } from './names'
import { sceneSimilarity, SAME_MOMENT_SIMILARITY } from './similarity.ts'
import { curtainDue, curtainMoments, newSessionLog, noteMoment, sessionMinutes, type SessionLog } from './curtain.ts'
import { noThinkingOverride, reasoningLength, REASONING_HEADROOM, withHeadroom } from './reasoning.ts'
import {
  DEFAULT_CAPTURE_SETTINGS,
  base64ByteLength,
  isCaptureSource,
  type CapturePayload,
  type CaptureReceipt,
  type CaptureSettings,
  type BoxLine,
  type BoxViewerInfo,
  type CaptureSource,
  type ChatState,
  type Stance,
  isStance,
  type WatchingState,
  type ReactionResult,
  type ReactionSkipReason,
  type ReactionTrigger,
  type TailEntry,
} from './capture.ts'
import type { HushTold, LookupStatus, ReactionProgress } from './capture.ts'
import { DEFAULT_STANCE, speakerOf, chatLooksUp } from './capture.ts'
import {
  ATTACHED_SCENE_PLACEHOLDER,
  DEFAULT_BOX_FRAMING,
  DEFAULT_CHARACTER_INSTRUCTION,
  PREVIOUS_CHARACTER_INSTRUCTIONS,
  PREVIOUS_HECKLER_INSTRUCTIONS,
  DEFAULT_COACH_INSTRUCTION,
  OLD_SELF_RECOGNITION,
  DEFAULT_BOX_FOCUS,
  boxFocusText,
  boxFramingText,
  boxRosterText,
  firstSpeakerText,
  mentionedViewer,
  seatOrder,
  type SeatCard,
  stripHostTail,
  type BoxViewer,
  DEFAULT_REACTION_INSTRUCTION,
  DEFAULT_SELF_RECOGNITION,
  DEFAULT_TALK_INSTRUCTION,
  DEFAULT_SYSTEM_PROMPT,
  stanceInstruction,
  attachImageToBeat,
  beatMessageText,
  buildBlockGraph,
  seenViaPhrase,
  stripNameTag,
  substituteScene,
  watchingLead,
  sceneWithWatching,
  hushRecapText,
  curtainScene,
  curtainClosing,
  hushedNote,
  usesHushed,
  type HushedMoment,
} from './prompt.ts'
import { DEFAULT_VISION_PROMPT, buildVisionMessages, upgradeVisionPrompt, ensureAppFields, ensureLookupField, withMatchesField, parseSceneResponse, type SceneReport } from './vision.ts'
import { confirmWatching, screenCheck, sessionEnded, sessionStarted, storedWatching, watchingFrom, type StoredWatching, type WatchingCore } from './watching.ts'

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type VisionMode = 'attach' | 'describe'

interface HouselightsConfig extends CaptureSettings {
  /** Which model writes the reaction. null = the user's default connection. */
  connectionId: string | null
  maxTokens: number
  /** Show the Pane (the float widget over the page). Release two. */
  showPane: boolean
  /** D-055: the widget on a phone or tablet — its own switch, off by default. */
  showPaneMobile: boolean
  /** D-063: a phone follows the computer (desktop companion). */
  companionPhone: boolean
  /** The portrait on the widget's picture: its height as a share of the picture's, and its opacity. */
  portraitSizePct: number
  portraitOpacityPct: number
  /** D-059: the widget's text size (percent) and its two corner toggles. */
  paneTextPct: number
  paneHidePicture: boolean
  paneLinesOnly: boolean
  /**
   * D5 linked-chat mode: reactions go to this chat wherever the user is. null =
   * follow the active chat (Mode A). Pinning also switches that chat on.
   */
  pinnedChatId: string | null
  temperature: number
  topP: number
  /** The framing prompt (who the character is, what it's doing). Macros allowed. */
  systemPrompt: string
  /** The Heckler instruction (D17 default stance), after the history. `{{scene}}` is replaced with what was seen. */
  roastInstruction: string
  /** D17 Coach stance instruction. */
  coachInstruction: string
  /** D17 In-character stance instruction. */
  characterInstruction: string
  /** D17 base block: the self-recognition lines under every stance. Empty turns them off. */
  selfRecognition: string
  /** Talk-back (D14): the instruction after the beat when the user said something. */
  talkInstruction: string
  /** Box Seat (D13′): the framing for a group chat; `{{viewers}}` is the names. */
  boxFraming: string
  /** Box Seat (D13″): the focus block — one seat's line per call; `{{seat}}`, `{{stance}}`, `{{answerNote}}`, `{{talkNote}}`. */
  boxFocus: string
  /** Box Seat: at most this many lines per Look (1–4). */
  boxLines: number
  /** Box Seat: let a second viewer answer the first. Off = one line from one viewer. */
  boxRebuttal: boolean
  /** Box Seat, R6: seat the user's council members in the box through the roster block. Off by default. */
  boxCouncil: boolean
  /**
   * D18, before D18″: one switch for every chat, which Coach and Custom used. Look things up is
   * now each chat's own switch; this is only what a chat that has not been asked falls back to.
   */
  coachSearch: boolean
  /** Open the Pane's pop-out window when a session starts. */
  popoutOnStart: boolean
  /** D-046: while a session runs, the next-track media key takes a Look. */
  mediaKeyLook: boolean
  /** The tab's Models fold: open unless the user closed it. */
  modelsOpen: boolean
  /** The tab's folds, by id: true open, false closed. */
  folds: Record<string, boolean>
  /** Named Custom stance instructions, shared by every chat (D-050). */
  customPresets: { name: string; text: string }[]
  /** Voice (D16): speak reactions aloud; the Pane's speaker toggle. Off by default. */
  voiceOut: boolean
  /** Voice (D16): which recogniser the mic uses. */
  sttProvider: SttProviderChoice
  /** D-057: the mic recogniser on a phone. Absent = automatic. */
  sttProviderPhone?: SttPhoneChoice
  /** Voice (D16): send what the mic heard after a short delay, unless the user intervenes. */
  voiceAutoSend: boolean
  voiceAutoSendDelaySeconds: number
  /** Voice (D16), box fallback: a TTS connection per viewer id for lines that cannot play by message. */
  boxVoices: Record<string, string>
  /** D-054: per chat, the one Box Seat viewer whose lines are spoken aloud. Absent = everyone. */
  boxSpeakers: Record<string, string>
  /** `describe`: a vision model writes a scene report. `attach`: the image goes to the character's model. */
  visionMode: VisionMode
  /** Connection for the vision model in `describe` mode. null = same as the reaction's. */
  visionConnectionId: string | null
  /** The prompt the vision model gets in `describe` mode. */
  visionPrompt: string
  /** Keep the full downscaled frame on the hidden beat message, not just the thumbnail. */
  attachFullFrame: boolean
  /**
   * Let the models use extended thinking. Off by default: a one-line heckle
   * doesn't need it, and a thinking model can spend the whole token budget
   * reasoning and hand back an empty reply.
   */
  allowReasoning: boolean
  /** Give up on a model call after this long. */
  generationTimeoutSeconds: number
  /** Minimum gap between automatic (continuous-mode) reactions. */
  cooldownSeconds: number
  /** Minimum interest (0-10, judged by the vision model) worth commenting on automatically. */
  salienceBar: number
  /** Scene kinds never worth commenting on automatically. */
  skipKinds: string[]
  /** How many recent reactions to show the model so it stops repeating itself. */
  roastMemory: number
  /** How long the manual hush button silences it for. */
  hushMinutes: number
  /** How long to stay quiet after you send a message, so you can hold a conversation. */
  conversationGraceSeconds: number
  /** Interest level that breaks through a hush anyway. 11 disables it (the default, H2). */
  overrideInterest: number
  /**
   * D-101: a moment rated this high is commented on even when its kind is on the skip list
   * (a death screen can come back as `menu`). 11 disables it.
   */
  kindBreakInterest: number
  /** D-068: when a hush you pressed ends, comment on the most interesting moment seen during it. */
  hushEndComment: boolean
  /** D-100: when a session ends, one closing line about it. */
  curtainCall: boolean
  /** H2: 1 once a saved old default of 9 has been moved to 11. Never shown. */
  hushBreakVersion: number
}

const DEFAULT_CONFIG: HouselightsConfig = {
  ...DEFAULT_CAPTURE_SETTINGS,
  connectionId: null,
  maxTokens: 300,
  showPane: true,
  showPaneMobile: true, // D-078 (was off, D-055)
  companionPhone: false,
  portraitSizePct: 25,
  portraitOpacityPct: 100,
  paneTextPct: 100,
  paneHidePicture: false,
  paneLinesOnly: false,
  pinnedChatId: null,
  temperature: 1,
  topP: 0.95,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  roastInstruction: DEFAULT_REACTION_INSTRUCTION,
  coachInstruction: DEFAULT_COACH_INSTRUCTION,
  characterInstruction: DEFAULT_CHARACTER_INSTRUCTION,
  selfRecognition: DEFAULT_SELF_RECOGNITION,
  talkInstruction: DEFAULT_TALK_INSTRUCTION,
  boxFraming: DEFAULT_BOX_FRAMING,
  boxFocus: DEFAULT_BOX_FOCUS,
  boxLines: 2,
  boxRebuttal: true,
  boxCouncil: false,
  coachSearch: false,
  popoutOnStart: true,
  mediaKeyLook: false,
  modelsOpen: true,
  folds: {},
  customPresets: [],
  ...DEFAULT_VOICE_SETTINGS,
  boxSpeakers: {},
  visionMode: 'describe',
  visionConnectionId: null,
  visionPrompt: DEFAULT_VISION_PROMPT,
  attachFullFrame: false,
  allowReasoning: false,
  generationTimeoutSeconds: 90,
  cooldownSeconds: 25,
  salienceBar: 4,
  skipKinds: ['menu', 'loading'],
  roastMemory: 6,
  hushMinutes: 5,
  conversationGraceSeconds: 45,
  overrideInterest: 11,
  kindBreakInterest: 8,
  hushEndComment: true,
  curtainCall: true,
  hushBreakVersion: 1,
}

/** A stand-in scene so the "test a reaction" button works with zero setup. */
const SAMPLE_SCENE =
  'Health bar at 5%. Three unused healing potions in the inventory. ' +
  'The boss is winding up a large overhead attack. The player is walking directly toward it.'

/** What a settings reset keeps: the prompts, and the instructions saved under a name. */
const PROMPT_KEYS = [
  'systemPrompt', 'selfRecognition', 'roastInstruction', 'coachInstruction', 'characterInstruction',
  'talkInstruction', 'boxFraming', 'boxFocus', 'visionPrompt', 'customPresets',
] as const satisfies ReadonlyArray<keyof HouselightsConfig>
const CONFIG_PATH = 'config.json'
const ROASTS_PATH = 'recent-roasts.json'
const CHATS_PATH = 'mode-a-chats.json'
const WATCHING_PATH = 'watching.json'

async function loadConfig(userId?: string): Promise<HouselightsConfig> {
  const stored = await spindle.userStorage.getJson<Partial<HouselightsConfig>>(CONFIG_PATH, {
    fallback: {},
    userId,
  })
  // Old keys from the September build (sceneUrl, pollSeconds, …) ride along
  // harmlessly; the frontend ignores what it doesn't know.
  const merged = { ...DEFAULT_CONFIG, ...stored }
  // The September system prompt and instruction carried the whole job; the
  // Phase 2 defaults are shaped for native assembly. Anyone still on the old
  // defaults gets the new ones; anyone who customised keeps their text.
  if (stored.systemPrompt && stored.systemPrompt.includes('watching {{user}} play a video game')) {
    merged.systemPrompt = DEFAULT_SYSTEM_PROMPT
  }
  // The first self-recognition draft read D17 backwards (the user, not the character).
  if (stored.selfRecognition === OLD_SELF_RECOGNITION) merged.selfRecognition = DEFAULT_SELF_RECOGNITION
  if (stored.roastInstruction && stored.roastInstruction.includes('{{recentRoasts}}')) {
    merged.roastInstruction = DEFAULT_REACTION_INSTRUCTION
  }
  // D-073: a never-edited Heckler or In character instruction follows the new built-in one.
  if (stored.roastInstruction !== undefined && PREVIOUS_HECKLER_INSTRUCTIONS.includes(stored.roastInstruction)) merged.roastInstruction = DEFAULT_REACTION_INSTRUCTION
  if (stored.characterInstruction !== undefined && PREVIOUS_CHARACTER_INSTRUCTIONS.includes(stored.characterInstruction)) merged.characterInstruction = DEFAULT_CHARACTER_INSTRUCTION
  // D-057: a never-edited vision prompt follows the built-in one (it now reads the words in memes and posts).
  if (stored.visionPrompt !== undefined) merged.visionPrompt = upgradeVisionPrompt(stored.visionPrompt) ?? DEFAULT_VISION_PROMPT
  // H2: 9 was the old default, never a choice — a hush is a hush now. Once: the next save
  // stores the marker, so a 9 chosen after this stays 9.
  if ((stored.hushBreakVersion ?? 0) < 1) {
    if (stored.overrideInterest === 9) merged.overrideInterest = 11
    merged.hushBreakVersion = 1
  }
  return merged
}

async function saveConfig(config: HouselightsConfig, userId?: string): Promise<void> {
  await spindle.userStorage.setJson(CONFIG_PATH, config, { userId })
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/** When the last automatic reaction landed, per user. A restart owes no cooldown. */
const lastRoastAt = new Map<string, number>()

/** Manual hush expiry, per user — set by the button in the chat input bar. */
const hushUntil = new Map<string, number>()

/** Conversation grace expiry, per user — set automatically when you speak. */
const conversationUntil = new Map<string, number>()
/** H3: the last beat kept during a hush, per user — one per cooldown, and not the same moment twice. */
const lastHushedBeat = new Map<string, { at: number; scene: string }>()
/** D-067: the hushed moments not yet mentioned, newest last (at most five), per user. */
const hushedSeen = new Map<string, Array<{ time: string; scene: string; interest: number; quiet: 'button' | 'conversation' }>>()
/** D-068: the timer that notices a pressed hush running out, per user. */
const hushEndTimer = new Map<string, ReturnType<typeof setTimeout>>()
const HUSH_RECAP_MAX = 5
/** D-069: when the hush you pressed began, per user (pressing again while hushed keeps it). */
const hushStartedAt = new Map<string, number>()
/** D-069: a pressed hush that ended and has not been spoken after yet, per user. */
const hushJustEnded = new Map<string, { at: number; minutes: number }>()
/** D-069: after this long, "the first thing since the hush" is no longer worth saying. */
const HUSH_NOTE_MAX_AGE_MS = 30 * 60_000

/**
 * Real generations in flight, per user, by generation id with the time each
 * started. A reaction appended while Lumiverse is mid-stream can land inside
 * someone else's turn, so this block is absolute and nothing overrides it —
 * not even a 10/10 moment.
 *
 * Tracked by id, and never filtered by our own state: an end event that is
 * dropped leaves the user "busy" for good, and every Look and Send after it
 * is held back for a reply nobody is writing. (Our own `generate.quiet()`
 * raises no generation events at all — verified in the host source,
 * `services/generation/direct-generation.ts` — so there is nothing of ours to
 * filter here.) A start that never reports an end expires after a while.
 */
const generationBusy = new Map<string, Map<string, number>>()
const GENERATION_STALE_MS = 10 * 60 * 1000

function isGenerationBusy(userId: string): boolean {
  const gens = generationBusy.get(userId)
  if (!gens) return false
  const now = Date.now()
  for (const [id, startedAt] of gens) {
    if (now - startedAt > GENERATION_STALE_MS) {
      gens.delete(id)
      spindle.log.warn(`generation ${id} started ${Math.round((now - startedAt) / 1000)}s ago and never reported an end; no longer treating the chat as busy`)
    }
  }
  if (gens.size === 0) generationBusy.delete(userId)
  return gens.size > 0
}

/**
 * Users whose in-flight activity is *ours*. Our own `appendMessage()` calls
 * raise the same `MESSAGE_SENT` we listen to, so without this the extension
 * would go quiet "while you talk" every time it spoke.
 */
const roastInFlight = new Set<string>()

/** Users with a reaction being produced right now — one at a time, per user. */
const reacting = new Set<string>()

/**
 * The most recent frame each user sent, kept in memory only. Nothing is ever
 * written to disk. One frame per user, so memory stays bounded.
 */
interface StoredCapture {
  /** D15: the frontend's change gate saw an alt-tab sized shift before this frame. */
  shift?: boolean
  jpegB64: string
  thumbB64: string
  width: number
  height: number
  source: CapturePayload['source']
  capturedAt: number
  receivedAt: number
  localTime?: string
}
const lastCapture = new Map<string, StoredCapture>()

/**
 * D-063: which window is sharing a screen, per user, so a phone in companion mode
 * can ask it to look. The window's session id ('' when the host doesn't give one).
 * Set and cleared by that window's `session_state`.
 */
const liveWindow = new Map<string, string>()
/** D-100: what the running session has seen, per user, for its curtain call. Gone when it ends. */
const sessionLogs = new Map<string, SessionLog>()
/**
 * D-099: when that session stops itself, by this worker's clock, and how long its window is.
 * A companion phone shows the last two minutes and can ask for more time.
 */
const liveStop = new Map<string, { at: number; windowMs: number }>()
function companionSession(userId: string): { type: 'companion_session'; live: boolean; stopsInMs?: number; windowMs?: number } {
  const live = liveWindow.get(userId) !== undefined
  const stop = live ? liveStop.get(userId) : undefined
  return { type: 'companion_session', live, ...(stop ? { stopsInMs: Math.max(0, stop.at - Date.now()), windowMs: stop.windowMs } : {}) }
}
/** A window's "this session stops itself in N ms, of a window of M ms", as numbers or nothing. */
function readStop(msg: Record<string, unknown>): { at: number; windowMs: number } | null {
  const stopsInMs = Number(msg.stopsInMs)
  const windowMs = Number(msg.windowMs)
  if (!Number.isFinite(stopsInMs) || stopsInMs <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) return null
  return { at: Date.now() + stopsInMs, windowMs }
}

/** Whether the host can route a reply to one specific browser document. */
const canTargetSessions = (): boolean =>
  Number(spindle.host?.capabilities?.['frontend-session-routing-v1'] ?? 0) >= 1

/**
 * D11, v1 half: detect only. `listDevices()` and `getApprovalStatus()` both
 * require the `screen_capture` permission to be declared *and* granted, so
 * calling them from a v1 manifest just produces a permission error. The host
 * capability is the honest signal until release two adds the permission.
 */
function detectDesktopCapture(): { capability: number; apiPresent: boolean } {
  const capability = Number(spindle.host?.capabilities?.['desktop-capture-worker-v1'] ?? 0)
  const desktop = (spindle as unknown as { desktop?: { capture?: { listDevices?: unknown } } }).desktop
  return { capability, apiPresent: typeof desktop?.capture?.listDevices === 'function' }
}

// ---------------------------------------------------------------------------
// Per-chat enable (plan-v2 §12 PER_CHAT_ENABLE, default off)
// ---------------------------------------------------------------------------

/**
 * One chat's Houselights settings. Older installs stored a bare `true` per
 * enabled chat; that still reads, as "enabled, heckler".
 */
interface ChatRecord {
  enabled: boolean
  /** D17: the stance this chat's viewer takes. Absent = heckler. */
  stance?: Stance
  /** D17: the Custom stance's instruction. */
  custom?: string
  /** Box Seat: per-viewer stances, by member id (`council:<id>` for seated council members). Absent = the chat's. */
  viewers?: Record<string, Stance>
  /** Box Seat, group chats: council members left out of this chat's box, by viewer id (`council:<id>`). Absent = all seated. */
  councilOut?: string[]
  /** D-052, solo chats: council members sitting in this chat, by viewer id. Absent = none (a solo chat stays solo). */
  councilIn?: string[]
  /** D-052: a viewer's own Custom instruction, by viewer id. Absent = the chat's `custom`. */
  viewerCustom?: Record<string, string>
  /** D18″: Look things up in this chat. Absent = never asked (see `chatLooksUp`). */
  lookUp?: boolean
}
type StoredChats = Record<string, boolean | ChatRecord>

async function loadChats(userId?: string): Promise<StoredChats> {
  const stored = await spindle.userStorage.getJson<StoredChats>(CHATS_PATH, { fallback: {}, userId })
  return stored && typeof stored === 'object' ? stored : {}
}
function chatRecordOf(stored: StoredChats, chatId: string): ChatRecord {
  const v = stored[chatId]
  if (v && typeof v === 'object') {
    const viewers: Record<string, Stance> = {}
    if (v.viewers && typeof v.viewers === 'object') for (const [id, st] of Object.entries(v.viewers)) if (isStance(st)) viewers[id] = st
    return {
      enabled: v.enabled === true,
      ...(isStance(v.stance) ? { stance: v.stance } : {}),
      ...(typeof v.custom === 'string' ? { custom: v.custom } : {}),
      ...(typeof v.lookUp === 'boolean' ? { lookUp: v.lookUp } : {}),
      ...(Object.keys(viewers).length ? { viewers } : {}),
      ...(Array.isArray(v.councilOut) && v.councilOut.length
        ? { councilOut: v.councilOut.filter((x): x is string => typeof x === 'string') }
        : {}),
      ...(Array.isArray(v.councilIn) && v.councilIn.length
        ? { councilIn: v.councilIn.filter((x): x is string => typeof x === 'string') }
        : {}),
      ...(() => {
        const vc: Record<string, string> = {}
        if (v.viewerCustom && typeof v.viewerCustom === 'object') for (const [id, t] of Object.entries(v.viewerCustom)) if (typeof t === 'string' && t.trim()) vc[id] = t
        return Object.keys(vc).length ? { viewerCustom: vc } : {}
      })(),
    }
  }
  return { enabled: v === true }
}
async function chatRecord(chatId: string, userId?: string): Promise<ChatRecord> {
  return chatRecordOf(await loadChats(userId), chatId)
}
async function saveChatRecord(chatId: string, record: ChatRecord, userId?: string): Promise<void> {
  const chats = await loadChats(userId)
  // A chat that is off, on the default stance, with nothing custom, needs no row.
  if (!record.enabled && (record.stance ?? DEFAULT_STANCE) === DEFAULT_STANCE && !record.custom && !record.viewers && !record.councilOut?.length && !record.councilIn?.length && !record.viewerCustom && record.lookUp === undefined) delete chats[chatId]
  else chats[chatId] = record
  await spindle.userStorage.setJson(CHATS_PATH, chats, { userId })
}

async function isChatEnabled(chatId: string, userId?: string): Promise<boolean> {
  return (await chatRecord(chatId, userId)).enabled
}

async function setChatEnabled(chatId: string, enabled: boolean, userId?: string): Promise<void> {
  await saveChatRecord(chatId, { ...(await chatRecord(chatId, userId)), enabled }, userId)
}

/** Box Seat: one viewer's stance in a group chat. */
async function setViewerStance(chatId: string, viewerId: string, stance: Stance, userId?: string): Promise<void> {
  const r = await chatRecord(chatId, userId)
  await saveChatRecord(chatId, { ...r, viewers: { ...(r.viewers ?? {}), [viewerId]: stance } }, userId)
  spindle.log.info(`stance: ${chatId} viewer ${viewerId} → ${stance}`)
}

/**
 * Box Seat (D13′): is this chat a group, and who sits in the box? A group chat
 * is `metadata.group` with `metadata.character_ids`; the chat's own
 * `character_id` is the primary member, who gets any line we cannot attribute.
 * The group's card mode should be `merge`, so every member's card reaches the
 * prompt through `assemble`; anything else is reported so the tab can say so.
 * With `boxCouncil` on (R6), the user's council members are seated too, with
 * their card fields carried in the roster block.
 */
interface BoxSeat {
  cardMode: string
  primaryId: string
  primaryName: string
  /** D-052: a solo chat, made a box by the council members sitting in it. */
  solo: boolean
  /** `custom` here is the text this viewer's Custom stance uses: their own (D-052), else the chat's. */
  viewers: Array<BoxViewerInfo & { characterId: string | null; avatarUrl: string | null; custom?: string; roster?: BoxViewer['roster'] }>
}

/** A box is a box when it is a group chat, or a solo chat with at least one council member sitting in it. */
function isBox(box: BoxSeat | null): box is BoxSeat {
  return !!box && (!box.solo || box.viewers.filter((v) => v.seated !== false).length >= 2)
}

async function isGroupChat(chatId: string, userId: string): Promise<boolean> {
  try {
    const chat = await spindle.chats.get(chatId, userId)
    return (chat?.metadata as Record<string, unknown> | undefined)?.group === true
  } catch {
    return false
  }
}

async function boxOf(chat: ChatDTO, record: ChatRecord, config: HouselightsConfig, userId: string): Promise<BoxSeat | null> {
  const meta = (chat.metadata ?? {}) as Record<string, unknown>
  const ids = meta.character_ids
  const group = meta.group === true && Array.isArray(ids)
  // D-052: a solo chat is a candidate box only while council seating is on.
  if (!group && (!config.boxCouncil || !chat.character_id)) return null
  const memberIds = group ? (ids as unknown[]).filter((x): x is string => typeof x === 'string') : [chat.character_id]
  if (!memberIds.includes(chat.character_id)) memberIds.unshift(chat.character_id)
  const chatStance: Stance = record.stance ?? DEFAULT_STANCE
  const stanceOf = (id: string): Stance => record.viewers?.[id] ?? chatStance
  const customOf = (id: string): string | undefined => record.viewerCustom?.[id] ?? record.custom
  // Group chats seat every council member unless left out; solo chats seat only those asked in.
  const councilSeated = (id: string): boolean => (group ? !(record.councilOut ?? []).includes(id) : (record.councilIn ?? []).includes(id))
  const viewers: BoxSeat['viewers'] = []
  for (const id of memberIds) {
    const name = (await characterName(id, userId)) ?? 'Viewer'
    viewers.push({ id, name, kind: 'card', stance: stanceOf(id), characterId: id, avatarUrl: null, custom: customOf(id) })
  }
  if (config.boxCouncil) {
    try {
      const members = await spindle.council.getMembers({ userId })
      for (const m of members) {
        const id = `council:${m.memberId}`
        viewers.push({
          id,
          name: m.name,
          kind: 'council',
          seated: councilSeated(id),
          stance: stanceOf(id),
          characterId: null,
          avatarUrl: m.avatarUrl ?? null,
          custom: customOf(id),
          roster: { definition: m.definition, personality: m.personality, behavior: m.behavior },
        })
      }
    } catch (err) {
      spindle.log.warn(`box: council members unavailable: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const primaryName = viewers.find((v) => v.id === chat.character_id)?.name ?? (await characterName(chat.character_id, userId)) ?? 'Viewer'
  return { cardMode: group ? (typeof meta.group_card_mode === 'string' ? meta.group_card_mode : 'swap') : 'solo', primaryId: chat.character_id, primaryName, viewers, solo: !group }
}

async function setChatStance(chatId: string, stance: Stance, custom: string | undefined, userId?: string): Promise<void> {
  const r = await chatRecord(chatId, userId)
  const next: ChatRecord = { ...r, stance }
  if (typeof custom === 'string') next.custom = custom.slice(0, 4000)
  await saveChatRecord(chatId, next, userId)
  spindle.log.info(`stance: ${chatId} → ${stance}${stance === 'custom' ? ` (${(next.custom ?? '').length} chars)` : ''}`)
}

const characterNames = new Map<string, string>()
async function characterName(characterId: string | null | undefined, userId: string): Promise<string | null> {
  if (!characterId) return null
  const cached = characterNames.get(characterId)
  if (cached) return cached
  try {
    const name = (await spindle.characters.get(characterId, userId))?.name ?? null
    if (name) characterNames.set(characterId, name)
    return name
  } catch {
    return null
  }
}

/** Reactions appended to a pinned chat while the user was looking elsewhere, per user. */
const unseenReactions = new Map<string, number>()

/**
 * The chat reactions go to. Pinned (D5) wins while the pin resolves; a pin to
 * a chat that no longer exists is dropped, loudly, and we follow the active
 * chat again.
 */
async function watchedChat(userId: string): Promise<{ chat: ChatDTO | null; mode: 'follow' | 'pinned'; active: ChatDTO | null }> {
  const config = await loadConfig(userId)
  const active = await spindle.chats.getActive(userId)
  if (!config.pinnedChatId) return { chat: active, mode: 'follow', active }
  if (active?.id === config.pinnedChatId) return { chat: active, mode: 'pinned', active }
  let pinned: ChatDTO | null = null
  try {
    pinned = await spindle.chats.get(config.pinnedChatId, userId)
  } catch (err) {
    spindle.log.warn(`pinned chat ${config.pinnedChatId} unreadable: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (pinned) return { chat: pinned, mode: 'pinned', active }
  spindle.log.warn(`pinned chat ${config.pinnedChatId} is gone; following the active chat again`)
  await saveConfig({ ...config, pinnedChatId: null }, userId)
  unseenReactions.delete(userId)
  spindle.toast.warning('The chat Houselights was pinned to is gone. Following your active chat again.', { userId })
  return { chat: active, mode: 'follow', active }
}

async function chatState(userId: string): Promise<ChatState> {
  const { chat, mode, active } = await watchedChat(userId)
  if (!chat) return { type: 'chat_state', chat: null, enabled: false, mode, activeChatId: active?.id ?? null, newReactions: 0 }
  const record = await chatRecord(chat.id, userId)
  const config = await loadConfig(userId)
  const box = await boxOf(chat, record, config, userId)
  const looks = (stance: Stance) => chatLooksUp(record.lookUp, config.coachSearch, stance)
  return {
    type: 'chat_state',
    chat: {
      id: chat.id,
      name: chat.name,
      characterId: chat.character_id ?? null,
      characterName: await characterName(chat.character_id, userId),
    },
    enabled: record.enabled,
    mode,
    activeChatId: active?.id ?? null,
    newReactions: mode === 'pinned' ? (unseenReactions.get(userId) ?? 0) : 0,
    stance: record.stance ?? DEFAULT_STANCE,
    customStance: record.custom ?? '',
    lookUp: isBox(box) ? box.viewers.some((v) => v.seated !== false && looks(v.stance)) : looks(record.stance ?? DEFAULT_STANCE),
    ...(isBox(box)
      ? {
          box: {
            viewers: box.viewers.map(({ id, name, kind, stance, seated }) => ({
              id,
              name,
              kind,
              stance,
              ...(seated === false ? { seated: false } : {}),
              ...(record.viewerCustom?.[id] ? { custom: record.viewerCustom[id] } : {}),
            })),
            cardMode: box.cardMode,
            stamping: stamping(),
            ...(box.solo ? { solo: true } : {}),
          },
        }
      : {}),
    // D-052: a solo chat nobody from the council has joined yet: who could.
    ...(box && box.solo && !isBox(box as BoxSeat | null) ? { council: (box as BoxSeat).viewers.filter((v) => v.kind === 'council').map(({ id, name, kind, stance }) => ({ id, name, kind, stance, seated: false })) } : {}),
  }
}

/** Our metadata on a message row, whichever of the two shapes the host hands over. */
function houselightsMeta(row: { metadata?: unknown; extra?: Record<string, unknown> }): Record<string, unknown> | null {
  // The host splits `extra.spindle_metadata` out into `metadata` on the way to
  // the worker (worker-host.ts handleChatGetMessages); keep the raw shape too.
  const spindleMeta = (row.metadata ?? row.extra?.spindle_metadata) as { houselights?: unknown } | undefined
  const meta = spindleMeta?.houselights
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : null
}

const TAIL_TEXT_MAX = 400
const leanMessages = (): boolean => Number(spindle.host?.capabilities?.['chat-lean-messages-v1'] ?? 0) >= 1

/** The last `limit` messages of a chat, classified for the Pane's tail. */
async function chatTail(chatId: string, limit: number, userId: string, characterName: string | null = null, primaryCharacterId: string | null = null): Promise<TailEntry[]> {
  type Row = {
    id: string
    is_user?: boolean
    name?: string
    content?: string
    role?: string
    send_date?: number
    created_at?: number
    hidden?: boolean
    metadata?: unknown
    extra?: Record<string, unknown>
  }
  void userId // `chat.getMessages` is chat-scoped; the chat was already resolved for this user.
  let rows: Row[]
  if (leanMessages()) {
    rows = (await spindle.chat.getMessages(chatId, { tail: limit, light: true, ownMetadataOnly: true })) as unknown as Row[]
  } else {
    const all = (await spindle.chat.getMessages(chatId)) as unknown as Row[]
    rows = all.slice(-limit)
  }
  // Messages we append carry the host's generic names ("User", "Assistant").
  // Show the persona's name (from the user's own messages in the same tail)
  // and the character's instead.
  const personaName = [...rows].reverse().find((m) => m.is_user && m.name && !/^(user|you)$/i.test(m.name) && !houselightsMeta(m))?.name ?? null
  const displayName = (m: Row): string => {
    const raw = (m.name ?? '').trim()
    if (m.is_user) return raw && !/^user$/i.test(raw) ? raw : personaName ?? 'You'
    if (!raw || /^assistant$/i.test(raw)) return characterName ?? raw
    return raw
  }
  return rows.map((m) => {
    const meta = houselightsMeta(m)
    const text = (m.content ?? '').trim()
    const hidden = m.hidden === true || m.extra?.hidden === true
    // send_date is seconds in the host's store (MacroEnv multiplies by 1000); created_at is ms.
    const at = typeof m.send_date === 'number' && m.send_date > 0 ? (m.send_date < 1e12 ? m.send_date * 1000 : m.send_date) : (m.created_at ?? Date.now())
    let kind: TailEntry['kind'] = m.is_user ? 'user' : m.role === 'system' ? 'system' : 'character'
    let beat: TailEntry['beat']
    // Who spoke: a box line's speaker, a real member reply's stamp, else the chat's character.
    let speaker: string | null = null
    let speakerId: string | null | undefined = typeof m.extra?.character_id === 'string' ? (m.extra.character_id as string) : undefined
    let speakerAvatar: string | null | undefined
    let shownText = text
    if (meta?.beat === true) {
      kind = 'beat'
      const scene =
        typeof meta.scene === 'string'
          ? meta.scene
          : // Beats written before the scene rode on the metadata: it's the text after the lead.
            (/\]\s[^:]+:\s([\s\S]+)$/.exec(text)?.[1] ?? null)
      beat = { source: typeof meta.source === 'string' ? meta.source : undefined, scene, ...(meta.hushed === true ? { hushed: true, ...(meta.quiet === 'conversation' ? { quiet: 'conversation' as const } : {}) } : {}) }
    } else if (meta?.reaction === true) {
      kind = 'reaction'
      if (meta.box === true && typeof meta.speaker === 'string') {
        speaker = meta.speaker
        speakerId = typeof meta.speakerId === 'string' ? meta.speakerId : null
        speakerAvatar = typeof meta.speakerAvatar === 'string' ? meta.speakerAvatar : undefined
        // The prefix stays in the chat (D13′); the tail shows the name once, as the row's name.
        const prefix = new RegExp(`^\\W{0,3}${speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\W{0,3}\\s*[:：—-]\\s*`, 'i')
        shownText = text.replace(prefix, '')
      }
    }
    if (speakerId === undefined && !m.is_user && kind !== 'beat' && kind !== 'system') speakerId = primaryCharacterId
    return {
      id: m.id,
      kind,
      ...(meta?.lookedUp === true ? { lookedUp: true } : {}),
      ...(meta?.hushTold === 'hush' || meta?.hushTold === 'quiet' ? { hushTold: meta.hushTold } : {}),
      name: speaker ?? displayName(m),
      text: shownText.length > TAIL_TEXT_MAX ? `${shownText.slice(0, TAIL_TEXT_MAX - 1)}…` : shownText,
      at,
      hidden,
      ...(beat ? { beat } : {}),
      ...(speakerId !== undefined ? { characterId: speakerId } : {}),
      ...(speakerAvatar ? { avatarUrl: speakerAvatar } : {}),
    }
  })
}

/** Pin a chat (D5) or clear the pin. Pinning switches the chat on: pinning is consent. */
async function pinChat(chatId: string | null, userId: string): Promise<void> {
  const config = await loadConfig(userId)
  await saveConfig({ ...config, pinnedChatId: chatId }, userId)
  unseenReactions.delete(userId)
  if (chatId) await setChatEnabled(chatId, true, userId)
}

/** The user's chats for the pin picker: most recently touched first, capped. */
async function listChats(userId: string): Promise<Array<{ id: string; name: string; characterId: string | null; characterName: string | null; updatedAt: number }>> {
  const { data } = await spindle.chats.list({ limit: 60, userId })
  const rows = [...data].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
  return Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      name: c.name,
      characterId: c.character_id ?? null,
      characterName: await characterName(c.character_id, userId),
      updatedAt: c.updated_at ?? 0,
    })),
  )
}

spindle.on('CHAT_SWITCHED', async (payload: unknown, userId?: string) => {
  if (!userId) return
  try {
    // Coming back to the pinned chat is "seeing" what landed there.
    const chatId = (payload as { chatId?: string | null } | null)?.chatId ?? null
    if (chatId && chatId === (await loadConfig(userId)).pinnedChatId) unseenReactions.delete(userId)
    spindle.sendToFrontend(await chatState(userId), userId)
  } catch (err) {
    spindle.log.warn(`chat_state after switch failed: ${err instanceof Error ? err.message : String(err)}`)
  }
})

// ---------------------------------------------------------------------------
// Hush — letting you get a word in (D-015, untouched by the pivot)
// ---------------------------------------------------------------------------

export type HushSource = 'button' | 'conversation' | null

export interface HushState {
  hushed: boolean
  source: HushSource
  remainingMs: number
  /** True while a real generation is streaming — never overridable. */
  busy: boolean
}

function hushState(userId: string): HushState {
  const now = Date.now()
  const manual = (hushUntil.get(userId) ?? 0) - now
  const conversation = (conversationUntil.get(userId) ?? 0) - now
  const busy = isGenerationBusy(userId)

  if (manual > 0) return { hushed: true, source: 'button', remainingMs: manual, busy }
  if (conversation > 0) {
    return { hushed: true, source: 'conversation', remainingMs: conversation, busy }
  }
  return { hushed: false, source: null, remainingMs: 0, busy }
}

function pushHushState(userId: string): void {
  spindle.sendToFrontend({ type: 'hush_state', ...hushState(userId) }, userId)
}

async function touchConversation(userId: string): Promise<void> {
  if (roastInFlight.has(userId)) return // Our own doing — not a conversation.
  const config = await loadConfig(userId)
  if (config.conversationGraceSeconds <= 0) return
  conversationUntil.set(userId, Date.now() + config.conversationGraceSeconds * 1000)
  pushHushState(userId)
}

/**
 * Our own appends come back to us as MESSAGE_SENT — often *after* the
 * reaction's `finally` has run, so `roastInFlight` alone can't tell them
 * apart. Remember what we just did.
 */
const ownMessageIds = new Set<string>()
const ownActivityUntil = new Map<string, number>()
const OWN_ACTIVITY_GRACE_MS = 2500
function markOwn(userId: string, messageId?: string): void {
  if (messageId) {
    ownMessageIds.add(messageId)
    setTimeout(() => ownMessageIds.delete(messageId), 30_000)
  }
  ownActivityUntil.set(userId, Date.now() + OWN_ACTIVITY_GRACE_MS)
}
function isOwnActivity(userId: string, payload?: unknown): boolean {
  if ((ownActivityUntil.get(userId) ?? 0) > Date.now()) return true
  const message = (payload as { message?: { id?: string; metadata?: unknown; extra?: Record<string, unknown> } } | null)?.message
  if (!message) return false
  if (message.id && ownMessageIds.has(message.id)) return true
  return houselightsMeta(message) !== null
}

spindle.on('MESSAGE_SENT', async (payload: unknown, userId?: string) => {
  if (!userId) return
  if (isOwnActivity(userId, payload)) return // A beat, a reply or a talk line of ours is not the user talking.
  // D-071: only the user's own lines. A new chat's greeting is a MESSAGE_SENT
  // too (the host appends it), and it started a "you're talking" quiet on every
  // new chat. The character's real replies are covered by GENERATION_ENDED.
  const isUser = (payload as { message?: { is_user?: unknown } } | null)?.message?.is_user
  if (isUser === false) return
  await touchConversation(userId)
})

function generationIdOf(payload: unknown): string {
  const id = (payload as { generationId?: unknown } | null)?.generationId
  return typeof id === 'string' && id ? id : 'unknown'
}

spindle.on('GENERATION_STARTED', (payload: unknown, userId?: string) => {
  if (!userId) return
  const gens = generationBusy.get(userId) ?? new Map<string, number>()
  gens.set(generationIdOf(payload), Date.now())
  generationBusy.set(userId, gens)
  pushHushState(userId)
})

for (const event of ['GENERATION_ENDED', 'GENERATION_STOPPED'] as const) {
  spindle.on(event, async (payload: unknown, userId?: string) => {
    if (!userId) return
    const gens = generationBusy.get(userId)
    if (gens) {
      const id = generationIdOf(payload)
      // An end we never saw start: the user's generation is over either way.
      if (!gens.delete(id)) gens.clear()
      if (gens.size === 0) generationBusy.delete(userId)
      pushHushState(userId)
    }
    await touchConversation(userId)
  })
}

// ---------------------------------------------------------------------------
// Reaction history — what stops it telling the same joke six times (D-014)
// ---------------------------------------------------------------------------

interface PastRoast {
  text: string
  /** The scene it was about, so near-identical moments can be spotted. */
  scene: string
  at: number
}

async function loadRoasts(userId?: string): Promise<PastRoast[]> {
  const stored = await spindle.userStorage.getJson<PastRoast[]>(ROASTS_PATH, {
    fallback: [],
    userId,
  })
  return Array.isArray(stored) ? stored : []
}

async function rememberRoast(entry: PastRoast, keep: number, userId?: string): Promise<void> {
  const history = await loadRoasts(userId)
  history.push(entry)
  await spindle.userStorage.setJson(ROASTS_PATH, history.slice(-Math.max(1, keep)), { userId })
}

// ---------------------------------------------------------------------------
// Calling a model — one place for the timeout, the reasoning policy and the
// "it came back empty" diagnosis
// ---------------------------------------------------------------------------

/**
 * Connections that think even when told not to.
 *
 * We send `reasoning: { source: 'off' }` on every call. Lumiverse turns that
 * into a provider-specific "thinking disabled" parameter only for providers
 * it knows the switch for (DeepSeek, Anthropic, Z.ai, Moonshot, Bedrock,
 * NanoGPT); for a generic OpenAI-compatible or OpenRouter-style connection it
 * can only strip the reasoning parameters, and a model that thinks by default
 * (DeepSeek V4, for one) keeps thinking. With Max tokens at 300 the thinking
 * eats the whole budget and the reply is empty.
 *
 * So: when a reply comes back empty *with* reasoning attached, retry once with
 * room for the thinking, and remember that this connection needs it. A later
 * reply with no reasoning at all (the user fixed the connection, or switched
 * models) forgets it again. Keyed by connection id; '' is the active one.
 */
const thinksAnyway = new Map<string, number>()

/**
 * Which provider a connection is, so "don't think" can be said in its words
 * (`noThinkingOverride`). Null connection id means the user's default
 * connection. Cached briefly: connections rarely change, but a user editing
 * one shouldn't have to reload the extension.
 */
const providerCache = new Map<string, { provider: string | null; at: number }>()
const PROVIDER_CACHE_MS = 60_000

async function providerOf(connectionId: string | undefined, userId: string | undefined): Promise<string | null> {
  const key = connectionId ?? ''
  const hit = providerCache.get(key)
  if (hit && Date.now() - hit.at < PROVIDER_CACHE_MS) return hit.provider
  let provider: string | null = null
  try {
    if (connectionId) {
      provider = (await spindle.connections.get(connectionId, userId))?.provider ?? null
    } else {
      provider = (await spindle.connections.list(userId)).find((c) => c.is_default)?.provider ?? null
    }
  } catch {
    provider = null // Unknown provider → generic "off"; the headroom path still covers it.
  }
  providerCache.set(key, { provider, at: Date.now() })
  return provider
}

async function quietOnce(
  config: HouselightsConfig,
  request: GenerationRequestDTO,
  what: 'vision model' | 'model',
): Promise<Partial<GenerationResponseDTO> | undefined> {
  const controller = new AbortController()
  const timeoutMs = Math.max(5, config.generationTimeoutSeconds) * 1000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const full: GenerationRequestDTO = {
    ...request,
    signal: controller.signal,
    ...(config.allowReasoning
      ? {}
      : { reasoning: noThinkingOverride(await providerOf(request.connection_id, request.userId)) }),
  }
  try {
    return (await spindle.generate.quiet(full)) as Partial<GenerationResponseDTO> | undefined
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`The ${what} took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. Give up after, on the Models card, sets the limit.`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function callModel(
  config: HouselightsConfig,
  request: GenerationRequestDTO,
  what: 'vision model' | 'model',
): Promise<string> {
  const key = request.connection_id ?? ''
  const remembered = thinksAnyway.get(key) ?? 0
  let headroom = remembered
  let result = await quietOnce(config, withHeadroom(request, headroom), what)
  let content = typeof result?.content === 'string' ? result.content.trim() : ''
  let thought = reasoningLength(result)

  if (!content && thought > 0 && headroom === 0 && typeof request.parameters?.max_tokens === 'number') {
    // It thought the budget away. Once more, with room.
    headroom = REASONING_HEADROOM
    result = await quietOnce(config, withHeadroom(request, headroom), what)
    content = typeof result?.content === 'string' ? result.content.trim() : ''
    thought = reasoningLength(result)
    if (content) {
      thinksAnyway.set(key, headroom)
      spindle.log.info(
        `The ${what} on this connection thinks even when told not to; giving it ${headroom} extra tokens of room from now on.`,
      )
    }
  } else if (content && thought === 0 && remembered > 0) {
    thinksAnyway.delete(key) // It stopped thinking — back to the plain budget.
  }

  if (content) return content

  // Say *why* it was empty — this is the difference between "the model is
  // broken" and "it spent 300 tokens thinking and had none left to speak".
  const reasons: string[] = []
  if (result?.finish_reason) reasons.push(`finish_reason: ${result.finish_reason}`)
  if (thought > 0) {
    reasons.push(`it returned ${thought > 1 ? `${thought} characters of` : 'some'} reasoning but no reply`)
  }
  const out = result?.usage && typeof result.usage === 'object' ? (result.usage as { completion_tokens?: number }).completion_tokens : undefined
  if (typeof out === 'number') reasons.push(`${out} completion tokens used`)
  let hint = ''
  if (thought > 0 && headroom > 0) {
    hint = ` It was given ${headroom} extra tokens for thinking and still said nothing; this model ignores "thinking off". Pick a light chat model such as Gemma 4 — DeepSeek V4 (Flash included) and reasoning-only models think regardless.`
  } else if (result?.finish_reason === 'length' || thought > 0) {
    hint = ' Raise Max tokens, or keep "Let the models think" off.'
  }
  throw new Error(`The ${what} returned an empty response${reasons.length ? ` (${reasons.join('; ')})` : ''}.${hint}`)
}

// ---------------------------------------------------------------------------
// The vision model (describe mode)
// ---------------------------------------------------------------------------

async function describeFrame(
  config: HouselightsConfig,
  frame: StoredCapture,
  userId?: string,
  /** D-099: the confirmed Watching name, to be checked against this screen. */
  verifyName?: string | null,
  /** D18: ask for the searchable on-screen text too. Only while this chat may look things up. */
  wantLookup = false,
): Promise<SceneReport> {
  const base = wantLookup && webSearchGranted() ? ensureLookupField(ensureAppFields(config.visionPrompt)) : ensureAppFields(config.visionPrompt)
  const request: GenerationRequestDTO = {
    type: 'quiet',
    messages: buildVisionMessages(withMatchesField(base, verifyName), frame.jpegB64),
    parameters: { temperature: 0.2, max_tokens: 200 },
    userId,
  }
  const connectionId = config.visionConnectionId ?? config.connectionId
  if (connectionId) request.connection_id = connectionId
  return parseSceneResponse(await callModel(config, request, 'vision model'))
}

// ---------------------------------------------------------------------------
// The reaction — the whole point of the extension
// ---------------------------------------------------------------------------

interface ReactionInput {
  trigger: ReactionTrigger
  /** A ready-made scene description (the text test button). */
  scene?: string
  /** A frame from the capture tab. */
  frame?: StoredCapture
  /** Talk-back (D14): the user's line. Appended to the chat first, then answered. */
  talk?: string
  /** D-100: an instruction that goes after the stance's own (the curtain call's "one closing line"). */
  closing?: string
}

// ---------------------------------------------------------------------------
// D15 — knowing what's being watched: guess, then confirm
// ---------------------------------------------------------------------------

interface WatchingRecord extends WatchingCore {
  /** A guess awaiting ✓ / edit / ✕. */
  candidate: WatchingState['candidate']
  /** The last candidate the user dismissed; never proposed again this session. */
  dismissed: string | null
  /** A differing guess seen after a shift; proposed only when seen twice in a row. */
  pendingGuess: { text: string; count: number } | null
  /** When the last attach-mode guess call ran, to keep it to one per session (plus shifts). */
  lastGuessAt: number
}
const watching = new Map<string, WatchingRecord>()
const GUESS_CONFIDENCE = 0.5
/** Once the user has confirmed a name, only a confident different reading may reopen the question. */
const REASK_CONFIDENCE = 0.7
const ATTACH_GUESS_MIN_GAP_MS = 10 * 60 * 1000

/**
 * The confirmed name lives in user storage, not only in memory: it must be
 * the same wherever the pipeline reads it, whatever the host does with the
 * worker between a click and a Look. Candidates stay in memory. D-099: so do
 * the name it last was and why it is being asked about again (watching.ts).
 */
async function watchingRecord(userId: string): Promise<WatchingRecord> {
  let w = watching.get(userId)
  if (!w) {
    const stored = await spindle.userStorage.getJson<StoredWatching>(WATCHING_PATH, { fallback: {}, userId })
    w = { ...watchingFrom(stored, cleanName), candidate: null, dismissed: null, pendingGuess: null, lastGuessAt: 0 }
    watching.set(userId, w)
  }
  return w
}
async function saveWatching(userId: string, w: WatchingRecord): Promise<void> {
  await spindle.userStorage.setJson(WATCHING_PATH, storedWatching(w), { userId })
}
async function setConfirmedWatching(userId: string, text: unknown, why: string): Promise<void> {
  const w = await watchingRecord(userId)
  confirmWatching(w, cleanName(text), liveWindow.get(userId) !== undefined)
  w.candidate = null
  await saveWatching(userId, w)
  spindle.log.info(`watching: confirmed=${JSON.stringify(w.confirmed)} (${why})${w.noLimit > 2 ? `; the screen must say no ${w.noLimit} times in a row to ask again` : ''}`)
}
async function watchingState(userId: string): Promise<WatchingState> {
  const w = await watchingRecord(userId)
  return { type: 'watching_state', confirmed: w.confirmed, candidate: w.candidate, lastConfirmed: w.lastConfirmed, doubt: w.doubt }
}
async function pushWatching(userId: string): Promise<void> {
  spindle.sendToFrontend(await watchingState(userId), userId)
}
/** D-099 rule 1: the name belongs to a session. Called when one starts or ends. */
async function watchingSession(userId: string, live: boolean): Promise<void> {
  const w = await watchingRecord(userId)
  const before = w.confirmed
  if (live) {
    const outcome = sessionStarted(w)
    w.dismissed = null
    w.pendingGuess = null
    if (outcome === 'expired') spindle.log.info(`watching: session started; "${before}" is from an earlier session, so it is not used until confirmed ("Still ${before}?")`)
    else if (outcome === 'kept') spindle.log.info(`watching: session started; "${before}" was confirmed since the last session ended and is used`)
    else if (outcome === 'asking') spindle.log.info(`watching: session started; asking "Still ${w.lastConfirmed}?", nothing is used until answered`)
    else spindle.log.info('watching: session started; no name')
  } else if (sessionEnded(w)) {
    spindle.log.info(`watching: session ended; "${before}" is kept as the last name and no longer used`)
  } else {
    return
  }
  await saveWatching(userId, w)
  await pushWatching(userId)
}
/** D-099 rule 2: what the vision model said about the confirmed name and this screen. */
async function watchingScreenCheck(userId: string, report: SceneReport): Promise<void> {
  const w = await watchingRecord(userId)
  const name = w.confirmed
  if (!name) return
  const { counted, doubted } = screenCheck(w, report.matches, report.kind)
  if (!counted) {
    spindle.log.info(`watching: screen check for "${name}" got no answer (matches=${JSON.stringify(report.matches)})`)
    return
  }
  const taken = counted !== report.matches ? ` (said ${report.matches} on a ${report.kind} screen, taken as ${counted})` : ''
  if (doubted) {
    spindle.log.info(`watching: screen check for "${name}": no${taken}, ${w.noLimit} in a row; in doubt, not used until confirmed ("Still ${name}?")`)
    await saveWatching(userId, w)
    await pushWatching(userId)
  } else {
    spindle.log.info(`watching: screen check for "${name}": ${counted}${taken}${counted === 'no' ? ` (${w.noCount} of ${w.noLimit})` : ''}`)
  }
}
function cleanName(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const clean = text.replace(/[{}\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return clean || null
}
/**
 * Offer a guess through the chip. Rules (addendum §4): never per frame — only
 * when nothing is confirmed yet, or after a large shift; never the same text
 * as what's confirmed or what was dismissed; one candidate at a time.
 */
async function proposeWatching(userId: string, text: string | null, source: 'label' | 'vision', confidence: number, shift = false): Promise<void> {
  const w = await watchingRecord(userId)
  const name = cleanName(text)
  if (!name || confidence < GUESS_CONFIDENCE) return
  if (sameGame(name, w.confirmed) || sameGame(name, w.dismissed)) {
    w.pendingGuess = null
    return
  }
  // D-099: the chip is already asking "Still <name>?" about this very name.
  if (!w.confirmed && sameGame(name, w.lastConfirmed)) return
  if (w.candidate && !(source === 'label' && w.candidate.source === 'vision')) return // One at a time; a title beats a guess.
  if (w.confirmed) {
    // Something is confirmed: re-ask only after a shift, only on a confident
    // reading, and only when the same different name has been read twice in
    // a row. One odd frame in a fast game must not reopen the question.
    if (!shift || source !== 'vision') return
    if (confidence < REASK_CONFIDENCE) {
      spindle.log.info(`watching: "${name}" differs from "${w.confirmed}" after a shift, but confidence ${confidence} is under ${REASK_CONFIDENCE}; ignored`)
      return
    }
    if (w.pendingGuess && sameGame(w.pendingGuess.text, name)) w.pendingGuess.count += 1
    else w.pendingGuess = { text: name, count: 1 }
    if (w.pendingGuess.count < 2) {
      spindle.log.info(`watching: "${name}" differs from "${w.confirmed}" after a shift; waiting for a second sighting`)
      return
    }
    w.pendingGuess = null
  }
  w.candidate = { text: name, source, confidence }
  await pushWatching(userId)
}

/** Box Seat: whose turn it is to open, per chat (an index into the viewer list; random start per session). */
const boxOpener = new Map<string, number>()
/** Per chat: when each viewer last spoke, so the seats after the opener go to whoever has waited longest. */
const boxLastSpoke = new Map<string, Map<string, number>>()

/** What the last capture was seen as, so a plain Talk needn't look again. */
const lastScene = new Map<string, { scene: string | null; captureReceivedAt: number | null }>()

type Outcome =
  | { ok: true; text: string; scene: string | null; chatId: string; interest?: number; kind?: string; app?: string | null; appConfidence?: number; watching?: string | null; messageId?: string; lookedUp?: { query: string; fresh: boolean }; hushTold?: HushTold; lines?: BoxLine[]; boxOrder?: string[]; speakOnly?: string | null }
  | { ok: false; reason: ReactionSkipReason; detail?: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Gates, vision, assembly, generation, append — in that order. Manual triggers
 * (`look`, `manual`) skip the pacing gates: the click is the salience
 * judgment. Continuous ticks go through all of them.
 */
/**
 * Tell the frontend what the reaction is doing now. A Box Seat Look is one
 * generation per seat; without this the widget sat silent for the whole chain
 * and a second press looked necessary.
 */
function sendProgress(userId: string, progress: Omit<ReactionProgress, 'type'>): void {
  try {
    void spindle.sendToFrontend({ type: 'reaction_progress', ...progress }, userId)
  } catch {
    // Progress is a courtesy; the result still arrives.
  }
}

async function react(input: ReactionInput, userId: string): Promise<Outcome> {
  const outcome = await reactInner(input, userId)
  // D-100: a session that drew a reaction has earned its curtain call.
  if (outcome.ok && input.trigger !== 'curtain-call' && input.trigger !== 'manual') {
    const log = sessionLogs.get(userId)
    if (log) log.reactions += 1
  }
  // A Look the user pressed, or a line they sent, that produced nothing is
  // worth a line in the log: it is what "it silently didn't react" looks like.
  if (!outcome.ok && input.trigger !== 'tick') {
    const why = 'reason' in outcome ? `${outcome.reason}${outcome.detail ? ' ' + JSON.stringify(outcome.detail) : ''}` : outcome.error
    spindle.log.info(`${input.trigger}: held back — ${why}`)
  }
  return outcome
}

// ---------------------------------------------------------------------------
// Look things up (D18): the Coach's web search
// ---------------------------------------------------------------------------

/** Per user, for this session: what was last searched and what came back. */
const lookups = new Map<string, LookupMemory & { query: string; results: LookupResult[] }>()

function webSearchGranted(): boolean {
  try {
    return spindle.permissions.has('web_search')
  } catch {
    return false
  }
}

/**
 * The notes a chat with Look things up on gets, or null (the caller checks the chat's switch;
 * D18″: any stance). Searches only with the confirmed name and
 * words from the scene description; once per scene change; reuses otherwise.
 * A failed search is remembered like a successful one, so a broken provider is
 * not retried on every Look.
 */
async function lookUp(userId: string, name: string | null, lookup: string | null | undefined): Promise<{ query: string; fresh: boolean; results: LookupResult[] } | null> {
  if (!name) return null
  if (!webSearchGranted()) return null
  const terms = lookupTerms(lookup, name)
  const now = Date.now()
  const prev = lookups.get(userId) ?? null
  const reuse = () => (prev && prev.results.length > 0 && prev.name.trim().toLowerCase() === name.trim().toLowerCase() ? { query: prev.query, fresh: false, results: prev.results } : null)
  // Nothing searchable on screen: no search. Notes from the same game still stand.
  if (terms.length === 0) return reuse()
  if (!shouldSearch(prev, name, terms, now)) return reuse()
  const query = buildQuery(name, terms)
  let results: LookupResult[] = []
  let failed: string | null = null
  try {
    // The pages themselves, not just the snippets: a two-line snippet about a
    // mission's title misled the Coach (D-043, second read-back). The host
    // fetches up to its own page limit and clips each page.
    sendProgress(userId, { phase: 'searching' })
    const response = await spindle.webSearch.query({ query, count: LOOKUP_RESULT_COUNT, scrape: true, userId })
    const docs = response.documents ?? []
    results = (response.results ?? []).slice(0, LOOKUP_RESULT_COUNT).map((r) => {
      const doc = docs.find((d) => d.url === r.url && !d.error && d.content)
      const passage = doc?.content ? passageFrom(doc.content, terms) : ''
      return { title: r.title ?? '', snippet: r.snippet ?? '', ...(passage ? { passage } : {}) }
    })
    const fetched = results.filter((r) => r.passage).length
    spindle.log.info(`lookup: searched "${query}" → ${results.length} result${results.length === 1 ? '' : 's'}, ${fetched} page${fetched === 1 ? '' : 's'} read`)
  } catch (err) {
    failed = err instanceof Error ? err.message : String(err)
    spindle.log.warn(`lookup: search for "${query}" failed: ${failed}`)
  }
  lookups.set(userId, { name, terms, at: now, query, results })
  lastLookup.set(userId, { query, count: results.length, pages: results.filter((r) => r.passage).length, notes: noteRows(results), at: now, ...(failed ? { error: failed } : {}) })
  spindle.sendToFrontend({ ...(await lookupStatus(userId)) }, userId)
  return results.length > 0 ? { query, fresh: true, results } : null
}

/** The last search, for the tab: what was asked and how much came back. */
const lastLookup = new Map<string, NonNullable<LookupStatus['last']>>()

async function lookupStatus(userId: string): Promise<LookupStatus> {
  const granted = webSearchGranted()
  let enabled: boolean | null = null
  if (granted) {
    try {
      enabled = (await spindle.webSearch.getSettings(userId)).enabled === true
    } catch (err) {
      spindle.log.warn(`lookup: could not read web search settings: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const last = lastLookup.get(userId)
  return { type: 'lookup_status', granted, enabled, ...(last ? { last } : {}) }
}

async function reactInner(input: ReactionInput, userId: string): Promise<Outcome> {
  const config = await loadConfig(userId)
  const automatic = input.trigger === 'tick'

  const { chat, mode, active } = await watchedChat(userId)
  if (!chat) return { ok: false, reason: 'no-chat' }

  // The per-chat switch. The text test button bypasses it: it's explicit.
  if (input.trigger !== 'manual' && !(await isChatEnabled(chat.id, userId))) {
    return { ok: false, reason: 'chat-off', detail: { chatId: chat.id, chatName: chat.name } }
  }

  // Absolute: never land inside someone else's turn.
  if (isGenerationBusy(userId)) return { ok: false, reason: 'busy' }

  if (reacting.has(userId)) return { ok: false, reason: 'already-reacting' }
  reacting.add(userId)
  // Talk-back: everything we append from here is our doing, not a conversation
  // to go quiet for (`touchConversation` checks this set).
  if (input.talk) roastInFlight.add(userId)
  try {
    // --- what was seen -------------------------------------------------------
    let scene: string | null = null
    let report: SceneReport | null = null
    if (typeof input.scene === 'string' && input.scene.trim()) {
      scene = input.scene.trim()
    } else if (input.frame && config.visionMode === 'describe') {
      sendProgress(userId, { phase: 'seeing' })
      // D-099: with a confirmed name and the screen in front of it, the same call checks the name.
      const verifyName = watchesScreen(input.frame.source) ? (await watchingRecord(userId)).confirmed : null
      // D18″: this chat's own switch (or, never asked, the old shared one) decides whether to read search words off the screen.
      const lookRec = await chatRecord(chat.id, userId)
      report = await describeFrame(config, input.frame, userId, verifyName, lookRec.lookUp ?? config.coachSearch)
      scene = report.text
    } else if (!input.frame) {
      return { ok: false, error: input.talk ? 'Nothing seen yet — press Look first, or use Send + look.' : 'Nothing to react to — no frame and no description.' }
    }
    lastScene.set(userId, { scene, captureReceivedAt: input.frame?.receivedAt ?? null })

    // D15 layer 2: the vision guess. Describe mode has it for free; attach mode
    // pays one describe call when a guess is wanted (nothing known, or a shift).
    // D-078: only from the screen. A photo or a picture is not the game, and its
    // "app" (a Reddit post, a phone's camera) must not propose a new name.
    const watchRec = await watchingRecord(userId)
    const fromScreen = watchesScreen(input.frame?.source ?? 'text')
    if (!fromScreen) {
      // nothing to propose
    } else if (report) {
      await watchingScreenCheck(userId, report)
      spindle.log.info(`watching: vision says app=${JSON.stringify(report.app)} confidence=${report.appConfidence} (confirmed=${JSON.stringify(watchRec.confirmed)}, candidate=${JSON.stringify(watchRec.candidate?.text ?? null)})`)
      await proposeWatching(userId, report.app, 'vision', report.appConfidence, input.frame?.shift === true)
    } else if (input.frame && config.visionMode === 'attach') {
      const w = watchRec
      const wanted = (!w.confirmed && !w.candidate && Date.now() - w.lastGuessAt > ATTACH_GUESS_MIN_GAP_MS) || input.frame.shift === true
      if (wanted) {
        w.lastGuessAt = Date.now()
        try {
          const guess = await describeFrame(config, input.frame, userId)
          await proposeWatching(userId, guess.app, 'vision', guess.appConfidence, input.frame.shift === true)
        } catch (err) {
          spindle.log.warn(`watching guess failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    // D-100: the running session remembers its interesting moments for the curtain call. A Look the
    // user pressed always counts; one on the timer counts when it clears the pacing bar.
    const sessionLog = sessionLogs.get(userId)
    if (sessionLog && report && input.frame?.source === 'screen' && (!automatic || report.interest >= config.salienceBar)) {
      const time = input.frame.localTime?.trim() || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      noteMoment(sessionLog, { time, scene: report.text, interest: report.interest, pressed: !automatic }, (a, b) => sceneSimilarity(a, b) >= SAME_MOMENT_SIMILARITY)
    }

    // --- pacing gates, automatic only ------------------------------------------
    if (automatic) {
      if (report) {
        if (config.skipKinds.includes(report.kind)) {
          // D-101: interest beats kind. A death or victory screen can look like a menu.
          if (report.interest < config.kindBreakInterest) {
            return { ok: false, reason: 'kind', detail: { kind: report.kind, interest: report.interest } }
          }
          spindle.log.info(`pacing: kind ${report.kind} is skipped, let through at interest ${report.interest} (big moments get through at ${config.kindBreakInterest})`)
        }
        if (report.interest < config.salienceBar) {
          return { ok: false, reason: 'boring', detail: { interest: report.interest, bar: config.salienceBar } }
        }
        const history = await loadRoasts(userId)
        const previous = history[history.length - 1]
        if (previous && sceneSimilarity(previous.scene, report.text) >= SAME_MOMENT_SIMILARITY) {
          return { ok: false, reason: 'repeat' }
        }
      }

      const hush = hushState(userId)
      const overrides = report !== null && report.interest >= config.overrideInterest
      if (hush.hushed && !overrides) {
        // H3: hushed, not blind. The moment still goes into the chat as a hidden beat,
        // so the first reaction after the hush knows what happened meanwhile.
        const kept = await keepWatchingHushed({ input, userId, config, chat, scene, report, watchingName: watchesScreen(input.frame?.source ?? 'text') ? (await watchingRecord(userId)).confirmed : null, quiet: hush.source === 'button' ? 'button' : 'conversation' })
        return { ok: false, reason: 'hush', detail: { source: hush.source, waitMs: hush.remainingMs, ...(kept ? { kept: true } : {}) } }
      }

      const waitMs = config.cooldownSeconds * 1000 - (Date.now() - (lastRoastAt.get(userId) ?? 0))
      if (waitMs > 0) return { ok: false, reason: 'cooldown', detail: { waitMs } }
    }

    // Claim the cooldown slot before generating: generation takes seconds, and
    // a burst of ticks must not all pass the gate together.
    const previousRoastAt = lastRoastAt.get(userId) ?? 0
    lastRoastAt.set(userId, Date.now())

    // --- assembly ------------------------------------------------------------------
    const recent = (await loadRoasts(userId)).slice(-config.roastMemory).map((r) => r.text)
    const source = input.frame?.source ?? 'text'
    // D-078: the confirmed name is about the screen. A webcam shot, a phone photo or a
    // picture is told nothing about it — no "in Palworld" lead, no context block, no search.
    const watchingName = watchesScreen(source) ? (await watchingRecord(userId)).confirmed : null
    const chatRec = await chatRecord(chat.id, userId)
    const templates = { heckler: config.roastInstruction, coach: config.coachInstruction, character: config.characterInstruction }
    const pinnedElsewhere = mode === 'pinned' && active?.id !== chat.id

    // D-067: the first reaction after a hush hears what was seen during it.
    // (Not on a curtain call: "bring one of these up" and "one closing line" pull apart.)
    const recap = scene && input.trigger !== 'curtain-call' ? hushRecapText(hushedSeen.get(userId)) : ''
    // D-069: `{{hushed}}` — the stance can be told the hush itself, not just what it saw.
    const hushed = hushedNote(hushedMomentFor(userId, input.trigger))
    // D-071: what this prompt said about a hush or a quiet, for the tail's mark —
    // so "why did it mention a hush?" can be answered from the screen.
    const recapKind: HushTold | null = !recap ? null : (hushedSeen.get(userId) ?? []).some((x) => x.quiet !== 'conversation') ? 'hush' : 'quiet'
    const toldOf = (instruction: string, withRecap: boolean): HushTold | null =>
      input.trigger === 'after-hush' || (hushed && usesHushed(instruction)) ? 'hush' : withRecap ? recapKind : null

    // Box Seat (D13″): a group chat is a box — one seat at a time, in order.
    const box = await boxOf(chat, chatRec, config, userId)
    if (isBox(box)) {
      const boxed = await reactBox({ input, userId, config, chat, box, scene, report, source, watchingName, recent, templates, previousRoastAt, pinnedElsewhere, recap, hushed, toldOf, looksUp: (s) => chatLooksUp(chatRec.lookUp, config.coachSearch, s) })
      if (boxed.ok) {
        hushedSeen.delete(userId) // said once
        hushJustEnded.delete(userId)
      }
      return boxed
    }

    // D17: the stance picks the instruction; the base block is the same for all.
    const stance: Stance = chatRec.stance ?? DEFAULT_STANCE
    const instruction = stanceInstruction(stance, templates, chatRec.custom ?? '')
    const hushTold = toldOf(instruction, true)
    // D15: the confirmed name goes in twice — a session-context block up top and
    // a lead on the beat itself, where the model is actually looking.
    const beatText =
      (watchingName ? watchingLead(watchingName) : '') +
      substituteScene(instruction, scene ? sceneWithWatching(scene, watchingName) + recap : ATTACHED_SCENE_PLACEHOLDER, seenViaPhrase(source), hushed) +
      (input.closing ?? '')
    // D18, D18″: with Look things up on in this chat, any stance may have looked something up — confirmed name + scene words only.
    const looked = chatLooksUp(chatRec.lookUp, config.coachSearch, stance) ? await lookUp(userId, watchingName, report?.lookup) : null
    const reference = looked ? referenceText(looked.results, { name: watchingName ?? '', onScreen: report?.lookup, coach: stance === 'coach' }) : ''
    const blocks = buildBlockGraph({
      systemPrompt: config.systemPrompt,
      selfRecognition: config.selfRecognition,
      beat: beatText,
      recentReactions: recent,
      ...(input.talk ? { talk: config.talkInstruction } : {}),
      // D15 layer 3: only the confirmed text, never a raw title or a guess.
      ...(watchingName ? { sessionContext: watchingName } : {}),
      ...(reference ? { reference } : {}),
    })
    const lookedUp = looked && reference ? { query: looked.query, fresh: looked.fresh } : null
    if (watchingName) spindle.log.info(`watching: prompt carries "${watchingName}" (context block + beat lead)`)
    spindle.log.info(`stance: ${stance}${input.talk ? ' + talk' : ''}`)

    // Talk-back (D14): the user's line goes into the chat first, as a normal
    // user message, so `assemble` sees it as the last turn of the history.
    if (input.talk) await appendTalkLine(chat.id, input.talk, userId)

    const messages = await assembleFor(chat, blocks, config, input, userId)
    if (!messages) {
      lastRoastAt.set(userId, previousRoastAt)
      return { ok: false, error: 'Could not attach the picture: the hidden note was missing from the prompt. Please report this.' }
    }
    const request = generationRequest(config, messages, userId)

    roastInFlight.add(userId)
    let text: string
    let replyRow: { id: string } | null = null
    try {
      let raw: string
      try {
        sendProgress(userId, { phase: 'writing', name: (await characterName(chat.character_id, userId)) ?? undefined })
        raw = await callModel(config, request, 'model')
      } catch (err) {
        lastRoastAt.set(userId, previousRoastAt)
        throw err
      }

      // Writing took a few seconds. If a real generation started meanwhile,
      // appending now would drop it into the middle of someone else's turn.
      markOwn(userId) // The appends below echo back as MESSAGE_SENT, often late.
      if (isGenerationBusy(userId)) {
        lastRoastAt.set(userId, previousRoastAt)
        return { ok: false, reason: 'busy', detail: { late: true } }
      }

      const character = await spindle.characters.get(chat.character_id, userId)
      text = stripNameTag(raw, character?.name)

      // --- the beat, hidden (D-017), then the reaction --------------------------------
      const now = Date.now()
      const beat = await appendBeat({ chat, userId, config, input, scene, source, watchingName, report, stance, now })
      replyRow = await spindle.chat.appendMessage(
        chat.id,
        {
          role: 'assistant',
          content: text,
          metadata: { houselights: { reaction: true, at: now, beatMessageId: beat.id, ...(lookedUp ? { lookedUp: true, lookupQuery: lookedUp.query } : {}), ...(hushTold ? { hushTold } : {}) } },
        },
        // Critically: do NOT make the character reply to its own heckling.
        { triggerGeneration: false },
      )
      markOwn(userId, replyRow?.id)
    } finally {
      roastInFlight.delete(userId)
    }

    await rememberRoast({ text, scene: scene ?? '', at: Date.now() }, config.roastMemory, userId)
    hushedSeen.delete(userId) // D-067: said once
    hushJustEnded.delete(userId) // D-069: so is "first thing since"
    if (pinnedElsewhere) unseenReactions.set(userId, (unseenReactions.get(userId) ?? 0) + 1)
    return { ok: true, text, scene, chatId: chat.id, interest: report?.interest, kind: report?.kind, app: report?.app ?? null, appConfidence: report?.appConfidence, watching: watchingName, ...(replyRow?.id ? { messageId: replyRow.id } : {}), ...(lookedUp ? { lookedUp } : {}), ...(hushTold ? { hushTold } : {}) }
  } finally {
    reacting.delete(userId)
    roastInFlight.delete(userId)
  }
}

// ---------------------------------------------------------------------------
// Pieces shared by the solo path and the box chain
// ---------------------------------------------------------------------------

/** Talk-back (D14): the user's line, as a normal user message, before anything is assembled. */
async function appendTalkLine(chatId: string, talk: string, userId: string): Promise<void> {
  const line = await spindle.chat.appendMessage(
    chatId,
    { role: 'user', content: talk, metadata: { houselights: { talk: true, at: Date.now() } } },
    { triggerGeneration: false },
  )
  markOwn(userId, line?.id)
  // D19: the line is in the chat; the window that took it from the chat box can clear the box now.
  spindle.sendToFrontend({ type: 'talk_landed', chatId, text: talk }, userId)
}

/**
 * `assemble`, operator-scoped (`userId` is the second argument), and in attach
 * mode the picture goes onto the beat. Null when the beat could not be found.
 */
async function assembleFor(chat: ChatDTO, blocks: ReturnType<typeof buildBlockGraph>, config: HouselightsConfig, input: ReactionInput, userId: string, seatCall = false): Promise<LlmMessageDTO[] | null> {
  const assembled = await spindle.assemble({ chatId: chat.id, blocks, connectionId: config.connectionId ?? undefined }, userId)
  // The host's trailing additions (findings §6): the empty-send nudge — "[Write
  // the next reply only as <primary>.]" as the very last turn — goes always;
  // the primary's post-history instructions go from a seat's call, which
  // carries the seat's own as a block.
  const { messages, dropped } = stripHostTail(assembled.messages, assembled.breakdown, { dropPostHistory: seatCall })
  if (dropped.length > 0) spindle.log.info(`assemble: removed the host's trailing ${dropped.join(', ')}`)
  if (input.frame && config.visionMode === 'attach') {
    // The resolved beat differs from our template (macros), so match on the
    // part that has no macros in it — the scene placeholder.
    if (!attachImageToBeat(messages, ATTACHED_SCENE_PLACEHOLDER, input.frame.jpegB64)) return null
  }
  return messages
}

function generationRequest(config: HouselightsConfig, messages: LlmMessageDTO[], userId: string): GenerationRequestDTO {
  const request: GenerationRequestDTO = {
    type: 'quiet',
    messages,
    parameters: { temperature: config.temperature, max_tokens: config.maxTokens, top_p: config.topP },
    userId,
  }
  if (config.connectionId) request.connection_id = config.connectionId
  return request
}

/** The hidden beat (D-017): what was seen, with the thumbnail and the audit trail in its metadata. */
/**
 * H3: during a hush an automatic Look that passed the kind, salience and
 * same-moment gates still leaves its hidden beat — no reaction, no speech.
 * At most one per cooldown, and never the same moment twice. Describe mode
 * only: in Attach mode there are no words to keep, just "a screenshot".
 */
async function keepWatchingHushed(p: {
  input: ReactionInput
  userId: string
  config: HouselightsConfig
  chat: ChatDTO
  scene: string | null
  report: SceneReport | null
  watchingName: string | null
  /** D-070: a hush you pressed, or the quiet after you spoke. The recap words them differently. */
  quiet: 'button' | 'conversation'
}): Promise<boolean> {
  const { input, userId, config, chat, scene, report, watchingName, quiet } = p
  if (!report || !scene || !input.frame) return false
  const now = Date.now()
  const last = lastHushedBeat.get(userId)
  if (last && now - last.at < config.cooldownSeconds * 1000) return false
  if (last && sceneSimilarity(last.scene, scene) >= SAME_MOMENT_SIMILARITY) return false
  if (isGenerationBusy(userId)) return false // Never inside someone else's turn, beat or not.
  lastHushedBeat.set(userId, { at: now, scene })
  try {
    const stance = (await chatRecord(chat.id, userId)).stance ?? DEFAULT_STANCE
    await appendBeat({ chat, userId, config, input, scene, source: input.frame.source, watchingName, report, stance, now, hushed: true, quiet })
    const time = input.frame.localTime?.trim() || new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    hushedSeen.set(userId, [...(hushedSeen.get(userId) ?? []), { time, scene, interest: report.interest, quiet }].slice(-HUSH_RECAP_MAX))
    return true
  } catch (err) {
    spindle.log.warn(`hushed beat failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

/** D-068: notice a pressed hush running out by itself. */
function armHushEnd(userId: string, ms: number): void {
  const old = hushEndTimer.get(userId)
  if (old) clearTimeout(old)
  hushEndTimer.set(
    userId,
    setTimeout(() => {
      hushEndTimer.delete(userId)
      if ((hushUntil.get(userId) ?? 0) > Date.now()) return // pressed again since: a later timer has it
      if (!hushUntil.has(userId)) return // already lifted by hand
      hushUntil.delete(userId)
      pushHushState(userId)
      hushEnded(userId)
    }, ms + 250),
  )
}

/**
 * D-069: is a hush part of this moment? Speaking while the button hush is on
 * (an override, or because you asked), or the first thing said after one ended.
 * A conversation hush (you were talking) is not a hush you put on it.
 */
function hushedMomentFor(userId: string, trigger: ReactionInput['trigger']): HushedMoment {
  const hs = hushState(userId)
  if (hs.hushed && hs.source === 'button') return { kind: 'during', asked: trigger !== 'tick' }
  const ended = hushJustEnded.get(userId)
  if (ended && Date.now() - ended.at < HUSH_NOTE_MAX_AGE_MS) return { kind: 'after', minutes: ended.minutes, earlier: trigger === 'after-hush' }
  return null
}

/**
 * D-078: does this source show the screen the Watching name is about? The screen
 * (and the synthetic test frame, and a typed test scene) yes; a webcam shot, a
 * phone photo or a chosen picture no.
 */
function watchesScreen(source: CaptureSource | 'text'): boolean {
  return source === 'screen' || source === 'synthetic' || source === 'text'
}

/** A hush the user pressed has ended (lifted, or ran out). */
function hushEnded(userId: string): void {
  const t = hushEndTimer.get(userId)
  if (t) clearTimeout(t)
  hushEndTimer.delete(userId)
  const now = Date.now()
  const started = hushStartedAt.get(userId)
  hushStartedAt.delete(userId)
  hushJustEnded.set(userId, { at: now, minutes: started ? (now - started) / 60_000 : 0 })
  void commentAfterHush(userId).catch((err) => spindle.log.warn(`after-hush comment failed: ${err instanceof Error ? err.message : String(err)}`))
}

/**
 * D-068: when a hush you pressed ends, the character comments once on the most
 * interesting moment it saw during it (latest wins a tie). Off with
 * `hushEndComment`. The recap (D-067) rides along, so it knows the rest too.
 * The reply goes to the window that is sharing, which reads it aloud.
 */
async function commentAfterHush(userId: string): Promise<void> {
  const config = await loadConfig(userId)
  // D-070: only moments from a hush you pressed — not ones kept while you were talking.
  const seen = hushedSeen.get(userId)?.filter((s) => s.quiet === 'button')
  if (!config.hushEndComment || !seen || seen.length === 0) return
  const pick = seen.reduce((best, s) => (s.interest >= best.interest ? s : best))
  spindle.log.info(`after-hush: commenting on "${pick.scene.slice(0, 80)}" (interest ${pick.interest}, of ${seen.length} seen)`)
  const outcome = await react({ trigger: 'after-hush', scene: `(Earlier, at ${pick.time}, while you were hushed) ${pick.scene}` }, userId)
  const result = { ...outcomeToResult(outcome, 'after-hush'), origin: 'after-hush' as const }
  const live = liveWindow.get(userId)
  if (live && canTargetSessions()) spindle.sendToFrontend(result, userId, { frontendSessionId: live })
  else spindle.sendToFrontend(result, userId)
  if (outcome.ok) spindle.sendToFrontend({ type: 'companion_reaction', result }, userId) // D-063
}

/**
 * D-100: the curtain call. A session ended (Stop, the browser's Stop sharing, or
 * the auto-stop): one closing line about it, through the ordinary pipeline, so
 * the stance, the chat's on/off switch and the Box Seat all apply. Not after a
 * session under two minutes, not after one that saw nothing interesting, and
 * not while hushed. The line goes to the window that was sharing, which reads it aloud.
 */
async function curtainCall(userId: string, log: SessionLog, p: { autoStop: boolean; watching: string | null; window: string }): Promise<void> {
  const config = await loadConfig(userId)
  if (!config.curtainCall) return
  const endedAt = Date.now()
  const minutes = sessionMinutes(log, endedAt)
  const verdict = curtainDue(log, endedAt)
  if (verdict !== 'due') {
    spindle.log.info(`curtain call: none — ${verdict === 'short' ? 'the session ran under two minutes' : 'nothing interesting was seen and nothing was said'}`)
    return
  }
  const hush = hushState(userId)
  if (hush.hushed) {
    spindle.log.info(`curtain call: none — hushed (${hush.source === 'button' ? 'the Hush button' : 'you were talking'}) when the session ended`)
    return
  }
  // A Look still being answered lands first. A new session in the meantime cancels this.
  for (let i = 0; reacting.has(userId) && i < 90; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    if (liveWindow.has(userId)) return
  }
  if (liveWindow.has(userId)) return
  const moments = curtainMoments(log)
  spindle.log.info(`curtain call: ${minutes} min, ${p.autoStop ? 'stopped by itself' : 'stopped'}, ${moments.length} moment${moments.length === 1 ? '' : 's'} of ${log.moments.length} kept, ${log.reactions} reaction${log.reactions === 1 ? '' : 's'}`)
  const outcome = await react(
    { trigger: 'curtain-call', scene: curtainScene({ moments, minutes, autoStop: p.autoStop, watching: p.watching }), closing: curtainClosing(p.autoStop) },
    userId,
  )
  // Held back (the chat's switch is off, a reply is being written): nothing to show for it.
  if (!outcome.ok && 'reason' in outcome) return
  const result = { ...outcomeToResult(outcome, 'curtain-call'), origin: 'curtain-call' as const }
  if (p.window && canTargetSessions()) spindle.sendToFrontend(result, userId, { frontendSessionId: p.window })
  else spindle.sendToFrontend(result, userId)
  if (outcome.ok) spindle.sendToFrontend({ type: 'companion_reaction', result }, userId) // D-063
}

async function appendBeat(p: {
  chat: ChatDTO
  userId: string
  config: HouselightsConfig
  input: ReactionInput
  scene: string | null
  source: CaptureSource | 'text'
  watchingName: string | null
  report: SceneReport | null
  stance: string
  now: number
  /** H3: seen during a hush; nobody said anything about it. */
  hushed?: boolean
  /** D-071: which quiet it was kept in. */
  quiet?: 'button' | 'conversation'
}): Promise<{ id: string }> {
  const { chat, userId, config, input, scene, source, watchingName, report, stance, now, hushed, quiet } = p
  const beat = await spindle.chat.appendMessage(
    chat.id,
    {
      role: 'user',
      content: beatMessageText({ scene, source, width: input.frame?.width, height: input.frame?.height, at: now, localTime: input.frame?.localTime, watching: watchingName, hushed, quiet }),
      metadata: {
        houselights: {
          beat: true,
          at: now,
          trigger: input.trigger,
          source,
          stance,
          ...(hushed ? { hushed: true, ...(quiet ? { quiet } : {}) } : {}),
          ...(scene ? { scene: scene.slice(0, 240) } : {}),
          ...(watchingName ? { watching: watchingName } : {}),
          ...(report?.app ? { app: report.app, appConfidence: report.appConfidence } : {}),
          ...(report ? { interest: report.interest, kind: report.kind } : {}),
          ...(input.frame ? { width: input.frame.width, height: input.frame.height, thumbB64: input.frame.thumbB64 } : {}),
          // The full frame only when asked for — and never as a chat
          // attachment, which would need the `images` permission.
          ...(config.attachFullFrame && input.frame ? { frameB64: input.frame.jpegB64 } : {}),
        },
      },
    },
    { triggerGeneration: false },
  )
  markOwn(userId, beat.id)
  await spindle.chat.setMessageHidden(chat.id, beat.id, true)
  return beat
}

// ---------------------------------------------------------------------------
// The Box Seat chain (D13″): one seat at a time, each stamped as its character
// ---------------------------------------------------------------------------

/** Can `appendMessage` stamp a line with a name and a character (types 0.6.78+)? R7. */
const stamping = (): boolean => Number(spindle.host?.capabilities?.['chat-append-identity-v1'] ?? 0) >= 1

interface BoxReactArgs {
  input: ReactionInput
  userId: string
  config: HouselightsConfig
  chat: ChatDTO
  box: BoxSeat
  scene: string | null
  report: SceneReport | null
  source: CaptureSource | 'text'
  watchingName: string | null
  recent: string[]
  templates: { heckler: string; coach: string; character: string }
  previousRoastAt: number
  pinnedElsewhere: boolean
  /** D-067: what was seen during a hush, for the opener's line. */
  recap?: string
  /** D-069: `{{hushed}}`, for every seat — they were all hushed. */
  hushed?: string
  /** D-071: what a seat's prompt said about a hush, for the tail's mark. */
  toldOf?: (instruction: string, withRecap: boolean) => HushTold | null
  /** D18″: does a viewer of this stance get the looked-up notes in this chat? */
  looksUp?: (stance: Stance) => boolean
}

/**
 * Houselights picks the opener (alternating per chat, random start per
 * session; an @-mentioned viewer in a talk line overrides). Seat 1 is assembled
 * with the beat and a focus block, generated, appended stamped as its
 * character. Seat 2 is assembled again — seat 1's line is now in history —
 * and told to answer it. One call per seat; the second always answers the
 * first, by construction. No script, no parsing, no reordering.
 */
async function reactBox(a: BoxReactArgs): Promise<Outcome> {
  const { input, userId, config, chat, box, scene, report, source, watchingName, recent, templates, previousRoastAt, pinnedElsewhere, recap = '', hushed = '', toldOf = () => null, looksUp = () => false } = a
  // Council members left out of this chat's box are not in it at all.
  const viewers = box.viewers.filter((v) => v.seated !== false)
  const names = viewers.map((v) => v.name)
  const started = boxOpener.get(chat.id)
  const turn = started === undefined ? Math.floor(Math.random() * names.length) : started + 1
  boxOpener.set(chat.id, turn)
  const opener = (input.talk ? mentionedViewer(input.talk, names) : null) ?? names[turn % names.length] ?? box.primaryName
  // D-100: a curtain call is one line, whoever's turn it is.
  const cap = input.trigger !== 'curtain-call' && config.boxRebuttal ? Math.min(4, Math.max(1, Math.round(config.boxLines))) : 1
  const spoke = boxLastSpoke.get(chat.id) ?? new Map<string, number>()
  boxLastSpoke.set(chat.id, spoke)
  const order = seatOrder(names, opener, cap, spoke)
  const promptViewers: BoxViewer[] = viewers.map((v) => ({ name: v.name, stance: v.stance, custom: v.stance === 'custom' ? v.custom : undefined, roster: v.roster }))
  const framing = boxFramingText(config.boxFraming, promptViewers)
  const roster = boxRosterText(promptViewers)
  const stamp = stamping()
  spindle.log.info(`box: ${names.length} viewers (${viewers.map((v) => `${v.name}=${v.stance}`).join(', ')}), card mode ${box.cardMode}, stamping ${stamp ? 'on' : 'off (Name: prefix)'}, order ${order.join(' → ')}${input.talk ? ' + talk' : ''}`)
  if (watchingName) spindle.log.info(`watching: prompt carries "${watchingName}" (context block + beat lead)`)

  if (input.talk) await appendTalkLine(chat.id, input.talk, userId)

  // D18: fetched once per Look if any seat speaking searches (Coach, or Custom — D-069); only those seats' calls carry it.
  const searcherSpeaking = order.some((n) => {
    const v = viewers.find((x) => x.name === n)
    return !!v && looksUp(v.stance)
  })
  const looked = searcherSpeaking ? await lookUp(userId, watchingName, report?.lookup) : null

  roastInFlight.add(userId)
  let boxTold: HushTold | null = null
  const lines: BoxLine[] = []
  const cards = new Map<string, SeatCard>()
  let beatId: string | null = null
  let now = Date.now()
  try {
    for (const [i, name] of order.entries()) {
      const seat = viewers.find((v) => v.name === name)
      const seatView = promptViewers.find((v) => v.name === name)
      if (!seat || !seatView) continue
      const previous = lines[lines.length - 1] ?? null

      // This seat's stance instruction carries the scene; the focus block says whose line this is.
      const instruction = stanceInstruction(seat.stance, templates, seat.custom ?? '')
      const seatTold = toldOf(instruction, i === 0)
      if (seatTold && !boxTold) boxTold = seatTold
      const beatText =
        (watchingName ? watchingLead(watchingName) : '') +
        substituteScene(instruction, scene ? sceneWithWatching(scene, watchingName) + (i === 0 ? recap : '') : ATTACHED_SCENE_PLACEHOLDER, seenViaPhrase(source), hushed) +
        (input.closing ?? '')
      // This seat's own card goes in the card slots, and `{{char}}` is this
      // seat: the host assembles every Spindle call against the chat's primary
      // character (findings §6), so without this every seat is written as the
      // primary — GRIMBLE's card, GRIMBLE's register — whoever is speaking.
      let card: SeatCard | null = null
      if (seat.kind === 'card' && seat.characterId) {
        try {
          const known = cards.get(seat.characterId)
          if (known) card = known
          else {
            const dto = await spindle.characters.get(seat.characterId, userId)
            if (dto) {
              card = { description: dto.description, personality: dto.personality, scenario: dto.scenario, postHistoryInstructions: dto.post_history_instructions }
              cards.set(seat.characterId, card)
            }
          }
        } catch (err) {
          spindle.log.warn(`box: could not read ${name}'s card; the call carries only the name: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else if (seat.roster) {
        // A council member: definition and personality as the card, behaviour folded into personality.
        const behaviour = (seat.roster.behavior ?? '').trim()
        card = { description: seat.roster.definition, personality: [seat.roster.personality, behaviour].filter((x) => x && x.trim()).join('\n\n') }
      }
      // Anti-repetition is per seat: only this viewer's own earlier lines. The
      // other viewer's lines in that list taught the model their register.
      const ownPrefix = `${name.toLowerCase()}:`
      const ownRecent = recent.filter((r) => r.toLowerCase().startsWith(ownPrefix)).map((r) => r.slice(name.length + 1).trim())
      const seatReference = looked && looksUp(seat.stance) ? referenceText(looked.results, { name: watchingName ?? '', viewer: name, onScreen: report?.lookup, coach: seat.stance === 'coach' }) : ''
      const blocks = buildBlockGraph({
        systemPrompt: framing,
        beat: beatText,
        recentReactions: ownRecent,
        focus: boxFocusText({ template: config.boxFocus, seat: seatView, previous, talk: !!input.talk && i === 0 }),
        ...(watchingName ? { sessionContext: watchingName } : {}),
        ...(roster ? { roster } : {}),
        ...(seatReference ? { reference: seatReference } : {}),
        seat: { name, card },
      })
      const messages = await assembleFor(chat, blocks, config, input, userId, true)
      if (!messages) {
        if (i === 0) {
          lastRoastAt.set(userId, previousRoastAt)
          return { ok: false, error: 'Could not attach the picture: the hidden note was missing from the prompt. Please report this.' }
        }
        break
      }

      let raw: string
      try {
        sendProgress(userId, { phase: 'writing', name, seat: i + 1, of: order.length, lines: lines.map((l) => ({ ...l })) })
        raw = await callModel(config, generationRequest(config, messages, userId), 'model')
      } catch (err) {
        if (i === 0) {
          lastRoastAt.set(userId, previousRoastAt)
          throw err
        }
        spindle.log.warn(`box: ${name}'s line failed, stopping after ${lines.length}: ${err instanceof Error ? err.message : String(err)}`)
        break
      }
      markOwn(userId)
      if (isGenerationBusy(userId)) {
        if (i === 0) {
          lastRoastAt.set(userId, previousRoastAt)
          return { ok: false, reason: 'busy', detail: { late: true } }
        }
        spindle.log.info(`box: a real generation started; stopping the chain after ${lines.length} line${lines.length === 1 ? '' : 's'}`)
        break
      }

      const { text, labelledAs } = firstSpeakerText(raw, viewers.map((v) => ({ name: v.name, characterId: v.characterId })), name)
      if (labelledAs) spindle.log.warn(`box: ${name}'s call came back labelled "${labelledAs}"; kept the first speaker's text as ${name}'s`)
      if (!text) {
        spindle.log.warn(`box: ${name}'s call came back empty; seat skipped`)
        continue
      }

      // The hidden beat lands once, before the first line.
      if (beatId === null) {
        now = Date.now()
        beatId = (await appendBeat({ chat, userId, config, input, scene, source, watchingName, report, stance: `box:${seat.stance}`, now })).id
      }
      const line: BoxLine = { name, text, viewerId: seat.id, characterId: seat.characterId, ...(seat.avatarUrl ? { avatarUrl: seat.avatarUrl } : {}), ...(seatReference ? { lookedUp: true } : {}) }
      const row = await spindle.chat.appendMessage(
        chat.id,
        {
          role: 'assistant',
          // Stamped (D13″): the host shows the right name and avatar. Fallback: the prefix, which the Pane parses.
          content: stamp ? text : `${name}: ${text}`,
          ...(stamp ? { name, ...(seat.characterId ? { characterId: seat.characterId } : {}) } : {}),
          metadata: {
            houselights: {
              reaction: true,
              at: now,
              beatMessageId: beatId,
              box: true,
              seat: i + 1,
              speaker: name,
              speakerId: seat.characterId ?? box.primaryId,
              ...(stamp ? { stamped: true } : {}),
              ...(seatReference ? { lookedUp: true, lookupQuery: looked?.query } : {}),
              ...(seatTold ? { hushTold: seatTold } : {}),
              ...(seat.avatarUrl ? { speakerAvatar: seat.avatarUrl } : {}),
            },
          },
        },
        { triggerGeneration: false },
      )
      markOwn(userId, row?.id)
      if (row?.id) line.messageId = row.id
      lines.push(line)
      spoke.set(name, Date.now())
      spindle.log.info(`box: seat ${i + 1} ${name}${stamp ? ' (stamped)' : ''} → "${text.slice(0, 120)}"`)
    }
  } finally {
    roastInFlight.delete(userId)
  }

  if (lines.length === 0) return { ok: false, error: 'The Box Seat\'s answer had no usable line in it.' }
  for (const line of lines) await rememberRoast({ text: `${line.name}: ${line.text}`, scene: scene ?? '', at: Date.now() }, config.roastMemory, userId)
  if (pinnedElsewhere) unseenReactions.set(userId, (unseenReactions.get(userId) ?? 0) + 1)
  const text = lines.map((l) => `${l.name}: ${l.text}`).join('\n')
  return { ok: true, text, scene, chatId: chat.id, interest: report?.interest, kind: report?.kind, app: report?.app ?? null, appConfidence: report?.appConfidence, watching: watchingName, lines, boxOrder: order, speakOnly: speakerOf(config.boxSpeakers, chat.id, viewers), ...(boxTold ? { hushTold: boxTold } : {}), ...(looked && lines.some((l) => l.lookedUp) ? { lookedUp: { query: looked.query, fresh: looked.fresh } } : {}) }
}

function outcomeToResult(outcome: Outcome, trigger: ReactionTrigger): ReactionResult {
  if (outcome.ok) {
    return {
      type: 'reaction_result',
      ok: true,
      trigger,
      text: outcome.text,
      scene: outcome.scene,
      chatId: outcome.chatId,
      interest: outcome.interest,
      kind: outcome.kind,
      app: outcome.app,
      appConfidence: outcome.appConfidence,
      watching: outcome.watching,
      ...(outcome.messageId ? { messageId: outcome.messageId } : {}),
      ...(outcome.lookedUp ? { lookedUp: outcome.lookedUp } : {}),
      ...(outcome.hushTold ? { hushTold: outcome.hushTold } : {}),
      ...(outcome.lines ? { lines: outcome.lines } : {}),
      ...(outcome.boxOrder ? { boxOrder: outcome.boxOrder } : {}),
      ...(outcome.speakOnly !== undefined ? { speakOnly: outcome.speakOnly } : {}),
    }
  }
  if ('reason' in outcome) {
    return { type: 'reaction_result', ok: false, trigger, reason: outcome.reason, detail: outcome.detail }
  }
  return { type: 'reaction_result', ok: false, trigger, error: outcome.error }
}

// ---------------------------------------------------------------------------
// Frontend messaging
// ---------------------------------------------------------------------------

spindle.onFrontendMessage(async (payload: unknown, userId: string, frontendSessionId?: string) => {
  const msg = payload as { type?: string; [k: string]: unknown }
  // Reply to the document that asked, when the host can tell them apart —
  // the Lumiverse tab and a pop-out widget can both be connected.
  const reply = (m: Record<string, unknown>) =>
    frontendSessionId && canTargetSessions()
      ? spindle.sendToFrontend(m, userId, { frontendSessionId })
      : spindle.sendToFrontend(m, userId)

  try {
    switch (msg.type) {
      case 'get_state': {
        const [config, connections, chat, chats] = await Promise.all([
          loadConfig(userId),
          spindle.connections.list(userId),
          chatState(userId),
          listChats(userId).catch((err) => {
            spindle.log.warn(`chats.list failed: ${err instanceof Error ? err.message : String(err)}`)
            return []
          }),
        ])
        reply({
          type: 'state',
          config,
          defaults: {
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            roastInstruction: DEFAULT_REACTION_INSTRUCTION,
            coachInstruction: DEFAULT_COACH_INSTRUCTION,
            characterInstruction: DEFAULT_CHARACTER_INSTRUCTION,
            selfRecognition: DEFAULT_SELF_RECOGNITION,
            talkInstruction: DEFAULT_TALK_INSTRUCTION,
            boxFraming: DEFAULT_BOX_FRAMING,
            boxFocus: DEFAULT_BOX_FOCUS,
            visionPrompt: DEFAULT_VISION_PROMPT,
          },
          sampleScene: SAMPLE_SCENE,
          connections: connections.map((c) => ({
            id: c.id,
            name: c.name,
            model: c.model,
            isDefault: c.is_default,
          })),
          activeChat: chat.chat,
          chatEnabled: chat.enabled,
          chatMode: chat.mode,
          activeChatId: chat.activeChatId,
          newReactions: chat.newReactions,
          chatState: chat,
          chats,
          watching: await watchingState(userId),
          companionSession: companionSession(userId),
          recentRoasts: (await loadRoasts(userId)).slice(-5).map((r) => r.text),
          hush: hushState(userId),
          desktopCapture: detectDesktopCapture(),
          lastCaptureAt: lastCapture.get(userId)?.receivedAt ?? null,
          cooldownRemainingMs: Math.max(
            0,
            config.cooldownSeconds * 1000 - (Date.now() - (lastRoastAt.get(userId) ?? 0)),
          ),
        })
        break
      }

      case 'save_config': {
        const incoming = (msg.config ?? {}) as Partial<HouselightsConfig>
        const merged = { ...(await loadConfig(userId)), ...incoming }
        await saveConfig(merged, userId)
        const saveId = typeof msg.saveId === 'string' ? msg.saveId : null
        reply({ type: 'config_saved', config: merged, saveId })
        // D-060: every other open window (a phone, another tab) gets the change too, so
        // none of them acts on a stale copy. The id lets the sender skip its own.
        if (canTargetSessions()) spindle.sendToFrontend({ type: 'config_changed', config: merged, saveId }, userId)
        break
      }

      /**
       * Troubleshooting resets (2026-11-15). "settings": every setting back to its
       * default except the prompts and the saved instructions; each chat's record
       * (on/off, stance, custom text) is left alone. "factory": every file this
       * extension stores for the user is deleted, and its in-memory state dropped.
       */
      case 'reset_config': {
        const scope = msg.scope === 'factory' ? 'factory' : 'settings'
        if (scope === 'factory') {
          const paths = await spindle.userStorage.list(undefined, userId).catch(() => [] as string[])
          for (const path of paths) await spindle.userStorage.delete(path, userId).catch(() => undefined)
          for (const m of [lastRoastAt, hushUntil, conversationUntil, lastHushedBeat, hushedSeen, hushStartedAt, hushJustEnded, lastCapture, unseenReactions, watching, lastScene, lastLookup]) m.delete(userId)
          spindle.log.info(`reset: factory — deleted ${paths.length} stored file${paths.length === 1 ? '' : 's'}`)
        } else {
          const current = await loadConfig(userId)
          const kept: Partial<HouselightsConfig> = {}
          for (const k of PROMPT_KEYS) (kept as Record<string, unknown>)[k] = current[k]
          await saveConfig({ ...DEFAULT_CONFIG, ...kept }, userId)
          spindle.log.info('reset: settings — prompts and saved instructions kept')
        }
        pushHushState(userId)
        reply({ type: 'reset_done', scope })
        if (canTargetSessions()) spindle.sendToFrontend({ type: 'config_changed', config: await loadConfig(userId), saveId: `reset-${Date.now()}` }, userId)
        break
      }

      /**
       * Fallback for hosts whose frontend can't read a message directly: the
       * beat decorator sends the ids of the bubbles it can see, we read the
       * active chat once and return the beat metadata for the ones that are ours.
       */
      case 'get_beats': {
        const ids = Array.isArray(msg.messageIds) ? msg.messageIds.filter((x): x is string => typeof x === 'string') : []
        const beats: Record<string, unknown> = {}
        for (const id of ids) beats[id] = null
        const chat = ids.length ? await spindle.chats.getActive(userId) : null
        if (chat) {
          const wanted = new Set(ids)
          for (const m of await spindle.chat.getMessages(chat.id)) {
            if (!wanted.has(m.id)) continue
            // The host splits `extra.spindle_metadata` out into `metadata` on
            // the way to the worker (worker-host.ts handleChatGetMessages).
            // Read that first; keep the raw-extra shape as a fallback.
            const row = m as { metadata?: Record<string, unknown>; extra?: Record<string, unknown> }
            const spindleMeta = row.metadata ?? (row.extra?.spindle_metadata as Record<string, unknown> | undefined)
            const meta = (spindleMeta as { houselights?: unknown } | undefined)?.houselights
            if (meta && typeof meta === 'object') {
              const hl = meta as { beat?: boolean; speakerAvatar?: unknown; speaker?: unknown }
              if (hl.beat) beats[m.id] = meta
              // D-053: a council member's line, for the portrait beside the name.
              else if (typeof hl.speakerAvatar === 'string' && hl.speakerAvatar) beats[m.id] = { speakerAvatar: hl.speakerAvatar, speaker: hl.speaker }
            }
          }
        }
        reply({ type: 'beats', beats })
        break
      }

      /** D18: can looking things up work here? Permission, and Lumiverse's own Web Search switch. */
      case 'get_lookup_status': {
        reply({ ...(await lookupStatus(userId)) })
        break
      }

      /** The watched chat's last few messages, for the Pane's expanded state. */
      case 'get_tail': {
        const limit = Math.min(40, Math.max(1, Number(msg.limit) || 12))
        const { chat } = await watchedChat(userId)
        if (!chat) {
          reply({ type: 'tail', chatId: null, chatName: null, entries: [] })
          break
        }
        reply({ type: 'tail', chatId: chat.id, chatName: chat.name, entries: await chatTail(chat.id, limit, userId, await characterName(chat.character_id, userId), chat.character_id) })
        break
      }

      case 'get_chat_state': {
        reply({ ...(await chatState(userId)) })
        break
      }

      case 'set_chat_enabled': {
        const chatId = typeof msg.chatId === 'string' ? msg.chatId : null
        if (chatId) await setChatEnabled(chatId, msg.enabled === true, userId)
        reply({ ...(await chatState(userId)) })
        break
      }

      /** D17: the stance for one chat, and the Custom text when given. */
      case 'set_stance': {
        const chatId = typeof msg.chatId === 'string' ? msg.chatId : null
        if (chatId && isStance(msg.stance)) {
          await setChatStance(chatId, msg.stance, typeof msg.custom === 'string' ? msg.custom : undefined, userId)
        }
        reply({ ...(await chatState(userId)) })
        break
      }

      /** D18″: Look things up, for this chat. */
      case 'set_chat_lookup': {
        const chatId = typeof msg.chatId === 'string' ? msg.chatId : null
        if (chatId && typeof msg.on === 'boolean') {
          await saveChatRecord(chatId, { ...(await chatRecord(chatId, userId)), lookUp: msg.on }, userId)
          spindle.log.info(`lookup: ${msg.on ? 'on' : 'off'} for chat ${chatId}`)
        }
        reply({ ...(await chatState(userId)) })
        break
      }

      /** Box Seat: one viewer's stance in a group chat. */
      /** D-052: a box viewer's own Custom instruction. Empty text: back to the chat's Custom text. */
      case 'set_viewer_custom': {
        const chatId = typeof msg.chatId === 'string' ? msg.chatId : null
        const viewerId = typeof msg.viewerId === 'string' ? msg.viewerId : null
        if (chatId && viewerId && typeof msg.text === 'string') {
          const r = await chatRecord(chatId, userId)
          const vc = { ...(r.viewerCustom ?? {}) }
          const text = msg.text.trim().slice(0, 4000)
          if (text) vc[viewerId] = text
          else delete vc[viewerId]
          const next: ChatRecord = { ...r, viewerCustom: vc }
          if (!Object.keys(vc).length) delete next.viewerCustom
          await saveChatRecord(chatId, next, userId)
          spindle.log.info(`stance: ${chatId} viewer ${viewerId} custom ${text ? `(${text.length} chars)` : '→ the chat\'s'}`)
        }
        reply({ ...(await chatState(userId)) })
        break
      }

      /** Box Seat: seat a council member in this chat's box, or leave them out. */
      case 'set_council_seat': {
        const chatId = typeof msg.chatId === 'string' ? msg.chatId : null
        const viewerId = typeof msg.viewerId === 'string' && msg.viewerId.startsWith('council:') ? msg.viewerId : null
        if (chatId && viewerId && typeof msg.seated === 'boolean') {
          const r = await chatRecord(chatId, userId)
          if (await isGroupChat(chatId, userId)) {
            // Group chats: everyone sits unless left out.
            const out = new Set(r.councilOut ?? [])
            if (msg.seated) out.delete(viewerId)
            else out.add(viewerId)
            await saveChatRecord(chatId, { ...r, councilOut: [...out] }, userId)
          } else {
            // D-052, solo chats: nobody sits unless asked in.
            const inn = new Set(r.councilIn ?? [])
            if (msg.seated) inn.add(viewerId)
            else inn.delete(viewerId)
            await saveChatRecord(chatId, { ...r, councilIn: [...inn] }, userId)
          }
          spindle.log.info(`box: ${viewerId} ${msg.seated ? 'seated in' : 'left out of'} ${chatId}`)
        }
        reply({ ...(await chatState(userId)) })
        break
      }

      case 'set_viewer_stance': {
        const chatId = typeof msg.chatId === 'string' ? msg.chatId : null
        const viewerId = typeof msg.viewerId === 'string' ? msg.viewerId : null
        if (chatId && viewerId && isStance(msg.stance)) await setViewerStance(chatId, viewerId, msg.stance, userId)
        reply({ ...(await chatState(userId)) })
        break
      }

      /** D5: pin a chat (reactions go there wherever the user is) or clear the pin. */
      case 'pin_chat': {
        const chatId = typeof msg.chatId === 'string' && msg.chatId ? msg.chatId : null
        if (chatId && !(await spindle.chats.get(chatId, userId))) {
          reply({ type: 'error', message: 'That chat no longer exists.' })
          break
        }
        await pinChat(chatId, userId)
        spindle.sendToFrontend({ type: 'config_saved', config: await loadConfig(userId) }, userId)
        spindle.sendToFrontend(await chatState(userId), userId)
        break
      }

      case 'list_chats': {
        reply({ type: 'chats', chats: await listChats(userId) })
        break
      }

      /** D15: the chip. A title from the browser at Start, and the three answers. */
      case 'watch_candidate': {
        await proposeWatching(userId, typeof msg.text === 'string' ? msg.text : null, 'label', 1)
        break
      }
      case 'confirm_watching': {
        await setConfirmedWatching(userId, msg.text, 'user')
        await pushWatching(userId)
        break
      }
      case 'dismiss_watching': {
        const w = await watchingRecord(userId)
        if (w.candidate) w.dismissed = w.candidate.text
        w.candidate = null
        await pushWatching(userId)
        break
      }
      case 'clear_watching': {
        await setConfirmedWatching(userId, null, 'clear')
        await pushWatching(userId)
        break
      }
      /** What the pipeline would use right now — for the read-back. */
      case 'get_watching': {
        reply({ ...(await watchingState(userId)) })
        break
      }

      /** Talk-back (D14), plain send: the user's line against the latest capture. */
      case 'talk': {
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 2000) : ''
        if (!text) break
        const config = await loadConfig(userId)
        const cap = lastCapture.get(userId)
        const seen = lastScene.get(userId)
        // Reuse the description of the last capture when we have it (no second
        // look); in attach mode the picture itself goes again.
        const scene = seen && seen.captureReceivedAt === (cap?.receivedAt ?? null) && config.visionMode !== 'attach' ? seen.scene ?? undefined : undefined
        const outcome = await react({ trigger: 'talk', frame: cap, scene, talk: text }, userId)
        const result = outcomeToResult(outcome, 'talk')
        reply({ ...result })
        spindle.sendToFrontend({ type: 'companion_reaction', result }, userId) // D-063
        if (!result.ok && result.error) spindle.toast.error(`Reply failed: ${result.error}`, { userId })
        if (result.ok && config.pinnedChatId) spindle.sendToFrontend(await chatState(userId), userId)
        break
      }

      /** The text path: a typed scene, for checking the reaction without a screen. */
      case 'test_roast': {
        const scene = typeof msg.scene === 'string' && msg.scene.trim() ? msg.scene : SAMPLE_SCENE
        reply({ type: 'roast_pending' })
        const outcome = await react({ trigger: 'manual', scene }, userId)
        const result = outcomeToResult(outcome, 'manual')
        reply({
          type: 'roast_result',
          ok: result.ok,
          roast: result.text,
          error: result.error ?? (result.reason ? `Skipped: ${result.reason}` : undefined),
        })
        if (result.ok) spindle.toast.success('Reaction delivered.', { userId })
        else spindle.toast.error(`Reaction failed: ${result.error ?? result.reason}`, { userId })
        break
      }

      /**
       * A frame from the capture tab. First the receipt (spike S1's answer:
       * the size that arrived vs the size that was sent), then the reaction.
       */
      case 'capture': {
        const receivedAt = Date.now()
        const frame = msg as unknown as Partial<CapturePayload>
        const jpegB64 = typeof frame.jpegB64 === 'string' ? frame.jpegB64 : ''
        const thumbB64 = typeof frame.thumbB64 === 'string' ? frame.thumbB64 : ''
        const width = Number(frame.width)
        const height = Number(frame.height)
        const source = isCaptureSource(frame.source) ? frame.source : 'screen'
        const localTime = typeof frame.localTime === 'string' ? frame.localTime.slice(0, 16) : undefined
        const talk = typeof frame.talk === 'string' && frame.talk.trim() ? frame.talk.trim().slice(0, 2000) : undefined
        const trigger = talk ? 'talk' : frame.trigger === 'tick' || frame.trigger === 'test' ? frame.trigger : 'look'

        const fail = (error: string) => {
          const receipt: CaptureReceipt = { type: 'capture_received', ok: false, error, source, trigger }
          reply({ ...receipt })
        }
        if (!jpegB64) {
          fail('The picture arrived empty.')
          break
        }
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          fail('The picture arrived without its size.')
          break
        }
        // A JPEG starts with FF D8, which base64-encodes to "/9j/".
        if (!jpegB64.startsWith('/9j/')) {
          fail('The picture arrived in a format Houselights does not use.')
          break
        }

        const measuredJpegBytes = base64ByteLength(jpegB64)
        const measuredThumbBytes = base64ByteLength(thumbB64)
        const declaredJpegBytes = Number(frame.declaredJpegBytes)
        const intact = Number.isFinite(declaredJpegBytes) && declaredJpegBytes === measuredJpegBytes

        const stored: StoredCapture = {
          jpegB64,
          thumbB64,
          width,
          height,
          source,
          capturedAt: Number(frame.capturedAt) || receivedAt,
          receivedAt,
          localTime,
          ...(frame.shift === true ? { shift: true } : {}),
        }
        lastCapture.set(userId, stored)
        // D-063: every window hears that a frame arrived; a phone in companion mode shows it.
        if (trigger !== 'test') spindle.sendToFrontend({ type: 'companion_frame', thumbB64, width, height, source, at: receivedAt }, userId)

        spindle.log.info(
          `capture: ${source}/${trigger} ${width}x${height} ${measuredJpegBytes} B` +
            (intact ? ' (intact)' : ` (DECLARED ${declaredJpegBytes} B — mismatch)`),
        )

        const receipt: CaptureReceipt = {
          type: 'capture_received',
          ok: true,
          source,
          trigger,
          width,
          height,
          measuredJpegBytes,
          measuredThumbBytes,
          declaredJpegBytes: Number.isFinite(declaredJpegBytes) ? declaredJpegBytes : undefined,
          intact,
          capturedAt: Number(frame.capturedAt) || undefined,
          receivedAt,
        }
        reply({ ...receipt })

        // Test frames prove the transport and nothing else — no character involved.
        if (trigger === 'test') break

        const outcome = await react({ trigger, frame: stored, talk }, userId)
        const result = outcomeToResult(outcome, trigger)
        reply({ ...result })
        spindle.sendToFrontend({ type: 'companion_reaction', result }, userId) // D-063
        if (!result.ok && result.error) {
          spindle.toast.error(`Reaction failed: ${result.error}`, { userId })
        }
        // In pinned mode the badge count may have moved; every document gets it.
        if (result.ok && (await loadConfig(userId)).pinnedChatId) spindle.sendToFrontend(await chatState(userId), userId)
        break
      }

      /** The hush button in the chat input bar. Toggles, so one control does both. */
      case 'toggle_hush': {
        const config = await loadConfig(userId)
        const was = hushState(userId)
        if (was.hushed) {
          hushUntil.delete(userId)
          conversationUntil.delete(userId)
        } else {
          hushUntil.set(userId, Date.now() + config.hushMinutes * 60_000)
          hushStartedAt.set(userId, Date.now())
          armHushEnd(userId, config.hushMinutes * 60_000)
        }
        pushHushState(userId)
        if (was.hushed && was.source === 'button') hushEnded(userId)
        break
      }

      /** Dim or undim, said explicitly: a stale view in the frontend can never invert it. */
      case 'set_hush': {
        const config = await loadConfig(userId)
        const was = hushState(userId)
        if (msg.hushed === true) {
          hushUntil.set(userId, Date.now() + config.hushMinutes * 60_000)
          if (!(was.hushed && was.source === 'button')) hushStartedAt.set(userId, Date.now())
          armHushEnd(userId, config.hushMinutes * 60_000)
        } else {
          hushUntil.delete(userId)
          conversationUntil.delete(userId)
        }
        pushHushState(userId)
        if (msg.hushed !== true && was.hushed && was.source === 'button') hushEnded(userId)
        break
      }

      /** D-063: a window started or stopped sharing a screen. */
      case 'session_state': {
        const id = frontendSessionId ?? ''
        const wasLive = liveWindow.get(userId)
        if (msg.live === true) {
          liveWindow.set(userId, id)
          const stop = readStop(msg)
          if (stop) liveStop.set(userId, stop)
          else liveStop.delete(userId)
          // D-070: a new session starts clean — nothing from an earlier one is "just now".
          for (const m of [hushedSeen, hushJustEnded, lastHushedBeat]) m.delete(userId)
          sessionLogs.set(userId, newSessionLog(Date.now())) // D-100
          await watchingSession(userId, true)
        } else if (wasLive === id || wasLive === undefined) {
          // (`undefined`: this worker restarted mid-session and never heard the start.)
          liveWindow.delete(userId)
          liveStop.delete(userId)
          // D-100: the curtain call names what the session was watching; read it before it expires.
          const log = sessionLogs.get(userId)
          sessionLogs.delete(userId)
          const watching = log ? (await watchingRecord(userId)).confirmed : null
          await watchingSession(userId, false)
          // Not when the page itself went away: there is no window left to hear it.
          if (log && msg.reason !== 'destroy') {
            void curtainCall(userId, log, { autoStop: msg.reason === 'auto-stop', watching, window: id }).catch((err) =>
              spindle.log.warn(`curtain call failed: ${err instanceof Error ? err.message : String(err)}`),
            )
          }
        }
        // D-096: every window hears it, so a phone that was told "not sharing" can stop saying so.
        spindle.sendToFrontend(companionSession(userId), userId)
        break
      }

      /** D-100: the next-track key was pressed in a window. One line per press, so "it did nothing" can be read off the log. */
      case 'media_key': {
        const outcome = msg.outcome === 'looked' ? 'took a Look' : msg.outcome === 'busy' ? 'ignored: still on the last Look' : 'ignored: no session in that window'
        spindle.log.info(`media key: ${outcome} (tab ${msg.hidden === true ? 'hidden' : 'in front'})`)
        break
      }

      /** D-099: the sharing window pushed back its auto-stop (Extend). */
      case 'session_extended': {
        if (liveWindow.get(userId) !== (frontendSessionId ?? '')) break
        const stop = readStop(msg)
        if (stop) liveStop.set(userId, stop)
        spindle.sendToFrontend(companionSession(userId), userId)
        break
      }

      /** D-099: a companion phone asks the sharing window for more time. */
      case 'remote_extend': {
        const target = liveWindow.get(userId)
        if (target === undefined) {
          spindle.sendToFrontend(companionSession(userId), userId)
          break
        }
        const request = { type: 'remote_extend_request' }
        if (target && canTargetSessions()) spindle.sendToFrontend(request, userId, { frontendSessionId: target })
        else spindle.sendToFrontend(request, userId)
        break
      }

      /** D-063: a phone in companion mode asks the sharing window for a Look (optionally with a line). */
      case 'remote_look': {
        const target = liveWindow.get(userId)
        if (target === undefined) {
          reply({ type: 'remote_look_result', ok: false, text: 'Your computer is not sharing a screen right now. Start a session there first: the share dialog can only be opened on the computer itself.' })
          break
        }
        const talk = typeof msg.talk === 'string' && msg.talk.trim() ? msg.talk.trim().slice(0, 2000) : undefined
        const request = { type: 'remote_look_request', ...(talk ? { talk } : {}) }
        if (target && canTargetSessions()) spindle.sendToFrontend(request, userId, { frontendSessionId: target })
        else spindle.sendToFrontend(request, userId)
        reply({ type: 'remote_look_result', ok: true, text: talk ? 'Asked your computer to look and send your line…' : 'Asked your computer to look…' })
        break
      }

      /** D-063: the sharing window could not take the Look; tell the phone why. */
      case 'remote_look_answer': {
        if (msg.ok !== true) spindle.sendToFrontend({ type: 'remote_look_result', ok: false, text: typeof msg.text === 'string' ? msg.text : 'Your computer could not look just now.' }, userId)
        break
      }

      case 'get_hush': {
        pushHushState(userId)
        break
      }

      default:
        spindle.log.warn(`unknown frontend message "${String(msg.type)}"`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    spindle.log.error(`backend error on "${String(msg.type)}": ${message}`)
    if (msg.type === 'capture') {
      reply({ type: 'reaction_result', ok: false, trigger: 'look', error: message })
    } else if (msg.type === 'test_roast') {
      reply({ type: 'roast_result', ok: false, error: message })
    }
  }
})

spindle.log.info('extension loaded')
