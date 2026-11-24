import { describe, expect, test } from 'bun:test'
import { NO_LIMIT, NO_LIMIT_MAX, confirmWatching, screenCheck, sessionEnded, sessionStarted, storedWatching, watchingFrom } from '../src/watching.ts'

const clean = (t: unknown): string | null => (typeof t === 'string' && t.trim() ? t.trim() : null)
const fresh = (stored = {}) => watchingFrom(stored, clean)

describe('rule 1: the name belongs to a session', () => {
  test('a session ending stops the name being used and keeps it as the last name', () => {
    const w = fresh()
    sessionStarted(w)
    confirmWatching(w, 'Palworld', true)
    expect(w.confirmed).toBe('Palworld')
    expect(sessionEnded(w)).toBe(true)
    expect(w.confirmed).toBeNull()
    expect(w.lastConfirmed).toBe('Palworld')
    expect(w.doubt).toBe('session')
  })

  test('the next Start asks, and uses nothing until answered', () => {
    const w = fresh()
    sessionStarted(w)
    confirmWatching(w, 'Palworld', true)
    sessionEnded(w)
    expect(sessionStarted(w)).toBe('asking')
    expect(w.confirmed).toBeNull()
    expect(w.lastConfirmed).toBe('Palworld')
    confirmWatching(w, 'Palworld', true) // the user taps ✓
    expect(w.confirmed).toBe('Palworld')
    expect(w.lastConfirmed).toBeNull()
    expect(w.doubt).toBeNull()
  })

  test('changing it instead uses the new name', () => {
    const w = fresh()
    confirmWatching(w, 'Palworld', true)
    sessionEnded(w)
    sessionStarted(w)
    confirmWatching(w, 'Blender', true)
    expect(w.confirmed).toBe('Blender')
    expect(w.lastConfirmed).toBeNull()
  })

  test('a plain Look outside a session: nothing until confirmed, then that name', () => {
    const w = fresh()
    confirmWatching(w, 'Palworld', true)
    sessionEnded(w)
    expect(w.confirmed).toBeNull() // a Look now carries no name
    confirmWatching(w, 'Palworld', false) // confirmed between sessions
    expect(w.confirmed).toBe('Palworld')
    expect(w.inSession).toBe(false)
  })

  test('a name confirmed since the last session ended carries into the next one, and ends with it', () => {
    const w = fresh()
    confirmWatching(w, 'Blender', false)
    expect(sessionStarted(w)).toBe('kept')
    expect(w.confirmed).toBe('Blender')
    expect(sessionEnded(w)).toBe(true)
    expect(w.confirmed).toBeNull()
  })

  test('a session that never reported its end (the browser closed): the next Start still asks', () => {
    const w = fresh()
    sessionStarted(w)
    confirmWatching(w, 'Palworld', true)
    // no sessionEnded
    expect(sessionStarted(w)).toBe('expired')
    expect(w.confirmed).toBeNull()
    expect(w.lastConfirmed).toBe('Palworld')
  })

  test('a name stored by an older version is treated as from a session', () => {
    const w = fresh({ confirmed: 'Palworld' })
    expect(w.confirmed).toBe('Palworld')
    expect(sessionStarted(w)).toBe('expired')
    expect(w.lastConfirmed).toBe('Palworld')
  })

  test('clearing forgets the last name too', () => {
    const w = fresh()
    confirmWatching(w, 'Palworld', true)
    sessionEnded(w)
    confirmWatching(w, null, false)
    expect(w.confirmed).toBeNull()
    expect(w.lastConfirmed).toBeNull()
    expect(sessionStarted(w)).toBe('none')
  })

  test('ending a session with no name changes nothing', () => {
    const w = fresh()
    expect(sessionEnded(w)).toBe(false)
    expect(w.lastConfirmed).toBeNull()
  })

  test('what is stored comes back the same', () => {
    const w = fresh()
    confirmWatching(w, 'Palworld', true)
    sessionEnded(w)
    const again = fresh(storedWatching(w))
    expect(again.confirmed).toBeNull()
    expect(again.lastConfirmed).toBe('Palworld')
    expect(again.doubt).toBe('session')
  })
})

describe('rule 2: the name is checked against the screen', () => {
  const playing = () => {
    const w = fresh()
    sessionStarted(w)
    confirmWatching(w, 'Palworld', true)
    return w
  }

  test('two "no"s in a row put the name in doubt', () => {
    const w = playing()
    expect(screenCheck(w, 'no', 'exploration')).toEqual({ counted: 'no', doubted: false })
    expect(w.confirmed).toBe('Palworld')
    expect(screenCheck(w, 'no', 'combat')).toEqual({ counted: 'no', doubted: true })
    expect(w.confirmed).toBeNull()
    expect(w.lastConfirmed).toBe('Palworld')
    expect(w.doubt).toBe('screen')
  })

  test('a "yes" between them starts the count again', () => {
    const w = playing()
    screenCheck(w, 'no', 'exploration')
    screenCheck(w, 'yes', 'exploration')
    expect(screenCheck(w, 'no', 'exploration').doubted).toBe(false)
    expect(w.confirmed).toBe('Palworld')
  })

  test('"unsure" changes nothing: it neither counts nor clears', () => {
    const w = playing()
    screenCheck(w, 'no', 'exploration')
    expect(screenCheck(w, 'unsure', 'other')).toEqual({ counted: 'unsure', doubted: false })
    expect(w.noCount).toBe(1)
    expect(screenCheck(w, 'no', 'exploration').doubted).toBe(true)
  })

  test('a "no" on a menu or a loading screen is taken as "unsure"', () => {
    const w = playing()
    expect(screenCheck(w, 'no', 'menu')).toEqual({ counted: 'unsure', doubted: false })
    expect(screenCheck(w, 'no', 'loading')).toEqual({ counted: 'unsure', doubted: false })
    expect(w.noCount).toBe(0)
    expect(w.confirmed).toBe('Palworld')
  })

  test('no answer, or no confirmed name: nothing happens', () => {
    const w = playing()
    expect(screenCheck(w, null, 'combat')).toEqual({ counted: null, doubted: false })
    const none = fresh()
    expect(screenCheck(none, 'no', 'combat')).toEqual({ counted: null, doubted: false })
  })

  test('in doubt, nothing is used until the user answers', () => {
    const w = playing()
    screenCheck(w, 'no', 'combat')
    screenCheck(w, 'no', 'combat')
    expect(w.confirmed).toBeNull()
    expect(screenCheck(w, 'no', 'combat')).toEqual({ counted: null, doubted: false }) // nothing to check
    confirmWatching(w, 'Blender', true)
    expect(w.confirmed).toBe('Blender')
    expect(w.noLimit).toBe(NO_LIMIT) // a different name: the usual two
  })

  test('"yes, still that" against the screen is believed for longer each time, up to a cap, until the session ends', () => {
    const w = playing()
    const doubtIt = () => { while (w.confirmed) screenCheck(w, 'no', 'combat') }
    doubtIt()
    confirmWatching(w, 'Palworld', true)
    expect(w.noLimit).toBe(4)
    for (let i = 0; i < 3; i++) expect(screenCheck(w, 'no', 'combat').doubted).toBe(false)
    expect(screenCheck(w, 'no', 'combat').doubted).toBe(true)
    confirmWatching(w, 'palworld', true) // spelled differently, same game
    expect(w.noLimit).toBe(8)
    doubtIt()
    confirmWatching(w, 'Palworld', true)
    expect(w.noLimit).toBe(NO_LIMIT_MAX)
    sessionEnded(w)
    sessionStarted(w)
    confirmWatching(w, 'Palworld', true) // answering the session's question is not overruling the screen
    expect(w.noLimit).toBe(NO_LIMIT)
  })
})
