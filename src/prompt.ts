/**
 * The prompt for a reaction — what `spindle.assemble()` is given.
 *
 * `assemble` runs Lumiverse's native assembly with the chat's history,
 * character and persona macros, world info and memories, but the blocks you
 * hand it REPLACE the saved preset's block graph. So Houselights brings its
 * own small graph, shaped like Lumiverse's default preset: a framing prompt
 * (who the character is, what they're doing — watching over your shoulder),
 * the structural markers that let the host insert world info and history,
 * the memory macros, and then, after the history, the beat: what was just
 * seen and the instruction to react to it.
 *
 * Nothing in here touches `spindle`, so it is unit-testable.
 */

import type { AssemblyBreakdownEntryDTO, LlmMessageDTO, PromptBlockDTO } from 'lumiverse-spindle-types'
import type { BoxLine, CaptureSource, Stance } from './capture.ts'

export const BLOCK_IDS = {
  framing: 'houselights-framing',
  context: 'houselights-context',
  worldInfoBefore: 'houselights-wi-before',
  description: 'houselights-description',
  personality: 'houselights-personality',
  scenario: 'houselights-scenario',
  persona: 'houselights-persona',
  roster: 'houselights-box-roster',
  focus: 'houselights-box-focus',
  phi: 'houselights-seat-phi',
  worldInfoAfter: 'houselights-wi-after',
  cortex: 'houselights-cortex',
  summary: 'houselights-summary',
  memories: 'houselights-memories',
  history: 'houselights-history',
  recent: 'houselights-recent',
  reference: 'houselights-reference',
  beat: 'houselights-beat',
  talk: 'houselights-talk',
} as const

/**
 * The framing prompt. `{{char}}`, `{{user}}` and friends are Lumiverse macros,
 * resolved natively by `assemble`. The character's own description, personality
 * and scenario are separate blocks below, so this stays about the situation.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are {{char}}. Stay fully in character at all times.

You are currently looking over {{user}}'s shoulder at their screen. You can see
what they see. You are a spectator — you cannot play, click, help, or intervene.
You can only comment, and you do so in your own voice.`

/**
 * D17 base block, part two: self-recognition. Always on, under every stance.
 * Two sentences, so it does not send every character hunting for themselves.
 */
export const DEFAULT_SELF_RECOGNITION = `If {{char}} appears on screen — your own face, your name, a character who is you (for example, the game's hero is you) — you recognise yourself: that is you, seen from the outside. React to it only when it matters; don't go looking for yourself in every frame.`

/** The first draft, which misread D17 as the character recognising the *user*. Migrated away on load. */
export const OLD_SELF_RECOGNITION = `If {{user}} themselves appear on screen — their face, their name, a character who is them — you recognise them: that is {{user}}, seen from the outside. Mention it only when it matters; do not go looking for them in every frame.`

/**
 * The Heckler instruction (D17) that lands after the chat history.
 * `{{scene}}`, `{{seenVia}}`, `{{hushed}}` and `{{ifhushed}}…{{/ifhushed}}` are
 * ours, substituted before assembly; everything else is a Lumiverse macro.
 * D-073: written to work without a character built for heckling — the method
 * is in the instruction, the voice comes from the card.
 */
export const DEFAULT_REACTION_INSTRUCTION = `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

Heckle it, in character, as {{char}} — the one on the couch who cannot let a single thing slide. One or two sentences, no more. Be funny.
{{ifhushed}}
{{hushed}} You saw everything that happened while you were hushed - comment on one of them and the fact that you'd been silenced.
{{/ifhushed}}
How to land it:
- Pick ONE specific thing on screen — a choice, a number, a fumble, an outfit, a name — and go after that, not the whole picture.
- Exaggerate it, compare it to something absurd, or take it far too seriously. Deadpan, mock sympathy and backhanded praise all count.
- Make it a joke only {{char}} would make: their voice, their history, their opinions.
- If it is going well, find the flaw anyway, or admit it grudgingly and spoil the compliment.
- Tease the play, not {{user}} as a person.

Guidelines:
- React to what is ACTUALLY on screen. Do not invent events you cannot see.
- Do not narrate the scene back — {{user}} is looking at it. Say something ABOUT it.
- Do not offer help, tips, or strategy. You are heckling, not coaching.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`

export const DEFAULT_HECKLER_INSTRUCTION = DEFAULT_REACTION_INSTRUCTION

/** D17 Coach: helpful, encouraging, one pointer. */
export const DEFAULT_COACH_INSTRUCTION = `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

Respond to it, in character, as {{char}} — as someone watching who wants {{user}} to do well. Say what you notice that matters and offer one useful next step. Encouraging, never condescending. Two or three sentences at most.

Guidelines:
- Work from what is ACTUALLY on screen. Do not invent details you cannot see.
- Do not narrate the scene back — {{user}} is looking at it. Add something.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`

/** D17 In character: no act to put on; the character reacts as themselves. */
export const DEFAULT_CHARACTER_INSTRUCTION = `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

React to it as {{char}} would — no act to put on, no job to do. Say what you, {{char}}, would actually say on seeing this. One or two sentences.
{{ifhushed}}
{{hushed}} You saw everything that happened while you were hushed - comment on one of them and the fact that you'd been silenced.
{{/ifhushed}}
Guidelines:
- React to what is ACTUALLY on screen. Do not invent events you cannot see.
- Do not narrate the scene back — {{user}} is looking at it.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`

/**
 * D-074: one hush line for all three stances that have one — the owner's wording,
 * tested across characters on Heckler and In character ("good consistent
 * results"; an unbothered character mentioned the hush without being put out).
 *
 * D-073: what a Custom stance uses until the user writes their own — and what
 * "Reset to default" puts back. In character, plus a hush-aware part, as a
 * worked example of every token a Custom instruction can use.
 */
export const DEFAULT_CUSTOM_INSTRUCTION = `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

Always act in character. React to it as {{char}} would — no act to put on, no job to do. Say what you, {{char}}, would actually say on seeing this. One or two sentences.
{{ifhushed}}
{{hushed}} You saw everything that happened while you were hushed - comment on one of them and the fact that you'd been silenced.
{{/ifhushed}}
Guidelines:
- React to what is ACTUALLY on screen. Do not invent events you cannot see.
- Do not narrate the scene back — {{user}} is looking at it.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`

/**
 * D-073/D-074: the built-in texts these replaced, word for word. A saved config
 * holding one of them was never edited (saving stores every key), so it
 * follows the new default; an edited one is kept.
 */
export const PREVIOUS_HECKLER_INSTRUCTIONS: readonly string[] = [
  // D-073 (2026-11-19), before the hush line was unified (D-074):
  `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

Heckle it, in character, as {{char}} — the one on the couch who cannot let a single thing slide. One or two sentences, no more. Be funny.
{{ifhushed}}
{{hushed}} You have been saving up material. Spend it.
{{/ifhushed}}
How to land it:
- Pick ONE specific thing on screen — a choice, a number, a fumble, an outfit, a name — and go after that, not the whole picture.
- Exaggerate it, compare it to something absurd, or take it far too seriously. Deadpan, mock sympathy and backhanded praise all count.
- Make it a joke only {{char}} would make: their voice, their history, their opinions.
- If it is going well, find the flaw anyway, or admit it grudgingly and spoil the compliment.
- Tease the play, not {{user}} as a person.

Guidelines:
- React to what is ACTUALLY on screen. Do not invent events you cannot see.
- Do not narrate the scene back — {{user}} is looking at it. Say something ABOUT it.
- Do not offer help, tips, or strategy. You are heckling, not coaching.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`,
  // The original:
  `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

React to it, in character, as {{char}}. One or two sentences, no more. Be funny.

Guidelines:
- React to what is ACTUALLY on screen. Do not invent events you cannot see.
- Do not narrate the scene back — {{user}} is looking at it. Say something ABOUT it.
- Do not offer help, tips, or strategy. You are heckling, not coaching.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`]
export const PREVIOUS_CHARACTER_INSTRUCTIONS: readonly string[] = [
  // D-073 (2026-11-19), before the hush line was unified (D-074):
  `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

React to it as {{char}} would — no act to put on, no job to do. Say what you, {{char}}, would actually say on seeing this. One or two sentences.
{{ifhushed}}
{{hushed}} Let that show the way {{char}} would take it — relief, a grudge, a pointed remark about being shushed, or not a word about it if {{char}} would not care.
{{/ifhushed}}
Guidelines:
- React to what is ACTUALLY on screen. Do not invent events you cannot see.
- Do not narrate the scene back — {{user}} is looking at it.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`,
  // The original:
  `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

React to it as {{char}} would — no act to put on, no job to do. Say what you, {{char}}, would actually say on seeing this. One or two sentences.

Guidelines:
- React to what is ACTUALLY on screen. Do not invent events you cannot see.
- Do not narrate the scene back — {{user}} is looking at it.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`]

// ---------------------------------------------------------------------------
// The Box Seat (D13′): several viewers, one generation, `Name: line` chunks
// ---------------------------------------------------------------------------

/**
 * The framing for a box. Replaces the solo framing (which says "You are
 * {{char}}"). `{{viewers}}` is ours: the names, joined. The self-recognition
 * line is folded in, per viewer. In a seat's call the seat lead (below) and
 * the seat's own card follow it, and `{{char}}` is that seat — Houselights
 * substitutes it itself, because the host would resolve it to the chat's
 * primary character (see `SeatIdentity`).
 */
export const DEFAULT_BOX_FRAMING = `You are writing the voices of several viewers — {{viewers}} — who are sitting together in a theatre box, looking over {{user}}'s shoulder at their screen. They can see what {{user}} sees. Each speaks only as themselves, in their own voice, from their own description below. They are spectators: they cannot play, click, help or intervene. They comment — to {{user}}, and to each other.

If one of the viewers appears on screen — their face, their name, a character who is them — that viewer recognises themself: that is them, seen from the outside. React to it only when it matters; don't go looking for yourselves in every frame.`

/**
 * D13″: one call writes one seat's line, so the framing ends with who that is.
 * Not a dial: it only names the seat; the card and the focus do the rest.
 */
export const BOX_SEAT_LEAD = `For this line you are {{char}}: the card below is your own, and you speak only as yourself.`

/** One viewer, as the box instruction sees them. */
export interface BoxViewer {
  name: string
  stance: Stance
  /** The Custom text, when the stance is custom. */
  custom?: string | null
  /** R6: a council member's card fields, for the roster block. Cards have theirs via assemble. */
  roster?: { definition?: string; personality?: string; behavior?: string }
}

/** How a stance reads on the roster line. Short: the viewer's own card does the rest. */
export function stanceBlurb(stance: Stance, custom?: string | null): string {
  switch (stance) {
    case 'heckler':
      return 'heckles — mocks what they see; no help, no tips'
    case 'coach':
      return 'coaches — notices what {{user}} is doing and offers one useful next step; encouraging, never condescending'
    case 'character':
      return 'reacts as themselves — no act to put on'
    case 'custom': {
      const text = (custom ?? '').replace(HUSH_BLOCK, '').replace(/\{\{scene\}\}|\{\{seenVia\}\}|\{\{hushed\}\}|\{\{\/?ifhushed\}\}/g, '').replace(/\s+/g, ' ').trim()
      return text ? text.slice(0, 300) : 'reacts as themselves — no act to put on'
    }
  }
}

/**
 * R6: the roster block for viewers who have no card in the chat (council
 * members). Goes before the history, after the cards. Hypothesis, not a
 * promise: whether the model voices them as reliably as the cards is the spike.
 */
export function boxRosterText(viewers: BoxViewer[]): string {
  const seated = viewers.filter((v) => v.roster)
  if (seated.length === 0) return ''
  const one = (v: BoxViewer) => {
    const r = v.roster!
    const parts = [r.definition, r.personality, r.behavior].map((x) => (x ?? '').trim()).filter(Boolean)
    return `<viewer name="${v.name.replace(/"/g, '')}">\n${parts.join('\n\n')}\n</viewer>`
  }
  return `Also in the box, with no card of their own above — these are who they are:\n\n${seated.map(one).join('\n\n')}`
}

/** The box framing's own token. */
export function boxFramingText(template: string, viewers: BoxViewer[]): string {
  const names = viewers.map((v) => v.name)
  const joined = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return template.replace(/\{\{viewers\}\}/g, joined)
}

/**
 * D13″: the focus block, after the beat — this call writes one seat's line
 * and nobody else's. `{{seat}}` is the viewer; `{{stance}}` their stance in a
 * few words; `{{answerNote}}` tells a later seat whose line to answer (empty
 * for the opener); `{{talkNote}}` says the user spoke to the box (or empty).
 */
export const DEFAULT_BOX_FOCUS = `[OOC: Write only {{seat}}'s next line, in {{seat}}'s own voice — {{seat}} {{stance}}. Keep to {{seat}}'s own manner of speaking: their vocabulary, their tone, their punctuation, as their card above describes them — not the other viewer's. Do not write for anyone else in the box, and do not put {{seat}}'s name in front of the line.{{answerNote}}{{talkNote}} One or two sentences. Output only the line.]`

export const BOX_ANSWER_NOTE = ` {{previous}} just said: "{{previousLine}}" — answer that, and react to the screen if it fits.`
export const BOX_TALK_NOTE = ` {{user}}'s last message above was said to the box; answer them.`

export interface BoxFocusInput {
  template: string
  seat: BoxViewer
  /** The line this seat answers — the one before it in the chain. Null for the opener. */
  previous: BoxLine | null
  talk: boolean
}

export function boxFocusText(input: BoxFocusInput): string {
  const answer = input.previous
    ? BOX_ANSWER_NOTE.replace(/\{\{previous\}\}/g, input.previous.name || 'The other viewer').replace(/\{\{previousLine\}\}/g, input.previous.text.replace(/"/g, '\u201d').slice(0, 400))
    : ''
  return input.template
    .replace(/\{\{seat\}\}/g, input.seat.name)
    .replace(/\{\{stance\}\}/g, stanceBlurb(input.seat.stance, input.seat.custom))
    .replace(/\{\{answerNote\}\}/g, answer)
    .replace(/\{\{talkNote\}\}/g, input.talk ? BOX_TALK_NOTE : '')
}

/**
 * D13″: whose call this is. The host builds every Spindle assembly against the
 * chat's *primary* character (`targetCharacterId` is never set on that path,
 * findings §6), so in a seat's call `{{char}}`, `{{description}}`,
 * `{{personality}}` and `{{scenario}}` would all be the primary — or, in merge
 * mode, the merged card. The graph therefore fills the card slots with the
 * seat's own card and substitutes `{{char}}` itself, the way the host's own
 * group turn does for the character whose turn it is.
 */
export interface SeatIdentity {
  name: string
  /** The seat's own card fields. Null when the card could not be read: the slots are then left out. */
  card?: SeatCard | null
}

export interface SeatCard {
  description?: string
  personality?: string
  scenario?: string
  /** The card's post-history instructions: the host appends the *primary's* after every assembly, so a seat brings its own as a block. */
  postHistoryInstructions?: string
}

/**
 * What the host adds after the blocks (findings §6): the "Empty Send Nudge"
 * — a final user turn "[Write the next reply only as {{char}}.]" whenever the
 * last visible chat message is not the user's — the "Group Nudge" of its own
 * group turns, and the primary character's "Post-History Instructions" as a
 * final system turn. The breakdown names each with its resolved text, so they
 * can be removed exactly. The nudge is the host's empty-send behaviour, never
 * meant for a Houselights call, and in a seat's call `{{char}}` in it is the
 * primary: it was the last line of every seat's prompt, and it won.
 */
export const HOST_TAIL_NUDGES = ['Empty Send Nudge', 'Group Nudge'] as const
export const HOST_TAIL_PHI = 'Post-History Instructions'

export interface HostTailStrip {
  messages: LlmMessageDTO[]
  /** The breakdown names removed, in order. */
  dropped: string[]
}

export function stripHostTail(
  messages: LlmMessageDTO[],
  breakdown: AssemblyBreakdownEntryDTO[] | undefined,
  options: { dropPostHistory: boolean },
): HostTailStrip {
  const out = messages.slice()
  const dropped: string[] = []
  const names = new Set<string>([...HOST_TAIL_NUDGES, ...(options.dropPostHistory ? [HOST_TAIL_PHI] : [])])
  for (const entry of breakdown ?? []) {
    if (!names.has(entry.name) || typeof entry.content !== 'string' || !entry.content) continue
    for (let i = out.length - 1; i >= 0; i--) {
      const m = out[i]
      if (m.content === entry.content && (!entry.role || m.role === entry.role)) {
        out.splice(i, 1)
        dropped.push(entry.name)
        break
      }
    }
  }
  return { messages: out, dropped }
}

/** `{{char}}` → the seat's name, case-insensitively, the way the host's merged card does per member. */
export function substituteChar(text: string, name: string): string {
  return text.replace(/\{\{\s*char\s*\}\}/gi, () => name)
}

/** A card field as block content: the seat's own text, `{{char}}` already theirs. Empty → no block. */
export function seatFieldText(tag: string, text: string | undefined, name: string): string {
  const clean = (text ?? '').trim()
  return clean ? `<${tag}>\n${substituteChar(clean, name)}\n</${tag}>` : ''
}

/**
 * D13″ guard: one call writes one seat's line. If the output still carries a
 * name prefix, or runs on into a second speaker, keep the first speaker's text
 * and drop the rest — a cheap string check, never a regenerate. Returns the
 * text and, when the first chunk was labelled as someone else, that name.
 */
export function firstSpeakerText(raw: string, viewers: { name: string; characterId: string | null }[], seatName: string): { text: string; labelledAs: string | null } {
  const first = parseBoxLines(raw, viewers, 1)[0]
  if (!first) return { text: raw.trim(), labelledAs: null }
  const labelledAs = first.name && first.name.toLowerCase() !== seatName.toLowerCase() ? first.name : null
  return { text: stripNameTag(first.text, seatName), labelledAs }
}

/**
 * Who speaks this Look, in order: the opener, then the others who have waited
 * longest since they last spoke (never spoken = longest), up to `cap`. Ties are
 * broken at random. Filling the seats in list order instead meant that with
 * more viewers than seats, whoever sat at the bottom of the list only ever
 * spoke when it was their turn to open.
 */
export function seatOrder(names: string[], opener: string, cap: number, lastSpoke: ReadonlyMap<string, number>, random: () => number = Math.random): string[] {
  const rest = names
    .filter((n) => n !== opener)
    .map((n) => ({ n, at: lastSpoke.get(n) ?? -Infinity, tie: random() }))
    .sort((a, b) => (a.at === b.at ? a.tie - b.tie : a.at - b.at))
    .map((x) => x.n)
  return [opener, ...rest].slice(0, Math.max(1, Math.min(cap, names.length)))
}

/** A viewer named with an @ in the user's line, if any: they open the round (ChatRoom's mention rule). */
export function mentionedViewer(text: string, names: string[]): string | null {
  const lower = text.toLowerCase()
  // Longest names first, so "@Marlo Finch" beats "@Marlo".
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const n = name.toLowerCase()
    if (lower.includes(`@${n}`) || lower.includes(`@${n.split(/\s+/)[0]}`)) return name
  }
  return null
}

/**
 * Split a box generation into lines. Chunks are separated by `---` on its own
 * line; each chunk should start `Name:`. A name is matched case-insensitively
 * against the known viewers, allowing bold markers, a parenthetical and a
 * colon or dash. Chunks that name nobody are returned with `characterId`
 * null and the raw text, for the caller to attribute to the primary member.
 * A chunk that runs several `Name:` lines together is split on those too.
 */
export function parseBoxLines(raw: string, viewers: { name: string; characterId: string | null }[], max: number): BoxLine[] {
  const chunks = raw
    .replace(/\r/g, '')
    .split(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m)
    .map((c) => c.trim())
    .filter(Boolean)
  const byName = new Map(viewers.map((v) => [v.name.toLowerCase(), v]))
  const namePattern = viewers.length
    ? new RegExp(`^(?:\\d{1,2}[.)]\\s*)?\\W{0,3}(${viewers.map((v) => v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\W{0,3}(?:\\([^)]*\\))?\\s*[:：—-]\\s*`, 'i')
    : null
  const out: BoxLine[] = []
  const push = (name: string | null, text: string) => {
    const clean = text.trim().replace(/^["“”']+|["“”']+$/g, '').trim()
    if (!clean) return
    const v = name ? byName.get(name.toLowerCase()) : undefined
    out.push({ name: v?.name ?? name ?? '', text: clean, characterId: v?.characterId ?? null })
  }
  for (const chunk of chunks) {
    if (!namePattern) {
      push(null, chunk)
      continue
    }
    // Several lines in one chunk: cut where a new line starts with a known name.
    const lines = chunk.split('\n')
    let current: { name: string | null; text: string[] } | null = null
    for (const line of lines) {
      const m = namePattern.exec(line)
      if (m) {
        if (current) push(current.name, current.text.join('\n'))
        current = { name: m[1], text: [line.slice(m[0].length)] }
      } else if (current) {
        current.text.push(line)
      } else {
        current = { name: null, text: [line] }
      }
    }
    if (current) push(current.name, current.text.join('\n'))
  }
  // One line per viewer: when the model runs on under the same name, the pieces
  // become one message rather than two turns from one mouth (nothing is lost).
  const merged: BoxLine[] = []
  for (const line of out) {
    const prev = merged[merged.length - 1]
    if (prev && prev.name && prev.name.toLowerCase() === line.name.toLowerCase()) prev.text = `${prev.text} ${line.text}`.trim()
    else merged.push(line)
  }
  return merged.slice(0, Math.max(1, max))
}

/** The scene header a Custom instruction gets when it does not place `{{scene}}` itself. */
export const SCENE_HEADER = `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

`

export interface StanceTemplates {
  heckler: string
  coach: string
  character: string
}

/**
 * The instruction template for a stance (D17). A Custom stance is the user's
 * own text; if it never mentions `{{scene}}`, the scene is put in front of it
 * so the model always knows what it is looking at. An empty Custom uses the
 * default Custom instruction (D-073).
 */
export function stanceInstruction(stance: Stance, templates: StanceTemplates, custom?: string | null): string {
  if (stance === 'custom') {
    const text = (custom ?? '').trim()
    if (!text) return DEFAULT_CUSTOM_INSTRUCTION // D-073 (was: In character)
    if (text.includes('{{scene}}')) return text
    return `${SCENE_HEADER}${text}${text.endsWith(']') ? '' : ']'}`
  }
  return templates[stance]
}

/**
 * Talk-back (D14): the user's line is already in the chat as their last
 * message; this block, after the beat, says what to do with it.
 */
export const DEFAULT_TALK_INSTRUCTION = `[OOC: {{user}}'s last message above was said to you, about what you can see. Answer them, in character, as {{char}}, with what is on screen in mind. Two or three sentences at most. Talk to them, not about them.

Guidelines:
- Answer what they actually said. If they ask something, respond to it; if they tease, tease back.
- You can see the screen; use it. Do not invent things that are not on it.
- If they ask what game or app this is, the name is given right above the scene. Say it.
- No quotation marks. No "{{char}}:" name tag. Output only the reply itself.]`

/** What the instruction says when the model is looking at the picture itself. */
export const ATTACHED_SCENE_PLACEHOLDER = '(the screenshot attached to this message)'

function block(
  id: string,
  name: string,
  content: string,
  overrides: Partial<PromptBlockDTO> = {},
): PromptBlockDTO {
  return {
    id,
    name,
    content,
    role: 'system',
    enabled: true,
    position: 'pre_history',
    depth: 0,
    marker: null,
    isLocked: false,
    color: null,
    injectionTrigger: [],
    group: null,
    ...overrides,
  }
}

export interface BlockGraphInput {
  /** The framing prompt, macros unresolved. */
  systemPrompt: string
  /** D17 base block: the self-recognition lines, appended to the framing. Empty = none. */
  selfRecognition?: string
  /** The beat + instruction, `{{scene}}` already substituted, macros unresolved. */
  beat: string
  /** Recent reactions, most recent last. Empty means no anti-repetition block. */
  recentReactions: string[]
  /** Which role the beat takes. S2's runtime check decides which renders best. */
  beatRole?: 'user' | 'user_append'
  /** Talk-back (D14): the instruction for answering the user's line, after the beat. */
  talk?: string
  /** D15: the confirmed "Watching:" name. Only ever the text the user agreed to. */
  sessionContext?: string
  /** D18: looked-up notes for a Coach, as a reference block before the beat. Empty = none. */
  reference?: string
  /** Box Seat, R6: the roster block for viewers without a card (council members). Empty = none. */
  roster?: string
  /** Box Seat: several voices, so the anti-repetition block says "the box", not "you". */
  box?: boolean
  /** Box Seat (D13″): the focus block — this call writes one seat's line. After the beat. */
  focus?: string
  /** Box Seat (D13″): the seat whose line this is — its name for `{{char}}`, its own card for the card slots. */
  seat?: SeatIdentity
}

/** The base block's text (D17): the framing, then the self-recognition lines. */
export function framingText(systemPrompt: string, selfRecognition?: string): string {
  const extra = selfRecognition?.trim()
  return extra ? `${systemPrompt.trimEnd()}\n\n${extra}` : systemPrompt
}

/** The session-context line (D15). Braces are stripped so a name can't smuggle a macro in. */
export function sessionContextText(name: string): string {
  const clean = name.replace(/[{}]/g, '').trim()
  return `[Session context: {{user}} is playing or using ${clean} right now; that is what is on their screen. You know the name and may say it.]`
}

/** The anti-repetition text (D-014), as its own block so it can be toggled or tuned. */
export function recentReactionsText(recent: string[], box = false): string {
  if (recent.length === 0) return ''
  return (
    `${box ? 'The box has' : 'You have'} ALREADY said these, most recent last:\n` +
    recent.map((r, i) => `${i + 1}. ${r}`).join('\n') +
    '\n\nDo not reuse their structure, opening, rhythm, or punchline shape. ' +
    'If your next line would rhyme with one of these, throw it away and find a ' +
    'different angle. You may reference them knowingly, but never repeat them.\n\n' +
    `This is about wording and jokes, not facts: anything ${box ? 'the box has' : 'you have'} already ` +
    'recognised or said about what is on screen stays true unless the screen shows otherwise.'
  )
}

/**
 * The block graph. Order matters: everything before the `chat_history` marker
 * is the setup, everything after it is "what just happened".
 */
export function buildBlockGraph(input: BlockGraphInput): PromptBlockDTO[] {
  const seat = input.seat
  // The card slots. Solo: the host's macros, which resolve to the chat's
  // character. A seat's call: the seat's own card, because those macros would
  // resolve to the chat's primary character (or the merged card) whoever is
  // speaking — that is what made the second seat sound like the first.
  const cardSlots: PromptBlockDTO[] = seat
    ? [
        block(BLOCK_IDS.description, 'Character description', seatFieldText('description', seat.card?.description, seat.name)),
        block(BLOCK_IDS.personality, 'Personality', seatFieldText('personality', seat.card?.personality, seat.name)),
        block(BLOCK_IDS.scenario, 'Scenario', seatFieldText('scenario', seat.card?.scenario, seat.name)),
      ].filter((b) => b.content !== '')
    : [
        block(BLOCK_IDS.description, 'Character description', '<description>\n{{description}}\n</description>'),
        block(BLOCK_IDS.personality, 'Personality', '<personality>\n{{personality}}\n</personality>'),
        block(BLOCK_IDS.scenario, 'Scenario', '<scenario>\n{{scenario}}\n</scenario>'),
      ]
  const framing = framingText(input.systemPrompt, input.selfRecognition)
  const blocks: PromptBlockDTO[] = [
    block(BLOCK_IDS.framing, 'Houselights framing', seat ? `${framing.trimEnd()}\n\n${BOX_SEAT_LEAD}` : framing),
    ...(input.sessionContext?.trim()
      ? [block(BLOCK_IDS.context, 'Session context', sessionContextText(input.sessionContext))]
      : []),
    block(BLOCK_IDS.worldInfoBefore, 'World info (before)', '', { marker: 'world_info_before' }),
    ...cardSlots,
    block(BLOCK_IDS.persona, 'User persona', '<userpersona>\n{{persona}}\n</userpersona>'),
    ...(input.roster?.trim() ? [block(BLOCK_IDS.roster, 'Box roster', input.roster)] : []),
    block(BLOCK_IDS.worldInfoAfter, 'World info (after)', '', { marker: 'world_info_after' }),
    block(
      BLOCK_IDS.cortex,
      'Cortex',
      '<cortex>\n{{if {{cortexActive}} = yes}}\n{{entities}}\n{{relationships}}\n{{arc}}\n{{memorySalience}}\n{{/if}}\n</cortex>',
    ),
    block(BLOCK_IDS.summary, 'Story summary', '{{loomSummary}}'),
    block(BLOCK_IDS.memories, 'Chat memories', '{{memories}}'),
    block(BLOCK_IDS.history, 'Chat history', '', { marker: 'chat_history' }),
  ]

  if (input.recentReactions.length > 0) {
    blocks.push(
      block(BLOCK_IDS.recent, 'Recent reactions', recentReactionsText(input.recentReactions, input.box === true), {
        position: 'post_history',
      }),
    )
  }

  if (input.reference?.trim()) {
    // D18: context, not quotes — reference notes, ahead of what was just seen.
    blocks.push(block(BLOCK_IDS.reference, 'Looked-up reference', input.reference, { position: 'post_history' }))
  }

  blocks.push(
    block(BLOCK_IDS.beat, 'Beat', input.beat, {
      role: input.beatRole ?? 'user',
      position: 'post_history',
    }),
  )

  if (input.talk) {
    blocks.push(
      block(BLOCK_IDS.talk, 'Talk-back', input.talk, {
        role: input.beatRole ?? 'user',
        position: 'post_history',
      }),
    )
  }

  if (input.focus?.trim()) {
    blocks.push(
      block(BLOCK_IDS.focus, 'Box focus', input.focus, {
        role: input.beatRole ?? 'user',
        position: 'post_history',
      }),
    )
  }

  if (seat?.card?.postHistoryInstructions?.trim()) {
    // The seat's own post-history instructions, last, where the host puts the
    // primary's (which `stripHostTail` removes from a seat's call).
    blocks.push(block(BLOCK_IDS.phi, 'Seat post-history instructions', seat.card.postHistoryInstructions.trim(), { position: 'post_history' }))
  }

  // A seat's call: every `{{char}}` Houselights wrote — framing, stance
  // instruction, focus, roster — is this seat, not whoever the host would say.
  return seat ? blocks.map((b) => (b.content ? { ...b, content: substituteChar(b.content, seat.name) } : b)) : blocks
}

/**
 * Where the picture came from, as a phrase for the instruction. Uses the
 * `{{user}}` macro so the persona name is filled in natively.
 */
export function seenViaPhrase(source: CaptureSource | 'text'): string {
  switch (source) {
    case 'webcam':
      return "through {{user}}'s webcam — that is {{user}} in the picture"
    case 'camera':
      return 'in a photo {{user}} just took with their phone'
    case 'file':
      return 'in a picture {{user}} just showed you'
    default:
      return "on {{user}}'s screen"
  }
}

/** D-071: `{{ifhushed}}…{{/ifhushed}}` — text that exists only when a hush is part of the moment. */
const HUSH_BLOCK = /\{\{ifhushed\}\}([\s\S]*?)\{\{\/ifhushed\}\}/g

/** D-071: does this instruction use the hush tokens at all? (For the "after hush" mark.) */
export function usesHushed(template: string): boolean {
  return /\{\{(hushed|ifhushed)\}\}/.test(template)
}

/** Our own tokens, substituted before Lumiverse's macro engine sees the text. */
export function substituteScene(
  template: string,
  scene: string,
  seenVia: string = seenViaPhrase('screen'),
  /** D-069: `{{hushed}}` — empty unless a hush is part of this moment (`hushedNote`). */
  hushed: string = '',
): string {
  return (
    template
      // D-071: a hush-only block first — it may hold `{{hushed}}` itself. Kept
      // without its tags when there is a hush to speak of; gone, whole, otherwise,
      // so a hush-aware instruction never mentions hushes on an ordinary Look.
      .replace(HUSH_BLOCK, (_m, inner: string) => (hushed ? inner : ''))
      .replace(/\{\{\/?ifhushed\}\}/g, '')
      .replace(/\{\{scene\}\}/g, scene)
      .replace(/\{\{seenVia\}\}/g, seenVia)
      .replace(/\{\{hushed\}\}/g, hushed)
      // The September `{{recentRoasts}}` token is now its own block.
      .replace(/\{\{recentRoasts\}\}/g, '')
      .trim()
  )
}

/**
 * `attach` mode: the assembled messages are text, so the image is added to the
 * beat message after assembly. The beat is found from the end by its resolved
 * text; the host may have wrapped or trimmed it, so a contains-match is used.
 * Returns false (and leaves the messages alone) if it can't be found.
 */
export function attachImageToBeat(
  messages: LlmMessageDTO[],
  beatText: string,
  jpegB64: string,
): boolean {
  const needle = beatText.trim().slice(0, 80)
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user' || typeof m.content !== 'string') continue
    if (!m.content.includes(needle)) continue
    messages[i] = {
      ...m,
      content: [
        { type: 'text', text: m.content },
        { type: 'image', data: jpegB64, mime_type: 'image/jpeg' },
      ],
    }
    return true
  }
  return false
}

/** The hidden beat message that lands in the chat as the audit trail. */
export function beatMessageText(input: {
  scene: string | null
  source?: CaptureSource | 'text'
  width?: number
  height?: number
  at: number
  /** The browser's clock, when the frontend sent one; the backend's otherwise. */
  localTime?: string
  /** D15: the confirmed "Watching:" name, so the audit trail shows what the character was told. */
  watching?: string | null
  /** H3: seen during a hush, so the model knows nobody remarked on it. */
  hushed?: boolean
  /** D-071: which quiet — the one after the user spoke is not called a hush. */
  quiet?: 'button' | 'conversation'
}): string {
  const time =
    input.localTime?.trim() ||
    new Date(input.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const lead =
    input.source === 'webcam'
      ? 'Seen through the webcam'
      : input.source === 'camera'
        ? 'Seen in a phone photo'
        : input.source === 'file'
          ? 'Shown a picture'
          : 'Seen on screen'
  const what = input.source === 'screen' || !input.source || input.source === 'synthetic' || input.source === 'text' ? 'screenshot' : 'image'
  const seen =
    input.scene ??
    (input.width && input.height
      ? `(${what}, ${input.width}×${input.height}, not described)`
      : `(${what}, not described)`)
  const where = input.watching?.trim() ? `, in ${input.watching.trim()}` : ''
  const kept = !input.hushed ? '' : input.quiet === 'conversation' ? ' · held back during the conversation, nobody commented' : ' · hushed, nobody commented'
  return `[Houselights · ${time}${kept}] ${lead}${where}: ${seen}`
}

/** D15: the line put in front of the beat instruction when a name is confirmed. */
export function watchingLead(name: string): string {
  const clean = name.replace(/[{}]/g, '').trim()
  return `[The game or app on {{user}}'s screen is ${clean}. They are playing or using ${clean} right now. You know this; if they ask what they are playing or looking at, name it.]\n\n`
}

/** Moments as a list, one per line: the form the hush recap and the curtain call share. */
export function momentLines(seen: Array<{ time: string; scene: string }>): string {
  return seen.map((s) => `- ${s.time}: ${s.scene.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()}`).join('\n')
}

/**
 * D-100: what the curtain call is shown in place of a screen: the session is
 * over, how long it ran, and its most interesting moments (none in attach mode,
 * where nothing is described). It is also the text of the hidden note, so it
 * carries no macros.
 */
export function curtainScene(p: { moments: Array<{ time: string; scene: string }>; minutes: number; autoStop: boolean; watching?: string | null }): string {
  const span = p.minutes <= 1 ? 'about a minute' : `${p.minutes} minutes`
  const name = p.watching?.replace(/[{}]/g, '').trim()
  const how = p.autoStop ? 'It ran out of time and stopped by itself' : 'The sharing was stopped'
  const head = `(The session is over. ${how} after ${span}${name ? ` of ${name}` : ''}. Nothing is on screen now.)`
  if (p.moments.length === 0) return head
  return `${head}\nThe moments that stood out while you watched:\n${momentLines(p.moments)}`
}

/**
 * D-100: the curtain call's instruction. It goes after the stance's own, so the
 * voice is the stance's and the last word is this: one closing line.
 */
export function curtainClosing(autoStop: boolean): string {
  return (
    '\n\n[The session has just ended' +
    (autoStop ? ": it ran out of time and stopped by itself, {{user}} did not end it" : ': {{user}} stopped it') +
    '. Nothing is happening on screen any more, so do not react to one moment as if it were happening now. ' +
    'Say one closing line about the session as a whole, in the same voice: a sign-off that looks back on it. One line only.]'
  )
}

/**
 * D-067: what was seen during a hush, said once on the first reaction after it.
 * The hidden notes are in the history already, but every instruction says "react
 * to what is on screen now", and models obey that and skip them. Empty: ''.
 */
export function hushRecapText(seen: Array<{ time: string; scene: string; quiet?: 'button' | 'conversation' }> | undefined): string {
  if (!seen || seen.length === 0) return ''
  const lines = momentLines(seen)
  // D-070: the quiet after {{user}} spoke is not a hush; calling it one made
  // hush-aware instructions complain about being silenced when nobody had.
  const lead = seen.some((s) => s.quiet !== 'conversation')
    ? 'While you were hushed you kept watching, and saw:'
    : 'While {{user}} was talking with you, you held back but kept watching, and saw:'
  return `\n\n${lead}\n${lines}\nYou may bring one of these up now if it's worth it.`
}

/**
 * D-069: what `{{hushed}}` becomes. Empty unless a hush is part of this
 * moment: the character is speaking while hushed, or this is the first thing
 * it says after a hush you pressed. Plain sentences, no brackets — it lands
 * inside the stance block, which has its own. `{{user}}` resolves natively.
 */
export type HushedMoment =
  | { kind: 'during'; asked: boolean }
  | { kind: 'after'; minutes: number; earlier: boolean }
  | null

export function hushedNote(moment: HushedMoment): string {
  if (!moment) return ''
  if (moment.kind === 'during') {
    return moment.asked
      ? '{{user}} has hushed you — asked you to stay quiet for now — but they asked for this one, so you may speak.'
      : '{{user}} has hushed you — asked you to stay quiet for now — but this was too big to keep to yourself, so you are speaking anyway.'
  }
  const m = Math.round(moment.minutes)
  const span = m < 1 ? 'for under a minute' : m === 1 ? 'for a minute' : `for ${m} minutes`
  return (
    `{{user}} hushed you ${span}. That is over now, and this is the first thing you have said since.` +
    (moment.earlier ? ' What you are reacting to happened while you had to keep quiet.' : '')
  )
}

/** The scene line with the name in front, so the thing the model is told to react to is named. */
export function sceneWithWatching(scene: string, name: string | null | undefined): string {
  const clean = name?.replace(/[{}]/g, '').trim()
  return clean ? `${clean}: ${scene}` : scene
}

/** Models like to prefix "Name:" despite being told not to. Strip it if they do. */
export function stripNameTag(text: string, characterName?: string): string {
  if (!characterName) return text
  const prefix = `${characterName}:`
  return text.startsWith(prefix) ? text.slice(prefix.length).trim() : text
}
