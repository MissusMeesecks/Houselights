import { describe, expect, test } from 'bun:test'
import { createMediaKeyLook, silentWavDataUrl, SILENT_LOOP_SECONDS, type MediaKeyState } from '../src/mediakey.ts'

function fakeSession() {
  const handlers = new Map<string, (() => void) | null>()
  return {
    handlers,
    metadata: null as unknown,
    playbackState: 'none',
    setActionHandler(action: string, h: (() => void) | null) {
      handlers.set(action, h)
    },
  }
}

describe('Spike H1: media-key Look', () => {
  test('claims next-track only when enabled, and lets go when disabled', () => {
    const ms = fakeSession()
    const k = createMediaKeyLook({ mediaSession: ms, onPress: () => 'looked', onChange: () => {} })
    expect(ms.handlers.get('nexttrack')).toBeUndefined()
    k.setEnabled(true)
    expect(typeof ms.handlers.get('nexttrack')).toBe('function')
    k.setEnabled(false)
    expect(ms.handlers.get('nexttrack')).toBeNull()
  })
  test('a press records what happened and where the page was', () => {
    const ms = fakeSession()
    let seen: MediaKeyState | null = null
    let outcome: 'looked' | 'no-session' = 'no-session'
    const k = createMediaKeyLook({ mediaSession: ms, onPress: () => outcome, onChange: (s) => (seen = s), doc: { visibilityState: 'hidden', hasFocus: () => false }, now: () => 42 })
    k.setEnabled(true)
    ms.handlers.get('nexttrack')!()
    expect(seen!.presses).toBe(1)
    expect(seen!.last).toEqual({ at: 42, hidden: true, focused: false, holding: false, outcome: 'no-session' })
    outcome = 'looked'
    ms.handlers.get('nexttrack')!()
    expect(seen!.last?.outcome).toBe('looked')
    expect(seen!.presses).toBe(2)
  })
  test('the silent hold plays a looping silent clip and marks the session playing; a refusal is reported', async () => {
    const ms = fakeSession()
    const audio = { src: '', loop: false, played: 0, paused: 0, play() { this.played += 1; return Promise.resolve() }, pause() { this.paused += 1 } }
    const k = createMediaKeyLook({ mediaSession: ms, onPress: () => 'looked', onChange: () => {}, makeAudio: () => audio as unknown as HTMLAudioElement })
    await k.setHold(true)
    expect(audio.loop).toBe(true)
    expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true)
    expect(ms.playbackState).toBe('playing')
    expect(k.state().holding).toBe(true)
    await k.setHold(false)
    expect(audio.paused).toBe(1)
    expect(k.state().holding).toBe(false)
    const refusing = createMediaKeyLook({ mediaSession: ms, onPress: () => 'looked', onChange: () => {}, makeAudio: () => ({ play: () => Promise.reject(new Error('NotAllowedError: play() needs a gesture')), pause() {} }) as unknown as HTMLAudioElement })
    await refusing.setHold(true)
    expect(refusing.state()).toMatchObject({ holding: false, holdError: 'NotAllowedError: play() needs a gesture' })
  })
  test('no media session: unsupported, and nothing throws', () => {
    const k = createMediaKeyLook({ mediaSession: null, onPress: () => 'looked', onChange: () => {} })
    k.setEnabled(true)
    expect(k.state().supported).toBe(false)
    k.destroy()
  })
  test('the clip is silence, and longer than the five seconds Chromium calls transient', () => {
    expect(SILENT_LOOP_SECONDS).toBeGreaterThan(5)
    const bytes = atob(silentWavDataUrl().split(',')[1]!)
    expect(bytes.slice(0, 4)).toBe('RIFF')
    expect(bytes.length).toBe(44 + 16000 * SILENT_LOOP_SECONDS)
    expect([...bytes.slice(44)].every((c) => c === '\0')).toBe(true)
  })
  test('keep-alive claims the key again and restarts a paused loop; it does nothing when the key is off', async () => {
    const ms = fakeSession()
    const audio = { src: '', loop: false, played: 0, paused: false, play() { this.played += 1; this.paused = false; return Promise.resolve() }, pause() { this.paused = true } }
    const k = createMediaKeyLook({ mediaSession: ms, onPress: () => 'looked', onChange: () => {}, makeAudio: () => audio as unknown as HTMLAudioElement })
    k.keepAlive()
    expect(ms.handlers.get('nexttrack')).toBeUndefined()
    k.setEnabled(true)
    await k.setHold(true)
    // Something took the handler away and paused the loop (the play/pause key does the second).
    ms.handlers.set('nexttrack', null)
    ms.playbackState = 'paused'
    audio.paused = true
    k.keepAlive()
    expect(typeof ms.handlers.get('nexttrack')).toBe('function')
    expect(ms.playbackState).toBe('playing')
    expect(audio.played).toBe(2)
    // Nothing wrong: nothing restarted.
    k.keepAlive()
    expect(audio.played).toBe(2)
    k.setEnabled(false)
    await k.setHold(false)
    k.keepAlive()
    expect(ms.handlers.get('nexttrack')).toBeNull()
  })
})
