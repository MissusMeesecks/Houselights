/**
 * D15, amended by D-099: when the confirmed Watching name may be used.
 *
 * The name is the only text about "what is on screen" that reaches the model, so
 * a stale one is worse than none (a name confirmed for one game was still being
 * sent while another was played). Two rules, kept here as plain state changes
 * so they can be tested without a host:
 *
 * 1. Session-scoped. When a session ends the name stops being used and becomes
 *    `lastConfirmed`. The chip then asks "Still <name>?", and nothing is sent
 *    until the user confirms or changes it.
 * 2. Checked against the screen. In describe mode the vision model is asked, with
 *    every look, whether the screen still looks like the name. Two "no"s in a
 *    row put the name in doubt: the same "Still <name>?", and nothing sent.
 *    "unsure" changes nothing; menus and loading screens count as "unsure".
 */

import { sameGame } from './names.ts'

export type MatchAnswer = 'yes' | 'no' | 'unsure'
/** Why the chip is asking "Still <name>?". */
export type WatchingDoubt = 'session' | 'screen'

export interface WatchingCore {
  /** The name in use: the only one that reaches the model. */
  confirmed: string | null
  /** The name that was in use until a session ended or the screen stopped matching. Never sent. */
  lastConfirmed: string | null
  doubt: WatchingDoubt | null
  /** `confirmed` belongs to a session (confirmed during one, or carried into one). */
  inSession: boolean
  /** "no"s in a row from the screen check. */
  noCount: number
  /** How many in a row put the name in doubt. */
  noLimit: number
}

/** Two "no"s in a row (D-099). */
export const NO_LIMIT = 2
/**
 * A user who answers "yes, still that" to a screen doubt knows better than the
 * vision model. Each such answer doubles how many "no"s it takes to ask again,
 * up to this many, until the session ends.
 */
export const NO_LIMIT_MAX = 8

export interface StoredWatching {
  confirmed?: string | null
  lastConfirmed?: string | null
  doubt?: WatchingDoubt | null
  inSession?: boolean
}

export function watchingFrom(stored: StoredWatching | null | undefined, clean: (text: unknown) => string | null): WatchingCore {
  const confirmed = clean(stored?.confirmed)
  const lastConfirmed = confirmed ? null : clean(stored?.lastConfirmed)
  return {
    confirmed,
    lastConfirmed,
    doubt: lastConfirmed ? (stored?.doubt === 'screen' ? 'screen' : 'session') : null,
    // A name stored before D-099 has no flag: treat it as from a session, so the next Start asks.
    inSession: confirmed ? stored?.inSession !== false : false,
    noCount: 0,
    noLimit: NO_LIMIT,
  }
}

export function storedWatching(w: WatchingCore): StoredWatching {
  return { confirmed: w.confirmed, lastConfirmed: w.lastConfirmed, doubt: w.doubt, inSession: w.inSession }
}

/** The user confirmed, typed or cleared a name. `live`: a session is running. */
export function confirmWatching(w: WatchingCore, name: string | null, live: boolean): void {
  // "Yes, still that", against the screen's doubt: believe the user for longer.
  const overruled = !!name && w.doubt === 'screen' && sameGame(name, w.lastConfirmed)
  w.noLimit = overruled ? Math.min(NO_LIMIT_MAX, w.noLimit * 2) : NO_LIMIT
  w.confirmed = name
  w.lastConfirmed = null
  w.doubt = null
  w.inSession = !!name && live
  w.noCount = 0
}

function expire(w: WatchingCore, why: WatchingDoubt): void {
  w.lastConfirmed = w.confirmed
  w.confirmed = null
  w.doubt = why
  w.inSession = false
  w.noCount = 0
}

/**
 * A session started. A name left over from a session that never reported its end
 * (the browser closed) expires now; one confirmed since the last session ended is
 * the user's fresh word and carries into this session.
 */
export function sessionStarted(w: WatchingCore): 'expired' | 'kept' | 'asking' | 'none' {
  w.noCount = 0
  w.noLimit = NO_LIMIT
  if (w.confirmed && w.inSession) {
    expire(w, 'session')
    return 'expired'
  }
  if (w.confirmed) {
    w.inSession = true
    return 'kept'
  }
  return w.lastConfirmed ? 'asking' : 'none'
}

/** A session ended (Stop, auto-stop, the browser's Stop sharing). True when a name expired. */
export function sessionEnded(w: WatchingCore): boolean {
  w.noLimit = NO_LIMIT
  w.noCount = 0
  if (!w.confirmed) return false
  expire(w, 'session')
  return true
}

/**
 * The vision model's answer to "does this screen look like <confirmed>?".
 * `counted` is the answer as it was taken (a "no" on a menu or a loading screen is
 * taken as "unsure"); `doubted` is true when this answer put the name in doubt.
 */
export function screenCheck(w: WatchingCore, answer: MatchAnswer | null, kind: string): { counted: MatchAnswer | null; doubted: boolean } {
  if (!w.confirmed || !answer) return { counted: null, doubted: false }
  const counted: MatchAnswer = answer === 'no' && (kind === 'menu' || kind === 'loading') ? 'unsure' : answer
  if (counted === 'yes') w.noCount = 0
  if (counted !== 'no') return { counted, doubted: false }
  w.noCount += 1
  if (w.noCount < w.noLimit) return { counted, doubted: false }
  expire(w, 'screen')
  return { counted, doubted: true }
}
