/**
 * Voice (D16): reactions spoken aloud through the host's TTS, and push-to-talk
 * through the host's STT. Opt-in, off by default, and never an open mic.
 *
 * No DOM here: this is the engine the Pane's speaker toggle and mic button and
 * the settings panel drive, kept free of elements so it can be tested with a
 * fake context. Everything is feature-detected (`text-to-speech-v1`,
 * `speech-to-text-v1`) and gated on the `media` permission; where either is
 * missing the controls simply do not render.
 *
 * Rules (addendum §5):
 * - Speaking is a queue: a reaction's lines play in order, each awaiting the
 *   previous; a later reaction waits for the earlier one. Stop clears the queue.
 * - Never spoken: beats, "saw:" markers, the Watching chip, notices. Only what
 *   a character said.
 * - The mic interrupts: pressing it stops speech first, so the character does
 *   not talk over the user and the mic does not transcribe the character.
 * - Hush silences (the caller stops on hush).
 * - Speaking is a pacing gate: while speaking, and for one cooldown after
 *   speech ends, automatic Looks are held (`tickHold`).
 */

import type {
  SpindleFrontendContext,
  SpindleSTTProviderOption,
  SpindleSTTSession,
  SpindleSTTStartOptions,
} from 'lumiverse-spindle-types'
import type { BoxLine, ReactionResult } from './capture.ts'

export type SttProviderChoice = 'default' | 'whistle' | 'webspeech' | 'connection'

export const STT_PROVIDER_CHOICES: { id: SttProviderChoice; label: string }[] = [
  { id: 'default', label: 'Lumiverse\'s Voice & Speech setting' },
  { id: 'whistle', label: 'Whistle (runs on your own machine)' },
  { id: 'webspeech', label: 'Browser speech recognition' },
  { id: 'connection', label: 'Your STT connection' },
]

/**
 * D-057: the phone keeps its own recogniser choice, so changing it on the phone
 * leaves the computer's alone. The microphone itself is always the device's own:
 * the host opens whatever mic the browser on that device has.
 */
export type SttPhoneChoice = 'auto' | SttProviderChoice

export const STT_PHONE_CHOICES: { id: SttPhoneChoice; label: string }[] = [
  { id: 'auto', label: 'Automatic' },
  ...STT_PROVIDER_CHOICES,
]

/** A recogniser's name as the settings show it. */
const PROVIDER_NAMES: Record<string, string> = { webspeech: 'Browser speech recognition', whistle: 'Whistle', connection: 'Your STT connection' }

/** The order Automatic tries, after Lumiverse's own setting: light and live first, the big on-device model last. */
const AUTO_ORDER: Array<Exclude<SttProviderChoice, 'default'>> = ['webspeech', 'connection', 'whistle']

export interface VoiceSettings {
  /** Speak reactions aloud. The speaker toggle on the Pane. */
  voiceOut: boolean
  /** Which recogniser the mic uses. */
  sttProvider: SttProviderChoice
  /** D-057: which recogniser the mic uses on a phone. Absent = automatic. */
  sttProviderPhone?: SttPhoneChoice
  /** Send a transcript as a talk line after the delay, unless the user intervenes. */
  voiceAutoSend: boolean
  voiceAutoSendDelaySeconds: number
  /** The reaction cooldown: after speech ends, ticks are held this long. */
  cooldownSeconds: number
  /** Box fallback: a TTS connection per viewer id, for lines that cannot be played by message. */
  boxVoices: Record<string, string>
}

export const DEFAULT_VOICE_SETTINGS: Omit<VoiceSettings, 'cooldownSeconds'> = {
  voiceOut: false,
  sttProvider: 'default',
  voiceAutoSend: false,
  voiceAutoSendDelaySeconds: 3,
  boxVoices: {},
}

export interface VoiceAvailability {
  /** The host has `ctx.tts` and reports `text-to-speech-v1`. */
  tts: boolean
  /** The host has `ctx.stt` and reports `speech-to-text-v1`. */
  stt: boolean
  /** The `media` permission is granted; null until the first check answers. */
  media: boolean | null
  providers: SpindleSTTProviderOption[]
}

export type ListenPhase = 'loading' | 'listening' | 'processing'

export interface ListenCallbacks {
  onStatus(phase: ListenPhase, progress?: number): void
  /** Interim text, when the provider gives it. */
  onInterim?(text: string): void
  /** The final transcript, trimmed. Empty when nothing was heard. */
  onTranscript(text: string): void
  onError(message: string): void
  /** Always, after the transcript, an error or a cancel. */
  onEnd(): void
}

export interface Voice {
  availability(): VoiceAvailability
  /** Re-read the granted permissions. */
  refreshPermissions(): Promise<boolean>
  /** Ask the host for `media`. Resolves to whether it is granted afterwards. */
  requestMedia(): Promise<boolean>
  /** Voice out is possible and switched on. */
  canSpeak(): boolean
  /** The mic is possible. */
  canListen(): boolean
  speaking(): boolean
  listening(): boolean
  subscribe(listener: (speaking: boolean) => void): () => void
  /**
   * Queue a reaction's lines. `viewerIdOf` maps a box line to the viewer whose
   * fallback voice applies. `onlyViewerId` (D-054): in a box, speak only that
   * viewer's lines; the others are still shown, just not read aloud.
   */
  speakReaction(result: ReactionResult, viewerIdOf?: (line: BoxLine) => string | null, onlyViewerId?: string | null): void
  /** Say a line now, in the default voice (the tab's test button). */
  speakText(text: string): Promise<void>
  /** Stop playback and drop anything queued. */
  stop(): void
  /** Start one utterance. Must be called inside a click handler. False when it could not start. */
  listen(callbacks: ListenCallbacks): boolean
  cancelListening(): void
  /** Why an automatic Look should wait, or null. */
  tickHold(): string | null
  destroy(): void
}

export interface VoiceDeps {
  ctx: SpindleFrontendContext
  settings(): VoiceSettings
  /** D-057: this device is a phone, so the phone's recogniser choice applies. */
  phone?(): boolean
  now?(): number
}

/**
 * The providers to try, in order, for one press of the mic. `undefined` means
 * Lumiverse's own Voice & Speech setting. A computer gets exactly its choice; a
 * phone on Automatic gets Lumiverse's setting, then every other provider this
 * device reports as available.
 */
export function sttCandidates(
  settings: Pick<VoiceSettings, 'sttProvider' | 'sttProviderPhone'>,
  phone: boolean,
  providers: ReadonlyArray<Pick<SpindleSTTProviderOption, 'id' | 'available'>>,
): Array<SpindleSTTStartOptions['provider']> {
  const pick = (c: SttProviderChoice): SpindleSTTStartOptions['provider'] => (c === 'default' ? undefined : c)
  if (!phone) return [pick(settings.sttProvider ?? 'default')]
  const choice = settings.sttProviderPhone ?? 'auto'
  if (choice !== 'auto') return [pick(choice)]
  const usable = new Set(providers.filter((p) => p.available).map((p) => p.id))
  return [undefined, ...AUTO_ORDER.filter((id) => usable.has(id))]
}

/** What a provider's `unavailableReason` means, in a line a person can act on. */
export function sttReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'secureContext':
      return 'needs the page opened over https (or on the computer itself as localhost)'
    case 'microphone':
      return 'this browser gives the page no microphone (phone and tablet browsers allow it only on https pages)'
    case 'audioCapture':
      return 'this browser cannot record audio for it'
    case 'webSpeech':
      return 'this browser has no speech recognition (Firefox does not; Chrome and Safari do)'
    case 'connectionRequired':
      return 'no STT connection is set up in Lumiverse'
    case 'worker':
    case 'wasm':
    case 'crypto':
      return 'this browser is missing something it needs; a current Chrome or Safari has it'
    default:
      return reason ? `not available here (${reason})` : 'not available here'
  }
}

/** A character line with a stray `Name:` in front has it removed before it is spoken. */
export function spokenText(text: string, name?: string | null): string {
  const t = text.trim()
  if (!name) return t
  const prefix = new RegExp(`^\\**${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\**\\s*[:—–-]\\s*`, 'i')
  return t.replace(prefix, '').trim()
}

export function createVoice(deps: VoiceDeps): Voice {
  const { ctx } = deps
  const now = deps.now ?? (() => Date.now())
  const caps = (ctx.host?.capabilities ?? {}) as Record<string, number | undefined>
  const tts = ctx.tts && Number(caps['text-to-speech-v1'] ?? 0) >= 1 ? ctx.tts : null
  const stt = ctx.stt && Number(caps['speech-to-text-v1'] ?? 0) >= 1 ? ctx.stt : null

  let media: boolean | null = null
  let speakingNow = tts?.isSpeaking() ?? false
  let speechEndedAt = 0
  let epoch = 0
  let chain: Promise<void> = Promise.resolve()
  let session: SpindleSTTSession | null = null
  const listeners = new Set<(speaking: boolean) => void>()

  const unsubscribeTts = tts
    ? tts.subscribe((speaking) => {
        if (speaking === speakingNow) return
        speakingNow = speaking
        if (!speaking) speechEndedAt = now()
        for (const l of listeners) {
          try {
            l(speaking)
          } catch {
            // A listener's failure is its own problem.
          }
        }
      })
    : null

  async function readGranted(): Promise<boolean> {
    try {
      const granted = await ctx.permissions.getGranted()
      media = granted.includes('media')
    } catch {
      media = false
    }
    return media
  }
  void readGranted()

  function providers(): SpindleSTTProviderOption[] {
    if (!stt) return []
    try {
      return stt.listProviders()
    } catch {
      return []
    }
  }

  const onPhone = () => deps.phone?.() === true

  const canSpeak = () => !!tts && media === true && deps.settings().voiceOut
  const canListen = () => !!stt && media === true

  async function sayText(text: string, connectionId?: string): Promise<void> {
    if (!tts) return
    const clean = text.trim()
    if (!clean) return
    await tts.speak({ text: clean }, connectionId ? { connectionId } : undefined)
  }

  async function sayLine(line: { text: string; messageId?: string; name?: string | null }, connectionId?: string): Promise<void> {
    if (!tts) return
    if (line.messageId) {
      try {
        await tts.speak({ messageId: line.messageId })
        return
      } catch {
        // Not the active chat, or no saved audio and synthesis failed: say the text instead.
      }
    }
    await sayText(spokenText(line.text, line.name), connectionId)
  }

  function enqueue(job: (mine: number) => Promise<void>): void {
    const mine = epoch
    chain = chain
      .then(() => (mine === epoch ? job(mine) : undefined))
      .catch(() => {
        // One failed line must not block the next.
      })
  }

  return {
    availability: () => ({ tts: !!tts, stt: !!stt, media, providers: providers() }),
    refreshPermissions: readGranted,
    async requestMedia() {
      try {
        const granted = await ctx.permissions.request(['media'], {
          reason: 'Voice: to speak reactions aloud, and to hear you when you press the mic. Off until you turn it on. The mic opens only when you press it, for one thing you say.',
        })
        media = granted.includes('media')
      } catch {
        await readGranted()
      }
      return media === true
    },
    canSpeak,
    canListen,
    speaking: () => speakingNow,
    listening: () => session !== null,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    speakReaction(result, viewerIdOf, onlyViewerId) {
      if (!result.ok || !canSpeak()) return
      const settings = deps.settings()
      if (result.lines && result.lines.length > 0) {
        for (const line of result.lines) {
          const viewerId = viewerIdOf?.(line) ?? null
          if (onlyViewerId && viewerId !== onlyViewerId) continue
          const connectionId = viewerId ? settings.boxVoices[viewerId] : undefined
          enqueue(() => sayLine(line, connectionId || undefined))
        }
        return
      }
      if (result.text) {
        const line = { text: result.text, messageId: result.messageId }
        enqueue(() => sayLine(line))
      }
    },
    speakText(text) {
      if (!tts) return Promise.reject(new Error('This Lumiverse cannot speak yet.'))
      if (media !== true) return Promise.reject(new Error('The media permission is not granted.'))
      return sayText(text)
    },
    stop() {
      epoch += 1
      chain = Promise.resolve()
      if (tts && media === true) {
        try {
          tts.stop()
        } catch {
          // Nothing was playing, or the host refused: either way we are quiet.
        }
      }
    },
    listen(callbacks) {
      if (!stt || media !== true) return false
      if (session) return false
      // The mic interrupts: the character stops talking before the user starts.
      this.stop()
      // D-057: on a phone set to Automatic, a recogniser the host refuses on the spot
      // (not available on this device) hands over to the next. All of it happens inside
      // this one click, which the browser needs before it opens the mic.
      const candidates = sttCandidates(deps.settings(), onPhone(), providers())
      let s: SpindleSTTSession | null = null
      let lastErr: unknown = null
      for (const provider of candidates) {
        try {
          s = stt.start({
            provider,
            continuous: false,
            onStatus: (status) => callbacks.onStatus(status.phase, status.progress),
            onResult: (r) => {
              if (!r.isFinal) callbacks.onInterim?.(r.text)
            },
          })
          break
        } catch (err) {
          lastErr = err
          if (!/STT_UNAVAILABLE|STT_PROVIDER_INVALID|not available/i.test(err instanceof Error ? err.message : String(err))) break
        }
      }
      if (!s) {
        console.warn('[Houselights] mic: the recogniser would not start:', lastErr)
        callbacks.onError(describeSttError(lastErr))
        return false
      }
      session = s
      const started: SpindleSTTSession = s
      s.ready.catch(() => {
        // Reported through `result` below.
      })
      s.result
        .then((t) => callbacks.onTranscript(t.text.trim()))
        .catch((err: unknown) => {
          if (isAbort(err)) return
          // D-058: name the recogniser that failed, so "which one broke?" needs no guessing.
          console.warn(`[Houselights] mic: ${started.provider} failed:`, err)
          callbacks.onError(`${PROVIDER_NAMES[started.provider] ?? started.provider}: ${describeSttError(err)}`)
        })
        .finally(() => {
          if (session === started) session = null
          callbacks.onEnd()
        })
      return true
    },
    cancelListening() {
      const s = session
      if (!s) return
      session = null
      try {
        s.cancel()
      } catch {
        // Already finished.
      }
    },
    tickHold() {
      if (!tts || !deps.settings().voiceOut) return null
      if (speakingNow) return 'the character is still speaking'
      const cooldownMs = Math.max(0, deps.settings().cooldownSeconds) * 1000
      if (speechEndedAt && now() < speechEndedAt + cooldownMs) return 'letting the last line land'
      return null
    },
    destroy() {
      this.cancelListening()
      epoch += 1
      unsubscribeTts?.()
      listeners.clear()
    },
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/** The host's STT errors in a line a person can act on. */
export function describeSttError(err: unknown, secure: boolean = isSecurePage()): string {
  const message = err instanceof Error ? err.message : String(err)
  // Phone browsers give a plain-http page no microphone at all, whatever the permission says.
  const insecure = secure
    ? ''
    : ' This page is open over plain http, and phone and tablet browsers allow the microphone only on https pages. Lumiverse\'s Tailscale guide sets up an https address.'
  if (/STT_BUSY/i.test(message)) return 'Another extension has the microphone right now.'
  const unavailable = /STT_UNAVAILABLE:(\w+)/.exec(message)
  if (unavailable) return `That recogniser ${sttReasonText(unavailable[1])}.${insecure}`
  if (/NotAllowed|denied|permission|not-allowed/i.test(message)) return `The browser did not allow the microphone. Check the site\'s microphone permission.${insecure}`
  if (/service-not-allowed/i.test(message)) return 'This browser\'s speech service is off. Choose another mic recogniser on the Voice card in the full settings.'
  if (/recognition error: network/i.test(message)) return 'The browser\'s speech recognition could not reach its online service.'
  if (/No speech detected/i.test(message)) return 'No speech heard. Press the mic and talk.'
  if (/SPINDLE_FRONTEND_INACTIVE/i.test(message)) return 'Houselights was reloaded. Press the mic again.'
  return message || 'The microphone could not start.'
}

/** False only when the browser says so: a plain-http page that is not localhost. */
export function isSecurePage(): boolean {
  try {
    return (globalThis as { isSecureContext?: boolean }).isSecureContext !== false
  } catch {
    return true
  }
}
