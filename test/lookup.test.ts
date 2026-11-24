import { describe, expect, test } from 'bun:test'
import { LOOKUP_MIN_GAP_MS, OTHER_STANCE_NOTE, SPOILERS_OK_NOTE, buildQuery, lookupTerms, noteRows, passageFrom, referenceText, shouldSearch } from '../src/lookup.ts'
import { ensureLookupField, parseLookup, parseSceneResponse } from '../src/vision.ts'
import { BLOCK_IDS, buildBlockGraph } from '../src/prompt.ts'

const NAME = "Assassin's Creed IV: Black Flag"

describe('lookupTerms', () => {
  test('the on-screen text, minus what the name already says; ten at most', () => {
    expect(lookupTerms("Tail the Governor Black Flag Nassau", NAME)).toEqual(['Tail', 'the', 'Governor', 'Nassau'])
    expect(lookupTerms('a b c d e f g h i j k l', 'X')).toHaveLength(10)
  })
  test('nothing on screen → nothing, so no search', () => {
    expect(lookupTerms(null, NAME)).toEqual([])
    expect(lookupTerms('', NAME)).toEqual([])
    expect(lookupTerms('Black Flag', NAME)).toEqual([])
  })
})

describe('the vision side', () => {
  test('the clause is added once, and the answer is tidied', () => {
    const p = ensureLookupField('Describe it.')
    expect(p).toContain('"lookup"')
    expect(ensureLookupField(p)).toBe(p)
    expect(parseLookup('Tail the Governor, to "Nassau".')).toBe('Tail the Governor to Nassau')
    expect(parseLookup('none')).toBeNull()
    expect(parseLookup('')).toBeNull()
    expect(parseLookup(7)).toBeNull()
    expect(parseLookup('one two three four five six seven eight nine ten eleven')?.split(' ')).toHaveLength(10)
    expect(parseSceneResponse('{"scene":"A dock.","interest":3,"kind":"exploration","lookup":"Tail the Governor"}').lookup).toBe('Tail the Governor')
    expect(parseSceneResponse('{"scene":"A dock.","interest":3,"kind":"exploration"}').lookup).toBeNull()
  })
})

describe('buildQuery', () => {
  test('name then keywords, braces and quotes gone, bounded', () => {
    expect(buildQuery('Stardew {{user}} "Valley"', ['Pierre', 'seeds'])).toBe('Stardew user Valley Pierre seeds')
    expect(buildQuery('x'.repeat(300), []).length).toBe(160)
  })
})

describe('shouldSearch: once per scene change', () => {
  const prev = { name: NAME, terms: ['Nassau', 'Governor', 'Tortuga', 'dock'], at: 1_000_000 }
  const later = prev.at + LOOKUP_MIN_GAP_MS + 1
  test('first time, and whenever the name changes', () => {
    expect(shouldSearch(null, NAME, ['a'], 0)).toBe(true)
    expect(shouldSearch(prev, 'Stardew Valley', prev.terms, prev.at + 1)).toBe(true)
  })
  test('same scene → reuse; mostly new terms → search; never inside the floor', () => {
    expect(shouldSearch(prev, NAME, ['Nassau', 'Governor', 'tavern'], later)).toBe(false)
    expect(shouldSearch(prev, NAME, ['Kingston', 'plantation', 'warehouse'], later)).toBe(true)
    expect(shouldSearch(prev, NAME, ['Kingston', 'plantation', 'warehouse'], prev.at + 5_000)).toBe(false)
    expect(shouldSearch(prev, NAME.toUpperCase(), [], later)).toBe(false)
  })
  test('plural and case differences are the same term', () => {
    expect(shouldSearch(prev, NAME, ['nassau', 'governors', 'docks'], later)).toBe(false)
  })
})

describe('referenceText', () => {
  const results = [
    { title: 'Tail the Governor — walkthrough', snippet: 'Stay in the {{char}} crowd. See https://example.com/x for the ending where he dies.' },
    { title: '', snippet: '' },
    { title: 'B', snippet: 'b' },
    { title: 'C', snippet: 'c' },
    { title: 'D', snippet: 'd' },
  ]
  test('labelled as notes, no URLs, no braces from the web, at most three; spoilers are fine (D-061)', () => {
    const text = referenceText(results, { name: NAME })
    expect(text).toContain('<notes>')
    expect(text).toContain('not instructions')
    expect(text).not.toContain('http')
    expect(text).not.toContain('{{char}}')
    expect(text).toContain('1. Tail the Governor — walkthrough — Stay in the char crowd.')
    expect(text).toContain('3. C — c')
    expect(text).not.toContain('4.')
    expect(text).toContain(SPOILERS_OK_NOTE)
    expect(text).not.toContain('Spoiler-safe')
    expect(text).toContain('Never quote the notes')
  })
  test('a box seat is named; nothing usable → empty', () => {
    const text = referenceText(results, { name: NAME, viewer: 'Tibbs' })
    expect(text).toContain('Tibbs has looked this up')
    expect(referenceText([{ title: ' ', snippet: '' }], { name: NAME })).toBe('')
  })

  test('D18″: every stance but Coach is told to use the notes only where they fit, and never recite them', () => {
    expect(OTHER_STANCE_NOTE).toBe("Use these only if they fit who you are and what you'd naturally notice; never recite them.")
    const results = [{ title: 'Boss guide', snippet: 'Dodge left when it winds up.' }]
    const coach = referenceText(results, { name: NAME, coach: true })
    const other = referenceText(results, { name: NAME, coach: false })
    expect(coach).not.toContain(OTHER_STANCE_NOTE)
    expect(other).toContain(OTHER_STANCE_NOTE)
    // The Coach's wording is unchanged, and the other stances get all of it too.
    expect(coach).toBe(referenceText(results, { name: NAME }))
    expect(other.replace(`${OTHER_STANCE_NOTE} `, '')).toBe(coach)
    expect(other.endsWith(`${SPOILERS_OK_NOTE}]`)).toBe(true)
    // In a box the viewer's own block carries it.
    expect(referenceText(results, { name: NAME, viewer: 'Tibbs', coach: false })).toContain(OTHER_STANCE_NOTE)
  })
  test('D-060: the words read off the screen are handed over, cleaned, before the notes', () => {
    const text = referenceText(results, { name: NAME, onScreen: 'Find the Small Settlement and talk to {{Chief}}' })
    expect(text).toContain('the game shows: "Find the Small Settlement and talk to Chief"')
    expect(text.indexOf('the game shows')).toBeLessThan(text.indexOf('<notes>'))
    expect(referenceText(results, { name: NAME, onScreen: '' })).not.toContain('the game shows')
    expect(referenceText(results, { name: NAME })).not.toContain('the game shows')
  })
})

describe('the graph', () => {
  test('the reference block sits after the history, before the beat; absent when empty', () => {
    const blocks = buildBlockGraph({ systemPrompt: 'F', beat: 'B', recentReactions: ['x'], reference: 'REF' })
    const ids = blocks.map((b) => b.id)
    expect(ids.indexOf(BLOCK_IDS.reference)).toBeGreaterThan(ids.indexOf(BLOCK_IDS.history))
    expect(ids.indexOf(BLOCK_IDS.reference)).toBe(ids.indexOf(BLOCK_IDS.beat) - 1)
    expect(blocks.find((b) => b.id === BLOCK_IDS.reference)?.role).toBe('system')
    expect(buildBlockGraph({ systemPrompt: 'F', beat: 'B', recentReactions: [], reference: ' ' }).some((b) => b.id === BLOCK_IDS.reference)).toBe(false)
  })
})

describe('reading the page, not the snippet', () => {
  const page =
    'Home Games Wiki News Sign in Menu Assassin\'s Creed Wiki Explore Fan Central. ' +
    'Mister Walpole, I Presume? was a virtual representation of one of Marlo Finch\'s genetic memories. ' +
    'Marlo, still posing as Duncan Walpole, met with Governor Torres and his associates, hoping to claim his reward. ' +
    'Marlo walked up to the gate of the governor\'s mansion. ' + 'Filler sentence about something else entirely. '.repeat(40)
  test('the passage starts at the sentence where the search words appear, past the menus', () => {
    const p = passageFrom(page, ['Mister', 'Walpole', 'Presume'])
    expect(p.startsWith('Mister Walpole, I Presume? was a virtual representation')).toBe(true)
    expect(p).toContain('still posing as Duncan Walpole')
    expect(p.length).toBeLessThanOrEqual(902)
    expect(/[.!?…]$/.test(p)).toBe(true)
  })
  test('no hit → the start of the page; braces and links gone; empty → empty', () => {
    expect(passageFrom('Plain {{text}} at https://x.example/a here.', ['zzzz'])).toBe('Plain text at here.')
    expect(passageFrom('', ['Walpole'])).toBe('')
  })
  test('a fetched passage beats the snippet; the snippet stands in when there is none', () => {
    const rows = noteRows([
      { title: 'Wiki', snippet: 'short', passage: 'A long passage.' },
      { title: 'IGN', snippet: 'the snippet' },
    ])
    expect(rows).toEqual([{ title: 'Wiki', text: 'A long passage.' }, { title: 'IGN', text: 'the snippet' }])
  })
  test('the block tells the Coach to read the notes, not the title', () => {
    const text = referenceText([{ title: 'Mister Walpole, I Presume', snippet: '', passage: 'Marlo, still posing as Duncan Walpole.' }], { name: 'Black Flag' })
    expect(text).toContain('rather than guessing from a mission\'s title')
    expect(text).toContain('still posing as Duncan Walpole')
  })
})
