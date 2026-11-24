/**
 * Spike H1 (addendum §8): Look on a hardware media key.
 *
 * Browsers refuse global hotkeys, but Chrome routes the keyboard's media keys
 * to the tab that holds the active media session, even in the background. So
 * Houselights can claim one media action ("next track") and treat it as Look.
 *
 * Unknowns this spike exists to answer, on a real machine:
 * - Does the key reach a background tab at all while a game has focus?
 * - Does the tab need audio playing to hold the media session? The "hold"
 *   option plays a silent looping audio element to find out.
 * - Does it steal the key from Spotify and other players?
 *
 * Opt-in, off by default. A key press is not a user gesture, so it can only
 * Look within a session that is already running; it never opens the share
 * picker. No DOM here beyond one detached audio element.
 */

export type MediaKeyAction = 'nexttrack'

export interface MediaKeyPress {
  at: number
  /** The Lumiverse tab was hidden (a game or another tab in front). */
  hidden: boolean
  /** The Lumiverse page had keyboard focus. */
  focused: boolean
  /** The silent hold was playing. */
  holding: boolean
  /** What the press did. */
  outcome: 'looked' | 'no-session' | 'busy'
}

export interface MediaKeyState {
  /** `navigator.mediaSession` exists in this browser. */
  supported: boolean
  enabled: boolean
  holding: boolean
  /** Why the silent hold could not start, if it could not. */
  holdError: string | null
  presses: number
  last: MediaKeyPress | null
}

interface MediaSessionLike {
  setActionHandler(action: string, handler: (() => void) | null): void
  metadata: unknown
  playbackState?: string
}

export interface MediaKeyDeps {
  /** What a press does. Returns what happened. */
  onPress(): MediaKeyPress['outcome']
  onChange(state: MediaKeyState): void
  /** Test seams. */
  mediaSession?: MediaSessionLike | null
  makeAudio?(): HTMLAudioElement
  doc?: { visibilityState: string; hasFocus(): boolean }
  now?(): number
}

export interface MediaKeyLook {
  state(): MediaKeyState
  setEnabled(on: boolean): void
  /** Start or stop the silent hold. Starting needs a user gesture (the click on the box). */
  setHold(on: boolean): Promise<void>
  /**
   * Called about once a second while a session runs: claim the key again and start the silent
   * loop again if something paused it (the play/pause key does). Cheap when nothing is wrong.
   */
  keepAlive(): void
  destroy(): void
}

/**
 * How long the silent loop is. Chromium calls media of five seconds or less "transient"
 * (`media/base/media_content_type.cc`) and only gives such a page the media keys while its
 * `playbackState` says so (`MediaSessionImpl::IsControllable`). A longer loop is ordinary
 * media, which holds the keys by itself. The loop used to be one second.
 */
export const SILENT_LOOP_SECONDS = 6

/** Six seconds of 8 kHz mono silence as a WAV data URL. */
export function silentWavDataUrl(seconds = SILENT_LOOP_SECONDS): string {
  const rate = 8000
  const samples = rate * seconds
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:audio/wav;base64,${btoa(bin)}`
}

export function createMediaKeyLook(deps: MediaKeyDeps): MediaKeyLook {
  const session: MediaSessionLike | null =
    deps.mediaSession !== undefined
      ? deps.mediaSession
      : typeof navigator !== 'undefined' && 'mediaSession' in navigator
        ? (navigator.mediaSession as unknown as MediaSessionLike)
        : null
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : { visibilityState: 'visible', hasFocus: () => true })
  const now = deps.now ?? (() => Date.now())
  let enabled = false
  let audio: HTMLAudioElement | null = null
  let holding = false
  let holdError: string | null = null
  let presses = 0
  let last: MediaKeyPress | null = null

  const state = (): MediaKeyState => ({ supported: !!session, enabled, holding, holdError, presses, last })
  const changed = () => deps.onChange(state())

  const handler = () => {
    presses += 1
    const outcome = deps.onPress()
    last = { at: now(), hidden: doc.visibilityState === 'hidden', focused: doc.hasFocus(), holding, outcome }
    changed()
  }

  function claim(): void {
    if (!session) return
    try {
      session.setActionHandler('nexttrack', handler)
      // A name in the browser's media controls, so it is clear who holds the keys.
      const Meta = (globalThis as { MediaMetadata?: new (init: { title: string; artist: string }) => unknown }).MediaMetadata
      // (Only when it is missing: the keep-alive calls this every second, and a fresh name each time
      // would make the system's media overlay redraw.)
      if (Meta && !session.metadata) session.metadata = new Meta({ title: 'Houselights', artist: 'Next-track key = Look' })
    } catch {
      // An action this browser does not know: nothing to claim.
    }
  }

  function release(): void {
    if (!session) return
    try {
      session.setActionHandler('nexttrack', null)
      session.metadata = null
    } catch {
      // Already gone.
    }
  }

  return {
    state,
    setEnabled(on) {
      if (on === enabled) return
      enabled = on
      if (on) claim()
      else release()
      changed()
    },
    async setHold(on) {
      holdError = null
      if (!on) {
        audio?.pause()
        audio = null
        holding = false
        if (session) session.playbackState = 'none'
        changed()
        return
      }
      if (holding) return
      try {
        const a = deps.makeAudio ? deps.makeAudio() : new Audio()
        a.src = silentWavDataUrl()
        a.loop = true
        await a.play()
        audio = a
        holding = true
        if (session) session.playbackState = 'playing'
        // A playing element can reset the handlers in some browsers: claim again.
        if (enabled) claim()
      } catch (err) {
        holdError = err instanceof Error ? err.message : String(err)
        holding = false
      }
      changed()
    },
    keepAlive() {
      if (!enabled) return
      claim()
      if (!holding || !audio) return
      if (session && session.playbackState !== 'playing') session.playbackState = 'playing'
      // The play/pause key pauses the loop like any other media; without it Chrome hands the keys back.
      if (audio.paused) void audio.play().catch(() => {})
    },
    destroy() {
      release()
      audio?.pause()
      audio = null
      holding = false
    },
  }
}
