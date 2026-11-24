/**
 * Scene comparison, kept separate from backend.ts so it can be tested without
 * the `spindle` runtime (backend.ts registers handlers on import).
 */

/**
 * Word overlap between two scene descriptions, 0–1 (Jaccard index).
 *
 * Deliberately crude. It only needs to catch "the screen barely moved, so the
 * vision model wrote almost the same sentence again" — not semantic similarity.
 * Words of three characters or fewer are dropped so shared articles and
 * prepositions don't inflate the score.
 */
export function sceneSimilarity(a: string, b: string): number {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2),
    )

  const setA = words(a)
  const setB = words(b)
  if (setA.size === 0 || setB.size === 0) return 0

  let shared = 0
  for (const word of setA) if (setB.has(word)) shared += 1
  return shared / (setA.size + setB.size - shared)
}

/** Above this, two scenes are treated as the same moment and the second is skipped. */
export const SAME_MOMENT_SIMILARITY = 0.8
