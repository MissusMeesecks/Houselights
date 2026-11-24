import { describe, expect, test } from 'bun:test'
import {
  BLOCK_IDS,
  BOX_ANSWER_NOTE,
  BOX_TALK_NOTE,
  DEFAULT_BOX_FOCUS,
  boxFocusText,
  boxFramingText,
  boxRosterText,
  buildBlockGraph,
  firstSpeakerText,
  mentionedViewer,
  seatOrder,
  parseBoxLines,
  stanceBlurb,
  stripHostTail,
  substituteChar,
  BOX_SEAT_LEAD,
  HOST_TAIL_PHI,
} from '../src/prompt.ts'

const viewers = [
  { name: 'Bramble', characterId: 'c1' },
  { name: 'Tibbs', characterId: 'c2' },
  { name: 'Marlo Finch', characterId: 'c3' },
]

describe('firstSpeakerText (D13″ guard)', () => {
  test('a clean line is kept as is', () => {
    expect(firstSpeakerText('Left a bit, mate.', viewers, 'Marlo Finch')).toEqual({ text: 'Left a bit, mate.', labelledAs: null })
  })
  test('a stray own-name prefix is stripped', () => {
    expect(firstSpeakerText('Marlo Finch: Left a bit, mate.', viewers, 'Marlo Finch').text).toBe('Left a bit, mate.')
    expect(firstSpeakerText('**Marlo Finch** — Left a bit.', viewers, 'Marlo Finch').text).toBe('Left a bit.')
  })
  test('a run-on into a second speaker is cut at the first speaker', () => {
    const out = firstSpeakerText('Marlo Finch: Left a bit.\n---\nBramble: Left a lot!', viewers, 'Marlo Finch')
    expect(out).toEqual({ text: 'Left a bit.', labelledAs: null })
    expect(firstSpeakerText('Left a bit.\nBramble: Left a lot!', viewers, 'Marlo Finch').text).toBe('Left a bit.')
  })
  test("a line labelled as someone else is reported, and its text kept", () => {
    const out = firstSpeakerText('Bramble: Boo.', viewers, 'Marlo Finch')
    expect(out.labelledAs).toBe('Bramble')
    expect(out.text).toBe('Boo.')
  })
  test('quotes around the line go', () => {
    expect(firstSpeakerText('"Left a bit."', viewers, 'Marlo Finch').text).toBe('Left a bit.')
  })
})

describe('the focus block', () => {
  const seat = { name: 'Tibbs', stance: 'coach' as const }
  test('the opener: who, their stance, nobody else, no prefix', () => {
    const out = boxFocusText({ template: DEFAULT_BOX_FOCUS, seat, previous: null, talk: false })
    expect(out).toContain("Write only Tibbs's next line")
    expect(out).toContain('Tibbs coaches')
    expect(out).not.toContain('just said')
    for (const token of ['{{seat}}', '{{stance}}', '{{answerNote}}', '{{talkNote}}']) expect(out).not.toContain(token)
    expect(out).toContain('{{user}}') // a Lumiverse macro inside the coach blurb, resolved by assemble
    expect(out).toContain('do not put Tibbs\'s name in front')
    expect(out).toContain("Keep to Tibbs's own manner of speaking")
  })
  test('a later seat answers the line before it', () => {
    const out = boxFocusText({ template: DEFAULT_BOX_FOCUS, seat, previous: { name: 'Bramble', text: 'That was "bad".', characterId: 'c1' }, talk: false })
    expect(out).toContain('Bramble just said: "That was ”bad”." — answer that')
  })
  test('talk-back is noted for the opener', () => {
    const out = boxFocusText({ template: DEFAULT_BOX_FOCUS, seat, previous: null, talk: true })
    expect(out).toContain(BOX_TALK_NOTE.trim())
    expect(BOX_ANSWER_NOTE).toContain('{{previousLine}}')
  })
  test('custom stance text rides in the focus', () => {
    const out = boxFocusText({ template: DEFAULT_BOX_FOCUS, seat: { name: 'Marlo Finch', stance: 'custom', custom: 'Sigh at it. {{scene}}' }, previous: null, talk: false })
    expect(out).toContain('Marlo Finch Sigh at it.')
    expect(out).not.toContain('{{scene}}')
    expect(stanceBlurb('custom', '')).toBe(stanceBlurb('character'))
  })
  test('the graph places the focus after the beat, as a user turn', () => {
    const blocks = buildBlockGraph({ systemPrompt: 'F', beat: 'B', recentReactions: ['Bramble: x'], focus: 'FOCUS', box: true })
    const ids = blocks.map((b) => b.id)
    expect(ids.indexOf(BLOCK_IDS.focus)).toBeGreaterThan(ids.indexOf(BLOCK_IDS.beat))
    expect(blocks.find((b) => b.id === BLOCK_IDS.focus)?.role).toBe('user')
    expect(blocks.find((b) => b.id === BLOCK_IDS.recent)?.content).toContain('The box has ALREADY')
  })
})

describe("a seat's call carries the seat's own card and name (D13″, findings §6)", () => {
  const seat = { name: 'Marlo Finch', card: { description: 'A pirate; {{char}} drinks.', personality: 'Dry.', scenario: '' } }
  const graph = () =>
    buildBlockGraph({ systemPrompt: 'You are {{char}}. {{user}} plays.', beat: 'React as {{CHAR}}.', recentReactions: [], focus: 'Only {{char}}.', box: true, seat })
  test('the card slots carry the seat card, not the host macros; empty fields drop their block', () => {
    const blocks = graph()
    const by = (id: string) => blocks.find((b) => b.id === id)?.content
    expect(by(BLOCK_IDS.description)).toBe('<description>\nA pirate; Marlo Finch drinks.\n</description>')
    expect(by(BLOCK_IDS.personality)).toBe('<personality>\nDry.\n</personality>')
    expect(blocks.some((b) => b.id === BLOCK_IDS.scenario)).toBe(false)
    expect(blocks.map((b) => b.content).join('\n')).not.toContain('{{description}}')
  })
  test('{{char}} is the seat everywhere Houselights wrote it; {{user}} is left to the host', () => {
    const blocks = graph()
    const all = blocks.map((b) => b.content).join('\n')
    expect(all).not.toMatch(/\{\{\s*char\s*\}\}/i)
    expect(all).toContain('React as Marlo Finch.')
    expect(all).toContain('{{user}} plays.')
    expect(blocks.find((b) => b.id === BLOCK_IDS.framing)?.content).toContain(substituteChar(BOX_SEAT_LEAD, 'Marlo Finch'))
    expect(blocks.find((b) => b.id === BLOCK_IDS.persona)?.content).toContain('{{persona}}')
  })
  test('no card: the slots are left out, the name still stands', () => {
    const blocks = buildBlockGraph({ systemPrompt: 'F', beat: 'B', recentReactions: [], focus: 'Only {{char}}.', box: true, seat: { name: 'Lumia', card: null } })
    const ids = blocks.map((b) => b.id)
    expect(ids).not.toContain(BLOCK_IDS.description)
    expect(ids).not.toContain(BLOCK_IDS.personality)
    expect(blocks.find((b) => b.id === BLOCK_IDS.focus)?.content).toBe('Only Lumia.')
  })
  test('solo calls keep the host macros', () => {
    const blocks = buildBlockGraph({ systemPrompt: 'You are {{char}}.', beat: 'B', recentReactions: [] })
    expect(blocks.find((b) => b.id === BLOCK_IDS.description)?.content).toContain('{{description}}')
    expect(blocks.find((b) => b.id === BLOCK_IDS.framing)?.content).toBe('You are {{char}}.')
  })
  test("the seat's own post-history instructions ride last as a block, char-substituted; solo has none", () => {
    const blocks = buildBlockGraph({ systemPrompt: 'F', beat: 'B', recentReactions: [], focus: 'Only {{char}}.', box: true, seat: { name: 'Dot', card: { description: 'x', postHistoryInstructions: 'Keep {{char}} gentle.' } } })
    const last = blocks[blocks.length - 1]
    expect(last.id).toBe(BLOCK_IDS.phi)
    expect(last.content).toBe('Keep Dot gentle.')
    expect(last.role).toBe('system')
    expect(last.position).toBe('post_history')
    expect(buildBlockGraph({ systemPrompt: 'F', beat: 'B', recentReactions: [] }).some((b) => b.id === BLOCK_IDS.phi)).toBe(false)
  })
  test('substituteChar is case-insensitive and safe with $ in names', () => {
    expect(substituteChar('{{char}} and {{ Char }}', 'Mr. $5')).toBe('Mr. $5 and Mr. $5')
  })
})

describe('roster (R6)', () => {
  test('R6 roster block only for viewers with roster fields', () => {
    const bv = [{ name: 'Bramble', stance: 'heckler' as const }, { name: 'Lumia', stance: 'heckler' as const, roster: { definition: 'A small light.', personality: 'Bright.', behavior: '' } }]
    const text = boxRosterText(bv)
    expect(text).toContain('<viewer name="Lumia">')
    expect(text).not.toContain('Bramble')
    expect(boxRosterText(bv.slice(0, 1))).toBe('')
  })
})

describe('framing, mentions, parser', () => {
  const bv = [{ name: 'Bramble', stance: 'heckler' as const }, { name: 'Tibbs', stance: 'coach' as const }, { name: 'Marlo Finch', stance: 'character' as const }]
  test('the framing lists the viewers in prose', () => {
    expect(boxFramingText('Viewers: {{viewers}}.', bv)).toBe('Viewers: Bramble, Tibbs and Marlo Finch.')
    expect(boxFramingText('Viewers: {{viewers}}.', bv.slice(0, 1))).toBe('Viewers: Bramble.')
  })
  test('@mentions pick who opens, longest name first, first name allowed', () => {
    const names = bv.map((v) => v.name)
    expect(mentionedViewer('hey @Tibbs what now', names)).toBe('Tibbs')
    expect(mentionedViewer('@marlo finch is that you?', names)).toBe('Marlo Finch')
    expect(mentionedViewer('@Marlo!', names)).toBe('Marlo Finch')
    expect(mentionedViewer('nobody here', names)).toBeNull()
  })
  test('the parser still reads the fallback Name: prefix for the Pane', () => {
    expect(parseBoxLines('Bramble: a\n---\nTibbs: b', viewers, 4).map((l) => [l.name, l.text])).toEqual([['Bramble', 'a'], ['Tibbs', 'b']])
    expect(parseBoxLines('1. Tibbs: Hm.\n2. Bramble:', viewers, 2)).toEqual([{ name: 'Tibbs', text: 'Hm.', characterId: 'c2' }])
  })
})

describe("stripHostTail: the host's trailing additions (findings §6)", () => {
  const nudge = '[Write the next reply only as GRIMBLE.]'
  const phi = 'GRIMBLE: SHOUT.'
  const messages = [
    { role: 'system' as const, content: 'setup' },
    { role: 'user' as const, content: 'focus' },
    { role: 'system' as const, content: phi },
    { role: 'user' as const, content: nudge },
  ]
  const breakdown = [
    { type: 'block', name: HOST_TAIL_PHI, role: 'system', content: phi, marker: 'jailbreak' },
    { type: 'utility', name: 'Empty Send Nudge', role: 'user', content: nudge },
  ]
  test('the nudge always goes; the primary PHI only from a seat call', () => {
    const solo = stripHostTail(messages, breakdown, { dropPostHistory: false })
    expect(solo.messages.map((m) => m.content)).toEqual(['setup', 'focus', phi])
    expect(solo.dropped).toEqual(['Empty Send Nudge'])
    const seat = stripHostTail(messages, breakdown, { dropPostHistory: true })
    expect(seat.messages.map((m) => m.content)).toEqual(['setup', 'focus'])
    expect(seat.dropped).toEqual([HOST_TAIL_PHI, 'Empty Send Nudge'])
  })
  test('matches the last identical message only, by role and exact text; nothing without a breakdown', () => {
    const twice = [{ role: 'user' as const, content: nudge }, ...messages]
    const out = stripHostTail(twice, breakdown, { dropPostHistory: false })
    expect(out.messages.filter((m) => m.content === nudge)).toHaveLength(1)
    expect(out.messages[0]?.content).toBe(nudge)
    expect(stripHostTail(messages, undefined, { dropPostHistory: true }).messages).toHaveLength(4)
    expect(stripHostTail(messages, [{ type: 'utility', name: 'Empty Send Nudge', role: 'user', content: 'other' }], { dropPostHistory: false }).dropped).toEqual([])
  })
  test('the input is not mutated', () => {
    stripHostTail(messages, breakdown, { dropPostHistory: true })
    expect(messages).toHaveLength(4)
  })
})

describe('seatOrder: who speaks this Look', () => {
  const names = ['Wren', 'Marlo', 'GRIMBLE', 'Ottilie', 'Pell', 'Quill']
  test('the opener first, then whoever has waited longest, up to the cap', () => {
    const spoke = new Map([
      ['Wren', 50],
      ['Marlo', 40],
      ['GRIMBLE', 30],
      ['Ottilie', 20],
    ])
    // Pell and Quill have never spoken: they wait longest, so they follow the opener.
    const order = seatOrder(names, 'Marlo', 4, spoke, () => 0.5)
    expect(order[0]).toBe('Marlo')
    expect(order.slice(1, 3).sort()).toEqual(['Pell', 'Quill'])
    expect(order[3]).toBe('Ottilie')
  })
  test('over a run of Looks, the last names in the list get seats, not only the opener turn', () => {
    const spoke = new Map<string, number>()
    const counts = new Map(names.map((n) => [n, 0]))
    let t = 0
    for (let look = 0; look < 6; look++) {
      const order = seatOrder(names, names[look % names.length]!, 4, spoke, Math.random)
      for (const n of order) {
        counts.set(n, counts.get(n)! + 1)
        spoke.set(n, ++t)
      }
    }
    // 6 Looks × 4 seats = 24 seats among 6 viewers: everyone speaks at least 3 times.
    for (const [, c] of counts) expect(c).toBeGreaterThanOrEqual(3)
  })
  test('never more seats than viewers, never fewer than one', () => {
    expect(seatOrder(['A', 'B'], 'B', 4, new Map())).toEqual(['B', 'A'])
    expect(seatOrder(['A', 'B'], 'A', 0, new Map())).toEqual(['A'])
  })
})
