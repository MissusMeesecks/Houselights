import { expect, test, describe } from 'bun:test'
import type { LlmMessageDTO } from 'lumiverse-spindle-types'
import {
  BLOCK_IDS,
  DEFAULT_CHARACTER_INSTRUCTION,
  DEFAULT_COACH_INSTRUCTION,
  DEFAULT_CUSTOM_INSTRUCTION,
  PREVIOUS_CHARACTER_INSTRUCTIONS,
  PREVIOUS_HECKLER_INSTRUCTIONS,
  DEFAULT_REACTION_INSTRUCTION,
  DEFAULT_SELF_RECOGNITION,
  DEFAULT_SYSTEM_PROMPT,
  SCENE_HEADER,
  attachImageToBeat,
  beatMessageText,
  hushRecapText,
  curtainScene,
  curtainClosing,
  momentLines,
  hushedNote,
  usesHushed,
  buildBlockGraph,
  framingText,
  recentReactionsText,
  stanceInstruction,
  stripNameTag,
  substituteScene,
  seenViaPhrase,
} from '../src/prompt.ts'

describe('buildBlockGraph', () => {
  const graph = buildBlockGraph({
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    beat: 'BEAT',
    recentReactions: ['one', 'two'],
  })

  test('has the structural markers Lumiverse fills in', () => {
    const markers = graph.filter((b) => b.marker).map((b) => b.marker)
    expect(markers).toEqual(['world_info_before', 'world_info_after', 'chat_history'])
  })

  test('uses the native macros for character, persona and memory', () => {
    const all = graph.map((b) => b.content).join('\n')
    for (const macro of ['{{description}}', '{{personality}}', '{{scenario}}', '{{persona}}', '{{memories}}', '{{loomSummary}}']) {
      expect(all).toContain(macro)
    }
  })

  test('the beat is the last block, after history, as a user turn', () => {
    const last = graph[graph.length - 1]
    expect(last.id).toBe(BLOCK_IDS.beat)
    expect(last.role).toBe('user')
    expect(last.position).toBe('post_history')
    expect(last.depth).toBe(0)
    expect(last.content).toBe('BEAT')
  })

  test('the anti-repetition block sits after history and before the beat', () => {
    const ids = graph.map((b) => b.id)
    expect(ids.indexOf(BLOCK_IDS.recent)).toBe(ids.indexOf(BLOCK_IDS.beat) - 1)
    expect(ids.indexOf(BLOCK_IDS.recent)).toBeGreaterThan(ids.indexOf(BLOCK_IDS.history))
    expect(graph.find((b) => b.id === BLOCK_IDS.recent)?.position).toBe('post_history')
  })

  test('no recent reactions means no anti-repetition block', () => {
    const g = buildBlockGraph({ systemPrompt: 'x', beat: 'y', recentReactions: [] })
    expect(g.find((b) => b.id === BLOCK_IDS.recent)).toBeUndefined()
  })

  test('beat role can be switched to user_append for the S2 runtime check', () => {
    const g = buildBlockGraph({ systemPrompt: 'x', beat: 'y', recentReactions: [], beatRole: 'user_append' })
    expect(g[g.length - 1].role).toBe('user_append')
  })

  test('every block is a complete PromptBlockDTO', () => {
    for (const b of graph) {
      expect(typeof b.id).toBe('string')
      expect(b.enabled).toBe(true)
      expect(Array.isArray(b.injectionTrigger)).toBe(true)
      expect(b.isLocked).toBe(false)
    }
    expect(graph.length).toBeLessThan(256)
  })
})

describe('substituteScene', () => {
  test('replaces our token and drops the retired recentRoasts one', () => {
    expect(substituteScene('A {{scene}} B {{recentRoasts}}', 'X')).toBe('A X B')
  })

  test('the default instruction carries the scene', () => {
    expect(substituteScene(DEFAULT_REACTION_INSTRUCTION, 'Health at 5%.')).toContain('Health at 5%.')
    expect(substituteScene(DEFAULT_REACTION_INSTRUCTION, 'x')).not.toContain('{{scene}}')
  })
})

describe('recentReactionsText', () => {
  test('numbers them most recent last and forbids reuse', () => {
    const t = recentReactionsText(['a', 'b'])
    expect(t).toContain('1. a')
    expect(t).toContain('2. b')
    expect(t).toMatch(/never repeat/)
  })
  test('empty in, empty out', () => {
    expect(recentReactionsText([])).toBe('')
  })
  test('keeps facts: what was already recognised stays true (solo and box)', () => {
    const solo = recentReactionsText(['Aye, that is me.'])
    expect(solo).toMatch(/about wording and jokes, not facts/)
    expect(solo).toContain('anything you have already recognised or said about what is on screen stays true')
    expect(solo.trimEnd().endsWith('unless the screen shows otherwise.')).toBe(true)
    const box = recentReactionsText(['A: That is me.'], true)
    expect(box).toContain('anything the box has already recognised or said about what is on screen stays true')
  })
})

describe('attachImageToBeat', () => {
  const beat = '[OOC: Here is what is on their screen right now:\n\n(the screenshot attached)\n\nReact.]'

  test('turns the last user message carrying the beat into text + image parts', () => {
    const messages: LlmMessageDTO[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: beat },
    ]
    expect(attachImageToBeat(messages, beat, 'QUJD')).toBe(true)
    const last = messages[3].content as { type: string }[]
    expect(last[0]).toEqual({ type: 'text', text: beat })
    expect(last[1]).toEqual({ type: 'image', data: 'QUJD', mime_type: 'image/jpeg' })
    // Earlier messages untouched.
    expect(messages[1].content).toBe('hello')
  })

  test('finds the beat even if the host wrapped it', () => {
    const messages: LlmMessageDTO[] = [{ role: 'user', content: `<wrapper>\n${beat}\n</wrapper>` }]
    expect(attachImageToBeat(messages, beat, 'QUJD')).toBe(true)
  })

  test('leaves the array alone and says so when the beat is missing', () => {
    const messages: LlmMessageDTO[] = [{ role: 'user', content: 'unrelated' }]
    expect(attachImageToBeat(messages, beat, 'QUJD')).toBe(false)
    expect(messages[0].content).toBe('unrelated')
  })
})

describe('beatMessageText', () => {
  test('carries the description', () => {
    expect(beatMessageText({ scene: 'A menu.', at: 0 })).toMatch(/Seen on screen: A menu\.$/)
  })
  test('says when there was no description', () => {
    expect(beatMessageText({ scene: null, width: 1280, height: 720, at: 0 })).toContain('1280×720, not described')
  })
  test('H3: a beat kept during a hush says nobody commented', () => {
    const t = beatMessageText({ scene: 'A dragon lands.', at: 0, localTime: '1:59 AM', hushed: true })
    expect(t).toBe('[Houselights · 1:59 AM · hushed, nobody commented] Seen on screen: A dragon lands.')
    expect(beatMessageText({ scene: 'A dragon lands.', at: 0, localTime: '1:59 AM' })).not.toContain('hushed')
  })
})

describe('hushRecapText (D-067)', () => {
  test('nothing seen, nothing said', () => {
    expect(hushRecapText(undefined)).toBe('')
    expect(hushRecapText([])).toBe('')
  })
  test('lists what was seen during the hush, and invites one mention', () => {
    const t = hushRecapText([{ time: '1:59 AM', scene: 'A dragon lands.' }, { time: '2:01 AM', scene: 'The {{bridge}} burns.' }])
    expect(t).toContain('While you were hushed you kept watching, and saw:')
    expect(t).toContain('- 1:59 AM: A dragon lands.')
    expect(t).toContain('- 2:01 AM: The bridge burns.') // no macro braces reach the host
    expect(t).toContain('bring one of these up now')
  })
  test('the quiet after you spoke is not called a hush (D-070)', () => {
    const t = hushRecapText([{ time: '2:00 AM', scene: 'A dragon lands.', quiet: 'conversation' }])
    expect(t).not.toContain('hushed')
    expect(t).toContain('While {{user}} was talking with you')
    expect(hushRecapText([{ time: '2:00 AM', scene: 'x', quiet: 'conversation' }, { time: '2:01 AM', scene: 'y', quiet: 'button' }])).toContain('While you were hushed')
  })
})

describe('{{hushed}} (D-069)', () => {
  test('no hush in the moment: empty, and the token leaves no trace', () => {
    expect(hushedNote(null)).toBe('')
    expect(substituteScene('A {{scene}}\n{{hushed}}', 'X')).toBe('A X')
  })
  test('after a pressed hush: how long, and that this is the first word since', () => {
    expect(hushedNote({ kind: 'after', minutes: 4.2, earlier: false })).toBe('{{user}} hushed you for 4 minutes. That is over now, and this is the first thing you have said since.')
    expect(hushedNote({ kind: 'after', minutes: 1, earlier: false })).toContain('for a minute.')
    expect(hushedNote({ kind: 'after', minutes: 0.2, earlier: false })).toContain('for under a minute.')
  })
  test('the after-hush comment says the moment is from during the hush', () => {
    expect(hushedNote({ kind: 'after', minutes: 3, earlier: true })).toContain('happened while you had to keep quiet')
  })
  test('speaking while hushed: an override, or because they asked', () => {
    expect(hushedNote({ kind: 'during', asked: false })).toContain('too big to keep to yourself')
    expect(hushedNote({ kind: 'during', asked: true })).toContain('they asked for this one')
  })
  test('substituted wherever the instruction puts it, in any stance', () => {
    const out = substituteScene('[{{hushed}} React to: {{scene}}]', 'A boss.', seenViaPhrase('screen'), hushedNote({ kind: 'after', minutes: 2, earlier: false }))
    expect(out).toBe('[{{user}} hushed you for 2 minutes. That is over now, and this is the first thing you have said since. React to: A boss.]')
  })
  test('a Custom instruction with {{hushed}} but no {{scene}} keeps both', () => {
    const t = stanceInstruction('custom', { heckler: 'H', coach: 'C', character: 'K' }, 'If {{hushed}} is said, rant.')
    expect(t).toContain('{{scene}}')
    expect(t).toContain('{{hushed}}')
  })
})

describe('{{ifhushed}} blocks (D-071)', () => {
  const t = 'Always act in character.\n{{ifhushed}}{{hushed}} You had OPINIONS that were silenced.{{/ifhushed}}\nScene: {{scene}}'
  test('no hush: the whole block is gone, so the instruction never mentions hushes', () => {
    const out = substituteScene(t, 'A ship.')
    expect(out).not.toContain('silenced')
    expect(out).not.toContain('ifhushed')
    expect(out).toContain('Scene: A ship.')
  })
  test('a hush: the block stays, tags gone, {{hushed}} filled inside it', () => {
    const out = substituteScene(t, 'A ship.', seenViaPhrase('screen'), hushedNote({ kind: 'after', minutes: 5, earlier: false }))
    expect(out).toContain('{{user}} hushed you for 5 minutes.')
    expect(out).toContain('You had OPINIONS that were silenced.')
    expect(out).not.toContain('ifhushed')
  })
  test('a stray tag is dropped, not sent to the host', () => {
    expect(substituteScene('A {{ifhushed}}B {{scene}}', 'X')).toBe('A B X')
  })
  test('usesHushed sees either token', () => {
    expect(usesHushed('x {{hushed}}')).toBe(true)
    expect(usesHushed('{{ifhushed}}x{{/ifhushed}}')).toBe(true)
    expect(usesHushed('{{scene}}')).toBe(false)
  })
  test('a beat kept while the user talked is not called hushed', () => {
    expect(beatMessageText({ scene: 'x', at: 0, localTime: '9:20 PM', hushed: true, quiet: 'conversation' })).toBe('[Houselights · 9:20 PM · held back during the conversation, nobody commented] Seen on screen: x')
    expect(beatMessageText({ scene: 'x', at: 0, localTime: '9:20 PM', hushed: true, quiet: 'button' })).toContain('hushed, nobody commented')
  })
})

describe('stripNameTag', () => {
  test('removes a leading "Name:"', () => {
    expect(stripNameTag('Grimble: ha', 'Grimble')).toBe('ha')
    expect(stripNameTag('ha', 'Grimble')).toBe('ha')
    expect(stripNameTag('Grimble: ha')).toBe('Grimble: ha')
  })
})

describe('sources (Phase 3)', () => {
  test('seenViaPhrase names where the picture came from, with the user macro', async () => {
    const { seenViaPhrase } = await import('../src/prompt.ts')
    expect(seenViaPhrase('screen')).toBe("on {{user}}'s screen")
    expect(seenViaPhrase('webcam')).toContain('webcam')
    expect(seenViaPhrase('camera')).toContain('phone')
    expect(seenViaPhrase('file')).toContain('showed you')
    expect(seenViaPhrase('text')).toBe("on {{user}}'s screen")
  })

  test('the default instruction carries the seenVia phrase', async () => {
    const { seenViaPhrase } = await import('../src/prompt.ts')
    const out = substituteScene(DEFAULT_REACTION_INSTRUCTION, 'X', seenViaPhrase('camera'))
    expect(out).toContain('in a photo {{user}} just took with their phone')
    expect(out).not.toContain('{{seenVia}}')
  })

  test('beat text names the source and prefers the browser clock', () => {
    expect(beatMessageText({ scene: 'A face.', source: 'webcam', at: 0, localTime: '11:36 PM' })).toBe(
      '[Houselights · 11:36 PM] Seen through the webcam: A face.',
    )
    expect(beatMessageText({ scene: null, source: 'file', width: 800, height: 600, at: 0 })).toContain(
      'Shown a picture: (image, 800×600, not described)',
    )
    expect(beatMessageText({ scene: 'x', source: 'camera', at: 0 })).toContain('Seen in a phone photo')
  })
})

describe('talk-back block (D14)', () => {
  const { buildBlockGraph: build, BLOCK_IDS: ids, DEFAULT_TALK_INSTRUCTION: talk } = require('../src/prompt.ts') as typeof import('../src/prompt.ts')
  test('absent unless asked for', () => {
    const graph = build({ systemPrompt: 's', beat: 'b', recentReactions: [] })
    expect(graph.some((b) => b.id === ids.talk)).toBe(false)
  })
  test('sits after the beat, post-history, same role as the beat', () => {
    const graph = build({ systemPrompt: 's', beat: 'b', recentReactions: ['x'], talk })
    const order = graph.map((b) => b.id)
    expect(order.indexOf(ids.talk)).toBe(order.indexOf(ids.beat) + 1)
    const block = graph.find((b) => b.id === ids.talk)!
    expect(block.position).toBe('post_history')
    expect(block.role).toBe('user')
    expect(block.content).toContain('{{user}}')
    expect(block.content).toContain('{{char}}')
  })
})

describe('session context block (D15)', () => {
  const { buildBlockGraph: build, BLOCK_IDS: ids, sessionContextText } = require('../src/prompt.ts') as typeof import('../src/prompt.ts')
  test('absent unless something is confirmed', () => {
    expect(build({ systemPrompt: 's', beat: 'b', recentReactions: [] }).some((b) => b.id === ids.context)).toBe(false)
    expect(build({ systemPrompt: 's', beat: 'b', recentReactions: [], sessionContext: '  ' }).some((b) => b.id === ids.context)).toBe(false)
  })
  test('sits right after the framing, pre-history, and strips braces', () => {
    const graph = build({ systemPrompt: 's', beat: 'b', recentReactions: [], sessionContext: 'Pal{{world}}' })
    const i = graph.findIndex((b) => b.id === ids.context)
    expect(i).toBe(1)
    expect(graph[i].position).toBe('pre_history')
    expect(graph[i].content).toContain('Palworld')
    expect(graph[i].content).not.toContain('{{world}}')
    expect(sessionContextText('X')).toContain('{{user}}')
  })
  test('the lead and the scene name the game outright', () => {
    const { watchingLead, sceneWithWatching } = require('../src/prompt.ts') as typeof import('../src/prompt.ts')
    expect(watchingLead('Borderlands 2')).toContain('is Borderlands 2')
    expect(watchingLead('Border{{lands}}')).not.toContain('{{lands}}')
    expect(sceneWithWatching('A purple-haired character.', 'Borderlands 2')).toBe('Borderlands 2: A purple-haired character.')
    expect(sceneWithWatching('A scene.', null)).toBe('A scene.')
  })
})

describe('stances (D17)', () => {
  const templates = { heckler: 'H {{scene}}', coach: 'C {{scene}}', character: 'K {{scene}}' }

  test('each named stance picks its own template', () => {
    expect(stanceInstruction('heckler', templates)).toBe('H {{scene}}')
    expect(stanceInstruction('coach', templates)).toBe('C {{scene}}')
    expect(stanceInstruction('character', templates)).toBe('K {{scene}}')
  })

  test('custom text is used as written when it places the scene itself', () => {
    expect(stanceInstruction('custom', templates, 'Say what you see: {{scene}}')).toBe('Say what you see: {{scene}}')
  })

  test('custom text without {{scene}} gets the scene put in front of it', () => {
    const out = stanceInstruction('custom', templates, 'Sigh at it.')
    expect(out.startsWith(SCENE_HEADER)).toBe(true)
    expect(out.endsWith('Sigh at it.]')).toBe(true)
    expect(out).toContain('{{scene}}')
    expect(out).toContain('{{seenVia}}')
    // Already closed: no second bracket.
    expect(stanceInstruction('custom', templates, '[OOC: Sigh.]').endsWith('Sigh.]')).toBe(true)
  })

  test('an empty custom uses the default Custom instruction (D-073)', () => {
    expect(stanceInstruction('custom', templates, '')).toBe(DEFAULT_CUSTOM_INSTRUCTION)
    expect(stanceInstruction('custom', templates, null)).toBe(DEFAULT_CUSTOM_INSTRUCTION)
  })

  test('D-073: Heckler, In character and the Custom default carry a hush-only block; the Coach does not', () => {
    for (const t of [DEFAULT_REACTION_INSTRUCTION, DEFAULT_CHARACTER_INSTRUCTION, DEFAULT_CUSTOM_INSTRUCTION]) {
      expect(t).toContain('{{ifhushed}}\n{{hushed}}')
      // No hush: nothing about one, and no doubled blank lines left behind.
      const plain = substituteScene(t, 'A ship.')
      expect(plain).not.toMatch(/hush|silenced|saving up|shushed/i)
      expect(plain).not.toContain('\n\n\n')
      // A hush: the sentence and the guidance both appear.
      const hushed = substituteScene(t, 'A ship.', seenViaPhrase('screen'), hushedNote({ kind: 'after', minutes: 5, earlier: false }))
      expect(hushed).toContain('{{user}} hushed you for 5 minutes.')
      expect(hushed).toContain("You saw everything that happened while you were hushed - comment on one of them and the fact that you'd been silenced.") // D-074
      expect(hushed).not.toContain('ifhushed')
    }
    expect(DEFAULT_COACH_INSTRUCTION).not.toContain('ifhushed')
  })

  test('D-073: the previous built-ins are kept word for word, and differ from the new ones', () => {
    expect(PREVIOUS_HECKLER_INSTRUCTIONS.some((t) => t.includes('React to it, in character, as {{char}}. One or two sentences, no more. Be funny.'))).toBe(true)
    expect(PREVIOUS_HECKLER_INSTRUCTIONS.some((t) => t.includes('You have been saving up material. Spend it.'))).toBe(true) // D-073
    expect(PREVIOUS_CHARACTER_INSTRUCTIONS.some((t) => t.includes('a pointed remark about being shushed'))).toBe(true) // D-073
    expect(PREVIOUS_CHARACTER_INSTRUCTIONS.some((t) => t.includes('no act to put on, no job to do'))).toBe(true)
    expect(PREVIOUS_HECKLER_INSTRUCTIONS).not.toContain(DEFAULT_REACTION_INSTRUCTION)
    expect(PREVIOUS_CHARACTER_INSTRUCTIONS).not.toContain(DEFAULT_CHARACTER_INSTRUCTION)
  })

  test('the base block carries the framing and the self-recognition lines', () => {
    expect(framingText('Frame.', 'Recognise.')).toBe('Frame.\n\nRecognise.')
    expect(framingText('Frame.', '')).toBe('Frame.')
    expect(framingText('Frame.')).toBe('Frame.')
    const blocks = buildBlockGraph({ systemPrompt: 'Frame.', selfRecognition: DEFAULT_SELF_RECOGNITION, beat: 'B', recentReactions: [] })
    const framing = blocks.find((b) => b.id === BLOCK_IDS.framing)!
    expect(framing.content).toContain('Frame.')
    expect(framing.content).toContain('seen from the outside')
  })

  test('the default stance texts all place the scene and forbid the name tag', () => {
    for (const t of [DEFAULT_REACTION_INSTRUCTION, DEFAULT_COACH_INSTRUCTION, DEFAULT_CHARACTER_INSTRUCTION, DEFAULT_CUSTOM_INSTRUCTION]) {
      expect(t).toContain('{{scene}}')
      expect(t).toContain('{{seenVia}}')
      expect(t).toContain('No "{{char}}:" name tag')
    }
    expect(DEFAULT_COACH_INSTRUCTION).not.toContain('heckling')
    expect(DEFAULT_CHARACTER_INSTRUCTION).not.toContain('Be funny')
  })
})

describe('the curtain call (D-100)', () => {
  const moments = [
    { time: '21:04', scene: 'A dragon lands on the {{tower}}.' },
    { time: '21:19', scene: 'The player  falls\noff a cliff.' },
  ]

  test('moments are one line each, with braces and line breaks taken out', () => {
    expect(momentLines(moments)).toBe('- 21:04: A dragon lands on the tower.\n- 21:19: The player falls off a cliff.')
  })

  test('the scene says the session is over, how long it ran, and lists the moments', () => {
    const text = curtainScene({ moments, minutes: 34, autoStop: false, watching: 'Palworld' })
    expect(text).toContain('The session is over.')
    expect(text).toContain('The sharing was stopped after 34 minutes of Palworld.')
    expect(text).toContain('Nothing is on screen now.')
    expect(text).toContain('- 21:04: A dragon lands on the tower.')
    expect(text).not.toContain('{{')
  })

  test('an auto-stop says the session ran out of time', () => {
    const text = curtainScene({ moments, minutes: 30, autoStop: true })
    expect(text).toContain('It ran out of time and stopped by itself after 30 minutes.')
    expect(curtainClosing(true)).toContain('it ran out of time and stopped by itself')
    expect(curtainClosing(false)).not.toContain('ran out of time')
  })

  test('no moments (attach mode): no list, and a short session reads as about a minute', () => {
    const text = curtainScene({ moments: [], minutes: 1, autoStop: false })
    expect(text).toBe('(The session is over. The sharing was stopped after about a minute. Nothing is on screen now.)')
  })

  test('the instruction asks for one closing line and goes after the stance, in brackets', () => {
    const closing = curtainClosing(false)
    expect(closing.startsWith('\n\n[')).toBe(true)
    expect(closing.endsWith(']')).toBe(true)
    expect(closing).toContain('one closing line about the session as a whole')
    expect(closing).toContain('{{user}} stopped it')
  })

  test('the hush recap still lists its moments the same way', () => {
    expect(hushRecapText([{ time: '21:04', scene: 'A dragon lands.' }])).toContain('- 21:04: A dragon lands.')
  })
})
