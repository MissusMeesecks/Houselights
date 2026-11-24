/**
 * Are two names the same game or app, for the Watching chip (D15)?
 *
 * Vision never spells a title the same way twice — "Assassin's Creed IV: Black
 * Flag", "Assassin's Creed Black Flag", "AC4 Black Flag" — and the user types
 * whatever they type ("AC: Black Flag"). None of those should reopen the
 * question. So names are compared as word sets, not strings: case, punctuation,
 * edition words, numerals and filler words are ignored; a name whose words all
 * appear in the other is the same game; a short token is allowed to stand for
 * the initials of a run of words in the other ("ac" for "assassins creed").
 *
 * The bias is deliberate: once the user has confirmed a name, a wrong "are you
 * sure?" costs more than a missed sequel. They can edit the chip at any time.
 */

const EDITION_WORDS = new Set([
  'goty', 'game', 'year', 'edition', 'remastered', 'remaster', 'definitive', 'enhanced', 'complete',
  'deluxe', 'ultimate', 'anniversary', 'legendary', 'collection', 'hd', 'vr', 'special', 'directors', 'cut',
])
const FILLER_WORDS = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'at', 'to', 'for'])
const ROMAN = /^(?=[ivx]+$)i{0,3}v?i{0,3}x{0,3}$/

/** Every word, lowercased, apostrophes closed up, trailing plural/possessive 's' dropped. */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['’`]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
}

/** The words that identify the game: no editions, numerals or filler. */
export function significantWords(name: string): string[] {
  return nameWords(name).filter((w) => !EDITION_WORDS.has(w) && !FILLER_WORDS.has(w) && !ROMAN.test(w) && !/^\d+$/.test(w))
}

/** Could `token` be an abbreviation of a run of consecutive words in `words`? ("ac" ← assassins creed) */
function isInitialsOf(token: string, words: string[]): boolean {
  if (token.length < 2 || token.length > 5 || !/^[a-z]+$/.test(token)) return false
  const initials = words.filter((w) => /^[a-z]/.test(w)).map((w) => w[0]).join('')
  return initials.includes(token)
}

/** Does every significant word of `a` appear in `b`, by itself, as a prefix match, or as initials? */
function covers(a: string[], bSignificant: string[], bAll: string[]): boolean {
  if (a.length === 0) return false
  // A near-identical word (spelling drift of a letter or two: "assassin"/"assassins") counts; a
  // shared prefix alone does not ("fire" is not "firefox").
  const drift = (w: string, x: string) => Math.min(w.length, x.length) >= 5 && Math.abs(w.length - x.length) <= 2 && (x.startsWith(w) || w.startsWith(x))
  return a.every((w) => bSignificant.some((x) => x === w || drift(w, x)) || isInitialsOf(w, bAll))
}

/**
 * Same game, for the chip's purposes. True when one name's identifying words are
 * all found in the other (so a subtitle, a numeral or an abbreviation never
 * makes a "new" game), or when they share two or more identifying words (the
 * same franchise). False for a single shared common word: "Black Flag" is not
 * "Black Ops", "Going Medieval" is not "Medieval Dynasty".
 */
export function sameGame(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const aAll = nameWords(a)
  const bAll = nameWords(b)
  if (aAll.length === 0 || bAll.length === 0) return false
  if (aAll.join('') === bAll.join('')) return true
  const aSig = significantWords(a)
  const bSig = significantWords(b)
  // Only editions/numerals left over (e.g. "GOTY" against "Borderlands 2"): fall back to all words.
  const aUse = aSig.length ? aSig : aAll
  const bUse = bSig.length ? bSig : bAll
  if (covers(aUse, bUse, bAll) || covers(bUse, aUse, aAll)) return true
  const shared = aUse.filter((w) => bUse.includes(w))
  return shared.length >= 2
}
