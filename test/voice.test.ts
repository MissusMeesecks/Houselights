import { describe, expect, test } from 'bun:test'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import { createVoice, describeSttError, spokenText, sttCandidates, sttReasonText, type VoiceSettings } from '../src/voice.ts'
import type { ReactionResult } from '../src/capture.ts'

/** A fake host: TTS that resolves when told, STT that yields a transcript when told. */
function fakeHost(opts: { tts?: boolean; stt?: boolean; media?: boolean; failMessageIds?: boolean; providers?: { id: string; available: boolean }[]; refuse?: string[] } = {}) {
  const spoken: { input: unknown; options?: unknown }[] = []
  let ttsListener: ((speaking: boolean) => void) | null = null
  let speakingNow = false
  let resolveSpeak: (() => void) | null = null
  const tts = {
    speak(input: { text?: string; messageId?: string }, options?: unknown) {
      spoken.push({ input, options })
      if (opts.failMessageIds && input.messageId) return Promise.reject(new Error('Not the active chat'))
      speakingNow = true
      ttsListener?.(true)
      return new Promise<void>((resolve) => {
        resolveSpeak = () => {
          speakingNow = false
          ttsListener?.(false)
          resolve()
        }
      })
    },
    stops: 0,
    stop() {
      this.stops += 1
      resolveSpeak?.()
    },
    isSpeaking: () => speakingNow,
    subscribe(l: (speaking: boolean) => void) {
      ttsListener = l
      return () => {
        ttsListener = null
      }
    },
  }
  const sessions: { options: Record<string, unknown>; resolve(text: string): void; reject(err: Error): void; cancelled: boolean }[] = []
  const stt = {
    listProviders: () =>
      (opts.providers ?? [{ id: 'whistle', available: true }]).map((p) => ({ ...p, name: p.id, onDevice: p.id === 'whistle', supportsAudioTranscription: true })),
    prepare: async () => {},
    start(options: Record<string, unknown>) {
      if ((globalThis as { __sttBusy?: boolean }).__sttBusy) throw new Error('STT_BUSY: another extension owns the microphone')
      // `host` stands for Lumiverse's own setting (no provider passed).
      if (opts.refuse?.includes(String(options.provider ?? 'host'))) throw new Error('STT_UNAVAILABLE:secureContext')
      let resolveResult!: (t: { text: string; provider: string }) => void
      let rejectResult!: (e: Error) => void
      const result = new Promise<{ text: string; provider: string }>((res, rej) => {
        resolveResult = res
        rejectResult = rej
      })
      const session = {
        provider: 'whistle',
        ready: Promise.resolve(),
        result,
        stop: async () => result,
        cancel() {
          entry.cancelled = true
          const e = new Error('cancelled')
          e.name = 'AbortError'
          rejectResult(e)
        },
      }
      const entry = { options, resolve: (text: string) => resolveResult({ text, provider: 'whistle' }), reject: rejectResult, cancelled: false }
      sessions.push(entry)
      return session
    },
    transcribe: async () => ({ text: '', provider: 'whistle' as const }),
  }
  const granted = opts.media === false ? [] : ['generation', 'media']
  const ctx = {
    host: { capabilities: { ...(opts.tts === false ? {} : { 'text-to-speech-v1': 1 }), ...(opts.stt === false ? {} : { 'speech-to-text-v1': 1 }) } },
    ...(opts.tts === false ? {} : { tts }),
    ...(opts.stt === false ? {} : { stt }),
    permissions: { getGranted: async () => granted, request: async () => [...granted, 'media'] },
  } as unknown as SpindleFrontendContext
  return { ctx, tts, spoken, sessions, finishSpeaking: () => resolveSpeak?.() }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

function settings(over: Partial<VoiceSettings> = {}): VoiceSettings {
  return { voiceOut: true, sttProvider: 'whistle', voiceAutoSend: true, voiceAutoSendDelaySeconds: 3, cooldownSeconds: 10, boxVoices: {}, ...over }
}

const solo: ReactionResult = { type: 'reaction_result', ok: true, trigger: 'look', text: 'Left a bit.', messageId: 'm1' }

describe('availability and gating', () => {
  test('both halves need their capability, the API and media', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings() })
    await settle()
    expect(v.availability()).toMatchObject({ tts: true, stt: true, media: true })
    expect(v.canSpeak()).toBe(true)
    expect(v.canListen()).toBe(true)
    const noMedia = createVoice({ ctx: fakeHost({ media: false }).ctx, settings: () => settings() })
    await settle()
    expect(noMedia.canSpeak()).toBe(false)
    expect(noMedia.canListen()).toBe(false)
    const noApis = createVoice({ ctx: fakeHost({ tts: false, stt: false }).ctx, settings: () => settings() })
    await settle()
    expect(noApis.availability()).toMatchObject({ tts: false, stt: false, providers: [] })
    expect(noApis.listen({ onStatus() {}, onTranscript() {}, onError() {}, onEnd() {} })).toBe(false)
  })
  test('voice out off: nothing is spoken, nothing held', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings({ voiceOut: false }) })
    await settle()
    v.speakReaction(solo)
    await settle()
    expect(h.spoken).toHaveLength(0)
    expect(v.tickHold()).toBeNull()
  })
})

describe('speaking', () => {
  test('a solo reaction plays by message id; lines queue in order, each awaiting the last', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings() })
    await settle()
    v.speakReaction(solo)
    v.speakReaction({
      type: 'reaction_result',
      ok: true,
      trigger: 'look',
      text: '',
      lines: [
        { name: 'Bramble', text: 'Ha.', characterId: 'c1', messageId: 'm2' },
        { name: 'Tibbs', text: 'Tibbs: Hm.', characterId: null },
      ],
    }, (line) => (line.name === 'Tibbs' ? 'council:w' : null))
    await settle()
    expect(h.spoken.map((s) => s.input)).toEqual([{ messageId: 'm1' }])
    h.finishSpeaking()
    await settle()
    expect(h.spoken.map((s) => s.input)).toEqual([{ messageId: 'm1' }, { messageId: 'm2' }])
    h.finishSpeaking()
    await settle()
    expect(h.spoken[2]).toEqual({ input: { text: 'Hm.' }, options: undefined })
  })
  test('a council line uses that viewer\'s connection; a failed message id falls back to text', async () => {
    const h = fakeHost({ failMessageIds: true })
    const v = createVoice({ ctx: h.ctx, settings: () => settings({ boxVoices: { 'council:w': 'tts-2' } }) })
    await settle()
    v.speakReaction({ type: 'reaction_result', ok: true, trigger: 'look', text: '', lines: [{ name: 'Tibbs', text: 'Hm.', characterId: null, messageId: 'm9' }] }, () => 'council:w')
    await settle()
    expect(h.spoken.map((s) => [s.input, s.options])).toEqual([
      [{ messageId: 'm9' }, undefined],
      [{ text: 'Hm.' }, { connectionId: 'tts-2' }],
    ])
  })
  test('stop drops the queue and stops the host', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings() })
    await settle()
    v.speakReaction(solo)
    v.speakReaction({ ...solo, messageId: 'm2' })
    await settle()
    v.stop()
    await settle()
    expect(h.tts.stops).toBe(1)
    expect(h.spoken).toHaveLength(1)
    v.speakReaction({ ...solo, messageId: 'm3' })
    await settle()
    expect(h.spoken.map((s) => s.input)).toEqual([{ messageId: 'm1' }, { messageId: 'm3' }])
  })
  test('never speaks a failed result or an empty one', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings() })
    await settle()
    v.speakReaction({ type: 'reaction_result', ok: false, trigger: 'look', reason: 'boring' })
    v.speakReaction({ type: 'reaction_result', ok: true, trigger: 'look', text: '   ' })
    await settle()
    expect(h.spoken).toHaveLength(0)
  })
})

describe('the pacing gate', () => {
  test('held while speaking, then for one cooldown after', async () => {
    let t = 1_000_000
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings({ cooldownSeconds: 10 }), now: () => t })
    await settle()
    expect(v.tickHold()).toBeNull()
    v.speakReaction(solo)
    await settle()
    expect(v.tickHold()).toBe('the character is still speaking')
    h.finishSpeaking()
    await settle()
    t += 5_000
    expect(v.tickHold()).toBe('letting the last line land')
    t += 6_000
    expect(v.tickHold()).toBeNull()
  })
})

describe('push-to-talk', () => {
  const cbs = () => {
    const log: string[] = []
    return {
      log,
      callbacks: {
        onStatus: (phase: string) => log.push(`status:${phase}`),
        onTranscript: (text: string) => log.push(`text:${text}`),
        onError: (m: string) => log.push(`error:${m}`),
        onEnd: () => log.push('end'),
      },
    }
  }
  test('the mic stops speech first, starts one non-continuous session with the chosen provider, and delivers the transcript', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings({ sttProvider: 'whistle' }) })
    await settle()
    v.speakReaction(solo)
    await settle()
    const c = cbs()
    expect(v.listen(c.callbacks)).toBe(true)
    expect(h.tts.stops).toBe(1)
    expect(v.listening()).toBe(true)
    expect(h.sessions[0]?.options).toMatchObject({ provider: 'whistle', continuous: false })
    expect(v.listen(c.callbacks)).toBe(false) // one at a time
    h.sessions[0]!.resolve('  is that a reef? ')
    await settle()
    expect(c.log).toEqual(['text:is that a reef?', 'end'])
    expect(v.listening()).toBe(false)
  })
  test('the default choice leaves the provider to the host', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings({ sttProvider: 'default' }) })
    await settle()
    v.listen(cbs().callbacks)
    expect(h.sessions[0]?.options.provider).toBeUndefined()
  })
  test('cancel is silent; STT_BUSY is explained', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings() })
    await settle()
    const c = cbs()
    v.listen(c.callbacks)
    v.cancelListening()
    await settle()
    expect(c.log).toEqual(['end'])
    expect(h.sessions[0]?.cancelled).toBe(true)
    ;(globalThis as { __sttBusy?: boolean }).__sttBusy = true
    const c2 = cbs()
    expect(v.listen(c2.callbacks)).toBe(false)
    expect(c2.log[0]).toBe('error:Another extension has the microphone right now.')
    ;(globalThis as { __sttBusy?: boolean }).__sttBusy = false
  })
})

describe('helpers', () => {
  test('spokenText strips a stray name prefix', () => {
    expect(spokenText('Marlo Finch: Left a bit.', 'Marlo Finch')).toBe('Left a bit.')
    expect(spokenText('**GRIMBLE** — HA!', 'GRIMBLE')).toBe('HA!')
    expect(spokenText('Left a bit.', 'Marlo Finch')).toBe('Left a bit.')
    expect(spokenText(' plain ', null)).toBe('plain')
  })
  test('describeSttError', () => {
    expect(describeSttError(new Error('NotAllowedError: Permission denied'))).toContain('microphone permission')
    expect(describeSttError(new Error('SPINDLE_FRONTEND_INACTIVE'))).toContain('reloaded')
    expect(describeSttError('weird')).toBe('weird')
  })
})

describe('one speaker in the box (D-054)', () => {
  test('only the chosen viewer\'s lines are spoken; the rest are skipped', async () => {
    const h = fakeHost()
    const v = createVoice({ ctx: h.ctx, settings: () => settings() })
    await settle()
    const ids: Record<string, string> = { Bramble: 'c1', Tibbs: 'council:w', Marlo: 'c3' }
    v.speakReaction(
      { type: 'reaction_result', ok: true, trigger: 'look', text: '', lines: [
        { name: 'Bramble', text: 'Ha.', characterId: 'c1', messageId: 'm1' },
        { name: 'Tibbs', text: 'Hm.', characterId: null },
        { name: 'Marlo', text: 'Aye.', characterId: 'c3', messageId: 'm3' },
      ] },
      (line) => ids[line.name ?? ''] ?? null,
      'c3',
    )
    await settle()
    expect(h.spoken.map((s) => s.input)).toEqual([{ messageId: 'm3' }])
  })
})

describe('the phone mic (D-057)', () => {
  const providers = [
    { id: 'webspeech', available: true },
    { id: 'whistle', available: false },
    { id: 'connection', available: true },
  ]
  test('a computer gets exactly its own choice; a phone its own', () => {
    expect(sttCandidates({ sttProvider: 'whistle', sttProviderPhone: 'webspeech' }, false, providers)).toEqual(['whistle'])
    expect(sttCandidates({ sttProvider: 'default' }, false, providers)).toEqual([undefined])
    expect(sttCandidates({ sttProvider: 'whistle', sttProviderPhone: 'webspeech' }, true, providers)).toEqual(['webspeech'])
    expect(sttCandidates({ sttProvider: 'whistle', sttProviderPhone: 'default' }, true, providers)).toEqual([undefined])
  })
  test('Automatic: Lumiverse\'s setting, then the available ones in order, skipping what this phone lacks', () => {
    expect(sttCandidates({ sttProvider: 'whistle' }, true, providers)).toEqual([undefined, 'webspeech', 'connection'])
    expect(sttCandidates({ sttProvider: 'whistle', sttProviderPhone: 'auto' }, true, [])).toEqual([undefined])
  })
  test('on a phone, a recogniser refused on the spot hands over to the next inside the same press', async () => {
    const h = fakeHost({ providers, refuse: ['host'] })
    const v = createVoice({ ctx: h.ctx, settings: () => settings({ sttProvider: 'whistle' }), phone: () => true })
    await settle()
    const log: string[] = []
    expect(v.listen({ onStatus() {}, onTranscript: (t) => log.push(t), onError: (m) => log.push(`error:${m}`), onEnd() {} })).toBe(true)
    expect(h.sessions).toHaveLength(1)
    expect(h.sessions[0]?.options.provider).toBe('webspeech')
    h.sessions[0]!.resolve('hello')
    await settle()
    expect(log).toEqual(['hello'])
  })
  test('the computer does not fall back: its choice failing says why', async () => {
    const h = fakeHost({ providers, refuse: ['whistle'] })
    const v = createVoice({ ctx: h.ctx, settings: () => settings({ sttProvider: 'whistle' }), phone: () => false })
    await settle()
    const log: string[] = []
    expect(v.listen({ onStatus() {}, onTranscript() {}, onError: (m) => log.push(m), onEnd() {} })).toBe(false)
    expect(log[0]).toContain('https')
  })
  test('reasons and the plain-http hint read as plain language', () => {
    expect(sttReasonText('webSpeech')).toContain('Firefox')
    expect(sttReasonText('secureContext')).toContain('https')
    expect(describeSttError(new Error('Microphone permission denied'), false)).toContain('plain http')
    expect(describeSttError(new Error('Microphone permission denied'), true)).not.toContain('plain http')
    expect(describeSttError(new Error('Speech recognition error: network'))).toContain('online service')
  })
})
