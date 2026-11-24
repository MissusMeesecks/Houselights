import { describe, expect, test } from 'bun:test'
import { CURTAIN_MIN_MS, CURTAIN_MOMENTS_MAX, SESSION_MOMENTS_KEPT, curtainDue, curtainMoments, newSessionLog, noteMoment, sessionMinutes } from '../src/curtain.ts'

const same = (a: string, b: string) => a === b
const m = (time: string, scene: string, interest: number, pressed = false) => ({ time, scene, interest, pressed })

describe('D-100: what a session remembers for its curtain call', () => {
  test('a new log is empty', () => {
    expect(newSessionLog(1000)).toEqual({ startedAt: 1000, moments: [], reactions: 0 })
  })

  test('keeps moments in the order they happened', () => {
    const log = newSessionLog(0)
    noteMoment(log, m('21:01', 'a boss appears', 7), same)
    noteMoment(log, m('21:05', 'the boss falls', 9), same)
    expect(log.moments.map((x) => x.time)).toEqual(['21:01', '21:05'])
  })

  test('the same moment twice in a row is kept once, at its higher score, and stays pressed', () => {
    const log = newSessionLog(0)
    noteMoment(log, m('21:01', 'a boss appears', 5, true), same)
    noteMoment(log, m('21:02', 'a boss appears', 8), same)
    noteMoment(log, m('21:03', 'a boss appears', 3), same)
    expect(log.moments).toEqual([{ time: '21:02', scene: 'a boss appears', interest: 8, pressed: true }])
  })

  test('a blank scene is not a moment', () => {
    const log = newSessionLog(0)
    noteMoment(log, m('21:01', '   ', 9), same)
    expect(log.moments).toEqual([])
  })

  test('over the limit the least interesting goes, the oldest of them first', () => {
    const log = newSessionLog(0)
    for (let i = 0; i < SESSION_MOMENTS_KEPT; i++) noteMoment(log, m(`t${i}`, `scene ${i}`, i === 3 || i === 10 ? 1 : 6), same)
    noteMoment(log, m('late', 'the finale', 9), same)
    expect(log.moments.length).toBe(SESSION_MOMENTS_KEPT)
    expect(log.moments.some((x) => x.time === 't3')).toBe(false)
    expect(log.moments.some((x) => x.time === 't10')).toBe(true)
    expect(log.moments[log.moments.length - 1]!.time).toBe('late')
  })

  test('the closing line gets the most interesting moments, in order; between equals the later ones', () => {
    const log = newSessionLog(0)
    const scores = [4, 9, 4, 7, 4, 8, 4, 6]
    scores.forEach((s, i) => noteMoment(log, m(`t${i}`, `scene ${i}`, s), same))
    const picked = curtainMoments(log)
    expect(picked.length).toBe(CURTAIN_MOMENTS_MAX)
    expect(picked.map((x) => x.time)).toEqual(['t1', 't3', 't5', 't6', 't7'])
    expect(curtainMoments(log, 2).map((x) => x.time)).toEqual(['t1', 't5'])
  })

  test('due only after two minutes, and only with something to look back on', () => {
    const log = newSessionLog(0)
    expect(curtainDue(log, CURTAIN_MIN_MS)).toBe('nothing')
    noteMoment(log, m('21:01', 'a boss appears', 7), same)
    expect(curtainDue(log, CURTAIN_MIN_MS - 1)).toBe('short')
    expect(curtainDue(log, CURTAIN_MIN_MS)).toBe('due')
    // Attach mode describes nothing: a reaction during the session is what counts.
    const attach = newSessionLog(0)
    attach.reactions = 1
    expect(curtainDue(attach, CURTAIN_MIN_MS)).toBe('due')
  })

  test('minutes are whole and never under one', () => {
    expect(sessionMinutes(newSessionLog(0), 20_000)).toBe(1)
    expect(sessionMinutes(newSessionLog(0), 34 * 60_000 + 10_000)).toBe(34)
  })
})
