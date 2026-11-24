import { describe, expect, test } from 'bun:test'
import { composerFrom, createComposerBridge, TALK_MAX, type ComposerLike } from '../src/composer.ts'

function fakeComposer(start: { mounted?: boolean; chatId?: string | null; text?: string } = {}) {
  const state = { mounted: start.mounted ?? true, chatId: start.chatId ?? 'chat-1', text: start.text ?? '' }
  const handlers = new Set<(s: typeof state) => void>()
  const calls = { setText: [] as string[], send: 0 }
  const api: ComposerLike & { send(): Promise<void> } = {
    getState: () => ({ ...state, text: state.mounted ? state.text : '', chatId: state.mounted ? state.chatId : null }),
    onChange(h) {
      handlers.add(h)
      return () => handlers.delete(h)
    },
    setText(text) {
      calls.setText.push(text)
      state.text = text
      for (const h of handlers) h({ ...state })
    },
    focus() {},
    async send() {
      calls.send += 1
    },
  }
  const type = (text: string) => {
    state.text = text
    for (const h of handlers) h({ ...state })
  }
  const go = (chatId: string | null, mounted = true) => {
    state.chatId = chatId
    state.mounted = mounted
    for (const h of handlers) h({ ...state })
  }
  return { api, state, calls, type, go }
}

describe('composerFrom', () => {
  test('needs composer-v1 and the API', () => {
    const { api } = fakeComposer()
    expect(composerFrom({ host: { capabilities: { 'composer-v1': 1 } }, composer: api } as never)).toBe(api)
    expect(composerFrom({ host: { capabilities: {} }, composer: api } as never)).toBeNull()
    expect(composerFrom({ host: { capabilities: { 'composer-v1': 1 } } } as never)).toBeNull()
    expect(composerFrom({} as never)).toBeNull()
  })
})

describe('createComposerBridge', () => {
  test('reads the draft, trimmed, with its chat; null when no chat box is on screen', () => {
    const f = fakeComposer({ text: '  hello there  ' })
    const b = createComposerBridge(f.api)
    expect(b.available).toBe(true)
    expect(b.current()).toEqual({ chatId: 'chat-1', text: 'hello there' })
    f.go(null, false)
    expect(b.current()).toBeNull()
  })

  test('without the host API: unavailable, no draft, and landing is harmless', () => {
    const b = createComposerBridge(null)
    expect(b.available).toBe(false)
    expect(b.current()).toBeNull()
    b.sent('chat-1', 'x')
    b.landed('chat-1', 'x')
  })

  test('clears the chat box only once the line has landed', () => {
    const f = fakeComposer({ text: 'is that me?' })
    const b = createComposerBridge(f.api)
    b.sent('chat-1', 'is that me?')
    expect(f.calls.setText).toEqual([]) // sent is not landed: a failed look keeps the draft
    b.landed('chat-1', 'is that me?')
    expect(f.calls.setText).toEqual([''])
    expect(f.state.text).toBe('')
  })

  test('a failed look (nothing lands) leaves the draft where it was', () => {
    const f = fakeComposer({ text: 'still here' })
    const b = createComposerBridge(f.api)
    b.sent('chat-1', 'still here')
    expect(f.state.text).toBe('still here')
    expect(f.calls.setText).toEqual([])
  })

  test('never wipes what was typed after sending', () => {
    const f = fakeComposer({ text: 'first line' })
    const b = createComposerBridge(f.api)
    b.sent('chat-1', 'first line')
    f.type('first line, and more')
    b.landed('chat-1', 'first line')
    expect(f.calls.setText).toEqual([])
    expect(f.state.text).toBe('first line, and more')
  })

  test('another chat, or another line, leaves the box alone', () => {
    const f = fakeComposer({ text: 'hi' })
    const b = createComposerBridge(f.api)
    b.sent('chat-1', 'hi')
    b.landed('chat-2', 'hi')
    b.landed('chat-1', 'something else')
    expect(f.calls.setText).toEqual([])
    // Moved to another chat before it landed: that chat's box is not ours to clear.
    f.go('chat-2')
    b.landed('chat-1', 'hi')
    expect(f.calls.setText).toEqual([])
  })

  test('a line longer than the backend keeps lands cut, and the box keeps all of it', () => {
    const long = 'a'.repeat(TALK_MAX + 10)
    const f = fakeComposer({ text: long })
    const b = createComposerBridge(f.api)
    b.sent('chat-1', long)
    b.landed('chat-1', long.slice(0, TALK_MAX))
    expect(f.calls.setText).toEqual([])
  })

  test('each sent line clears once', () => {
    const f = fakeComposer({ text: 'once' })
    const b = createComposerBridge(f.api)
    b.sent('chat-1', 'once')
    b.landed('chat-1', 'once')
    f.type('once')
    b.landed('chat-1', 'once')
    expect(f.calls.setText).toEqual([''])
  })

  test('never presses Send', () => {
    const f = fakeComposer({ text: 'x' })
    const b = createComposerBridge(f.api)
    b.sent('chat-1', 'x')
    b.landed('chat-1', 'x')
    expect(f.calls.send).toBe(0)
  })

  test('tells listeners when the draft or the chat changes, until destroyed', () => {
    const f = fakeComposer()
    const b = createComposerBridge(f.api)
    let n = 0
    b.onChange(() => n++)
    f.type('a')
    f.go('chat-3')
    expect(n).toBe(2)
    b.destroy()
    f.type('b')
    expect(n).toBe(2)
  })
})
