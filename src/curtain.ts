/**
 * D-100: the curtain call. When a session ends, the character says one closing
 * line about it. This file is the bookkeeping, kept free of the host so it can
 * be tested: what a session saw, and whether it earned a closing line.
 *
 * A moment is "interesting" when the user pressed for it (the press is the
 * judgment) or the vision model scored it at or above the pacing bar. In attach
 * mode nothing is described, so there are no moments to list; a session then
 * earns its closing line by having drawn at least one reaction.
 */

export interface SessionMoment {
  /** The user's clock, as it is written on the hidden notes. */
  time: string
  scene: string
  interest: number
  /** A Look the user pressed, as opposed to one taken on the timer. */
  pressed: boolean
}

export interface SessionLog {
  startedAt: number
  moments: SessionMoment[]
  /** Reactions that landed in the chat during the session. */
  reactions: number
}

/** A session shorter than this gets no curtain call. */
export const CURTAIN_MIN_MS = 120_000
/** How many moments the closing line is given. */
export const CURTAIN_MOMENTS_MAX = 5
/** How many are kept while the session runs. */
export const SESSION_MOMENTS_KEPT = 40

export function newSessionLog(now: number): SessionLog {
  return { startedAt: now, moments: [], reactions: 0 }
}

/**
 * Keep a moment. The same moment seen twice in a row (`same`) is kept once, at
 * its higher score. Over the limit, the least interesting goes, oldest first.
 */
export function noteMoment(log: SessionLog, moment: SessionMoment, same: (a: string, b: string) => boolean): void {
  const scene = moment.scene.trim()
  if (!scene) return
  const last = log.moments[log.moments.length - 1]
  if (last && same(last.scene, scene)) {
    if (moment.interest > last.interest) log.moments[log.moments.length - 1] = { ...moment, scene, pressed: moment.pressed || last.pressed }
    else if (moment.pressed) last.pressed = true
    return
  }
  log.moments.push({ ...moment, scene })
  if (log.moments.length <= SESSION_MOMENTS_KEPT) return
  let drop = 0
  for (let i = 1; i < log.moments.length; i++) if (log.moments[i]!.interest < log.moments[drop]!.interest) drop = i
  log.moments.splice(drop, 1)
}

/** The moments for the closing line: the most interesting, in the order they happened. */
export function curtainMoments(log: SessionLog, max = CURTAIN_MOMENTS_MAX): SessionMoment[] {
  const ranked = log.moments
    .map((m, i) => ({ m, i }))
    // The highest score first; between equals, the later one.
    .sort((a, b) => b.m.interest - a.m.interest || b.i - a.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
  return ranked.map((r) => r.m)
}

export type CurtainVerdict = 'due' | 'short' | 'nothing'

/** Did this session earn a closing line? */
export function curtainDue(log: SessionLog, endedAt: number): CurtainVerdict {
  if (endedAt - log.startedAt < CURTAIN_MIN_MS) return 'short'
  return log.moments.length > 0 || log.reactions > 0 ? 'due' : 'nothing'
}

/** Whole minutes, never less than one. */
export function sessionMinutes(log: SessionLog, endedAt: number): number {
  return Math.max(1, Math.round((endedAt - log.startedAt) / 60_000))
}
