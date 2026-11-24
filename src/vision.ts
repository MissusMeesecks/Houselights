/**
 * `describe` mode — a separate vision model writes a neutral scene report,
 * and only the text reaches the roleplay model.
 *
 * Ported from the retired helper's `eyes/src/vision.ts`. Deliberately dumb:
 * it asks for a plain description and nothing else. All the comedy happens
 * later, in the character's own voice, with whatever model the chat uses.
 * Keeping the two apart means the model with eyes and the model with the
 * personality can be different models, which they usually are.
 */

import type { LlmMessageDTO } from 'lumiverse-spindle-types'

export const SCENE_KINDS = [
  'menu',
  'loading',
  'cutscene',
  'combat',
  'exploration',
  'dialogue',
  // D-101: a screen announcing how something ended. Death screens were coming back as `menu`.
  'outcome',
  'other',
] as const
export type SceneKind = (typeof SCENE_KINDS)[number]

/** Used when the model answers in prose instead of JSON — mid-scale, so a
 *  malformed response is neither suppressed nor treated as a highlight. */
export const FALLBACK_INTEREST = 5

export const DEFAULT_VISION_PROMPT = [
  'You are a screen observer. Look at the screenshot and reply with',
  'ONLY a JSON object, no prose around it, in exactly this shape:',
  '',
  '{"scene": "...", "interest": 0, "kind": "...", "app": null, "confidence": 0}',
  '',
  '"scene" — one to three short sentences describing what is happening, as a neutral',
  'factual report. Report only what is visibly true; never guess or embellish.',
  'If it is a game, prioritise player health/status, immediate threats, resources,',
  'objectives, and anything that just changed dramatically. Include specific numbers',
  'when legible (health, ammo, currency, timers). If it is not a game, say what the',
  'person is looking at or doing. Be blunt and literal: no jokes, no commentary,',
  'no advice. If you cannot tell what is happening, say so plainly.',
  'If the picture is mostly words (a meme, a comic, a post, a chat, a sign, a page),',
  'the words ARE the content: quote the main text exactly, cutting very long text',
  'with "…", and say what any picture in it shows. Leave out usernames, handles,',
  'timestamps, like or share counts and the site around it, unless they are the joke.',
  '',
  '"interest" — an integer 0-10 for how eventful this moment is to a spectator',
  "watching over the person's shoulder:",
  '  0-2  nothing is happening: menus, loading, idle, a paused or static screen',
  '  3-5  ordinary activity: walking, looting, routine fighting, reading, typing',
  '  6-8  something notable: low health, a boss appearing, a big find, a mistake',
  '  9-10 dramatic: death, a narrow escape, a boss dying, catastrophic failure',
  'Be honest and use the low end freely. Most moments are not interesting.',
  '',
  '"kind" — exactly one of: menu, loading, cutscene, combat, exploration,',
  'dialogue, outcome, other',
  '"outcome" is a screen announcing how something ended — death, game over, failed,',
  'desynchronized, victory, level or mission complete — even if it shows menu options.',
  '',
  '"app" — the name of the game or application on screen, if a title bar, logo,',
  'HUD or layout makes it clear (e.g. "Palworld", "Blender", "YouTube"); otherwise null.',
  '"confidence" — 0 to 1, how sure you are of "app". Use 0 when it is null.',
].join('\n')

/**
 * Earlier built-in vision prompts, word for word. A saved config holds the
 * default it was saved with, so one of these means "never edited": it is
 * swapped for the current default on load. Anything else is the user's own.
 */
const VISION_PROMPT_1105 = [
  'You are a screen observer. Look at the screenshot and reply with',
  'ONLY a JSON object, no prose around it, in exactly this shape:',
  '',
  '{"scene": "...", "interest": 0, "kind": "..."}',
  '',
  '"scene" — one or two short sentences describing what is happening, as a neutral',
  'factual report. Report only what is visibly true; never guess or embellish.',
  'If it is a game, prioritise player health/status, immediate threats, resources,',
  'objectives, and anything that just changed dramatically. Include specific numbers',
  'when legible (health, ammo, currency, timers). If it is not a game, say what the',
  'person is looking at or doing. Be blunt and literal: no jokes, no commentary,',
  'no advice. If you cannot tell what is happening, say so plainly.',
  '',
  '"interest" — an integer 0-10 for how eventful this moment is to a spectator',
  "watching over the person's shoulder:",
  '  0-2  nothing is happening: menus, loading, idle, a paused or static screen',
  '  3-5  ordinary activity: walking, looting, routine fighting, reading, typing',
  '  6-8  something notable: low health, a boss appearing, a big find, a mistake',
  '  9-10 dramatic: death, a narrow escape, a boss dying, catastrophic failure',
  'Be honest and use the low end freely. Most moments are not interesting.',
  '',
  '"kind" — exactly one of: menu, loading, cutscene, combat, exploration,',
  'dialogue, other',
].join('\n')

const VISION_PROMPT_1108 = [
  'You are a screen observer. Look at the screenshot and reply with',
  'ONLY a JSON object, no prose around it, in exactly this shape:',
  '',
  '{"scene": "...", "interest": 0, "kind": "...", "app": null, "confidence": 0}',
  '',
  '"scene" — one or two short sentences describing what is happening, as a neutral',
  'factual report. Report only what is visibly true; never guess or embellish.',
  'If it is a game, prioritise player health/status, immediate threats, resources,',
  'objectives, and anything that just changed dramatically. Include specific numbers',
  'when legible (health, ammo, currency, timers). If it is not a game, say what the',
  'person is looking at or doing. Be blunt and literal: no jokes, no commentary,',
  'no advice. If you cannot tell what is happening, say so plainly.',
  '',
  '"interest" — an integer 0-10 for how eventful this moment is to a spectator',
  "watching over the person's shoulder:",
  '  0-2  nothing is happening: menus, loading, idle, a paused or static screen',
  '  3-5  ordinary activity: walking, looting, routine fighting, reading, typing',
  '  6-8  something notable: low health, a boss appearing, a big find, a mistake',
  '  9-10 dramatic: death, a narrow escape, a boss dying, catastrophic failure',
  'Be honest and use the low end freely. Most moments are not interesting.',
  '',
  '"kind" — exactly one of: menu, loading, cutscene, combat, exploration,',
  'dialogue, other',
  '',
  '"app" — the name of the game or application on screen, if a title bar, logo,',
  'HUD or layout makes it clear (e.g. "Palworld", "Blender", "YouTube"); otherwise null.',
  '"confidence" — 0 to 1, how sure you are of "app". Use 0 when it is null.',
].join('\n')

/** The default until D-101, which added the `outcome` kind. */
const VISION_PROMPT_1123 = [
  'You are a screen observer. Look at the screenshot and reply with',
  'ONLY a JSON object, no prose around it, in exactly this shape:',
  '',
  '{"scene": "...", "interest": 0, "kind": "...", "app": null, "confidence": 0}',
  '',
  '"scene" — one to three short sentences describing what is happening, as a neutral',
  'factual report. Report only what is visibly true; never guess or embellish.',
  'If it is a game, prioritise player health/status, immediate threats, resources,',
  'objectives, and anything that just changed dramatically. Include specific numbers',
  'when legible (health, ammo, currency, timers). If it is not a game, say what the',
  'person is looking at or doing. Be blunt and literal: no jokes, no commentary,',
  'no advice. If you cannot tell what is happening, say so plainly.',
  'If the picture is mostly words (a meme, a comic, a post, a chat, a sign, a page),',
  'the words ARE the content: quote the main text exactly, cutting very long text',
  'with "…", and say what any picture in it shows. Leave out usernames, handles,',
  'timestamps, like or share counts and the site around it, unless they are the joke.',
  '',
  '"interest" — an integer 0-10 for how eventful this moment is to a spectator',
  "watching over the person's shoulder:",
  '  0-2  nothing is happening: menus, loading, idle, a paused or static screen',
  '  3-5  ordinary activity: walking, looting, routine fighting, reading, typing',
  '  6-8  something notable: low health, a boss appearing, a big find, a mistake',
  '  9-10 dramatic: death, a narrow escape, a boss dying, catastrophic failure',
  'Be honest and use the low end freely. Most moments are not interesting.',
  '',
  '"kind" — exactly one of: menu, loading, cutscene, combat, exploration,',
  'dialogue, other',
  '',
  '"app" — the name of the game or application on screen, if a title bar, logo,',
  'HUD or layout makes it clear (e.g. "Palworld", "Blender", "YouTube"); otherwise null.',
  '"confidence" — 0 to 1, how sure you are of "app". Use 0 when it is null.',
].join('\n')

export const PREVIOUS_VISION_PROMPTS: readonly string[] = [VISION_PROMPT_1105, VISION_PROMPT_1108, VISION_PROMPT_1123]

/** A saved vision prompt that is an old built-in default comes back as the current one. */
export function upgradeVisionPrompt(saved: string | undefined): string | undefined {
  return saved !== undefined && PREVIOUS_VISION_PROMPTS.includes(saved) ? DEFAULT_VISION_PROMPT : saved
}

/** The clause appended to a vision prompt that predates (or was edited without) the app fields. */
export const APP_FIELDS_CLAUSE = [
  'Also include two more keys in the same JSON object:',
  '"app" — the name of the game or application on screen, if a title bar, logo,',
  'HUD or layout makes it clear (e.g. "Palworld", "Blender", "YouTube"); otherwise null.',
  '"confidence" — 0 to 1, how sure you are of "app". Use 0 when it is null.',
].join('\n')

/** A user's saved vision prompt may be older than the app fields; ask for them anyway. */
export function ensureAppFields(prompt: string): string {
  return /"app"/.test(prompt) ? prompt : `${prompt.trimEnd()}\n\n${APP_FIELDS_CLAUSE}`
}

/** Models say "high" as readily as 0.9. */
export function parseConfidence(value: unknown): number {
  // 0–1 as asked; "7" reads as 7 out of 10, "70" as a percent.
  if (typeof value === 'number' && Number.isFinite(value)) {
    const scaled = value > 10 && value <= 100 ? value / 100 : value > 1 && value <= 10 ? value / 10 : value
    return Math.min(1, Math.max(0, scaled))
  }
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase()
    if (/^(very high|certain|high)$/.test(t)) return 0.9
    if (/^(medium|moderate|likely)$/.test(t)) return 0.6
    if (/^(low|unsure|guess)$/.test(t)) return 0.3
    const n = Number(t.replace('%', ''))
    if (Number.isFinite(n)) return parseConfidence(t.endsWith('%') ? n / 100 : n)
  }
  return 0
}

export interface SceneReport {
  text: string
  /** 0-10 spectator interest, as judged by the vision model. */
  interest: number
  kind: SceneKind
  /** D15 layer 2: the app or game the model thinks is on screen, or null. */
  app: string | null
  /** 0-1, the model's own confidence in `app`. 0 when it gave none. */
  appConfidence: number
  /** D18: the on-screen text worth searching for (objective, mission, place, boss), or null. */
  lookup: string | null
  /** D-099: whether the screen still looks like the confirmed Watching name; null when not asked or not answered. */
  matches: 'yes' | 'no' | 'unsure' | null
  /** True when the model didn't return usable JSON and we fell back to prose. */
  degraded: boolean
}

/**
 * D18: appended to the vision prompt only while a Coach may look things up. A
 * description of how the screen *looks* makes a useless search; the words
 * printed on it — the objective, the mission, the place — make a good one.
 */
export const LOOKUP_FIELD_CLAUSE = [
  'Also include one more key in the same JSON object:',
  '"lookup" — the words someone would type into a search engine to get help with exactly this moment,',
  'taken from text printed on the screen: the current objective or quest line, the mission or chapter name,',
  'the named location, the name of the boss, enemy, item or menu in focus. Copy them as written, at most',
  'ten words, no punctuation. Never describe how things look (no colours, weather, clothing, scenery).',
  'Use "" when the screen shows no such text.',
  'When the screen shows a current objective or quest line, also name it in "scene".',
].join('\n')

/** Add the lookup clause unless the prompt already asks for the key. */
export function ensureLookupField(prompt: string): string {
  return /"lookup"/.test(prompt) ? prompt : `${prompt.trimEnd()}\n\n${LOOKUP_FIELD_CLAUSE}`
}

/**
 * D-099: appended to the vision prompt while a Watching name is confirmed. Identifying a game
 * from a screenshot is unreliable; saying whether a screenshot fits a given name is easier, and
 * a wrong name in every prompt is worse than none.
 */
export function matchesFieldClause(name: string): string {
  const clean = name.replace(/["{}\\\n\r]/g, ' ').replace(/\s+/g, ' ').trim()
  return [
    'Also include one more key in the same JSON object:',
    `"matches" — "yes", "no" or "unsure": does this screen look like ${clean}?`,
    'Answer "no" only if it clearly shows something else. A menu, a loading screen, the desktop,',
    'or anything you cannot place is "unsure", not "no".',
  ].join('\n')
}

/** Ask whether the screen matches `name` (the confirmed Watching name), whatever prompt is saved. */
export function withMatchesField(prompt: string, name: string | null | undefined): string {
  return name ? `${prompt.trimEnd()}\n\n${matchesFieldClause(name)}` : prompt
}

/** The model's answer to the matches question; anything else is no answer. */
export function parseMatches(value: unknown): 'yes' | 'no' | 'unsure' | null {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  if (typeof value !== 'string') return null
  const t = value.trim().toLowerCase().replace(/[^a-z]/g, '')
  if (t === 'yes' || t === 'true') return 'yes'
  if (t === 'no' || t === 'false') return 'no'
  if (t === 'unsure' || t === 'unknown' || t === 'maybe' || t === 'notsure') return 'unsure'
  return null
}

/** The model's lookup text, tidied: no braces or quotes, ten words at most; null when empty or a non-answer. */
export function parseLookup(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const words = value.replace(/[{}"<>\[\]]/g, ' ').replace(/[.,;:!?]+(\s|$)/g, ' ').split(/\s+/).filter(Boolean).slice(0, 10)
  const text = words.join(' ')
  return text.length >= 3 && !/^(null|none|unknown|n\/a|nothing)$/i.test(text) ? text : null
}

/**
 * The request for the vision model: instruction first, then the image.
 * Text-before-image is the order providers handle most reliably.
 */
export function buildVisionMessages(prompt: string, jpegB64: string): LlmMessageDTO[] {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image', data: jpegB64, mime_type: 'image/jpeg' },
      ],
    },
  ]
}

/**
 * Models wrap JSON in prose or code fences often enough that strict parsing
 * would throw away good descriptions. Anything unparseable becomes a plain
 * description at neutral interest rather than an error — a slightly worse
 * scene is much better than a broken loop.
 */
export function parseSceneResponse(raw: string): SceneReport {
  const text = raw.trim()

  const candidates: string[] = [text]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const braced = text.match(/\{[\s\S]*\}/)
  if (braced?.[0]) candidates.push(braced[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      const scene = typeof parsed.scene === 'string' ? parsed.scene.trim() : ''
      if (!scene) continue

      const rawInterest = Number(parsed.interest)
      const interest = Number.isFinite(rawInterest)
        ? Math.min(10, Math.max(0, Math.round(rawInterest)))
        : FALLBACK_INTEREST

      const rawKind = typeof parsed.kind === 'string' ? parsed.kind.trim().toLowerCase() : ''
      const kind = (SCENE_KINDS as readonly string[]).includes(rawKind)
        ? (rawKind as SceneKind)
        : 'other'

      const rawApp = typeof parsed.app === 'string' ? parsed.app.trim().slice(0, 60) : ''
      const app = rawApp && !/^(null|none|unknown|n\/a)$/i.test(rawApp) ? rawApp : null
      const appConfidence = app ? parseConfidence(parsed.confidence) : 0

      return { text: scene, interest, kind, app, appConfidence, lookup: parseLookup(parsed.lookup), matches: parseMatches(parsed.matches), degraded: false }
    } catch {
      // Try the next candidate.
    }
  }

  return { text, interest: FALLBACK_INTEREST, kind: 'other', app: null, appConfidence: 0, lookup: null, matches: null, degraded: true }
}
