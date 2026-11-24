import { expect, test, describe } from 'bun:test'
import { sceneSimilarity, SAME_MOMENT_SIMILARITY } from '../src/similarity.ts'

const same = (a: string, b: string) => sceneSimilarity(a, b) >= SAME_MOMENT_SIMILARITY

describe('sceneSimilarity', () => {
  test('identical text scores 1', () => {
    expect(sceneSimilarity('Health at 5 percent.', 'Health at 5 percent.')).toBe(1)
  })

  test('unrelated scenes score near zero', () => {
    expect(sceneSimilarity('A menu is open.', 'The boss throws a fireball.')).toBeLessThan(0.2)
  })

  test('punctuation and casing do not affect the score', () => {
    expect(sceneSimilarity('Health at 5%!', 'health at 5%')).toBe(1)
  })

  test('empty input scores zero rather than dividing by zero', () => {
    expect(sceneSimilarity('', 'anything at all')).toBe(0)
    expect(sceneSimilarity('', '')).toBe(0)
  })

  test('short filler words are ignored, so shared grammar does not inflate it', () => {
    // Only "the", "is", "on" and "a" overlap — all too short to count.
    expect(sceneSimilarity('the player is on a horse', 'the dragon is on a rooftop')).toBeLessThan(0.4)
  })

  test('it is symmetric', () => {
    const a = 'Player health low, boss winding up.'
    const b = 'Boss winding up while player health drops.'
    expect(sceneSimilarity(a, b)).toBe(sceneSimilarity(b, a))
  })
})

describe('the same-moment threshold', () => {
  test('a barely-reworded description counts as the same moment', () => {
    expect(
      same(
        'Player health is low. The boss is winding up an attack.',
        'Player health is low. The boss is winding up an attack!',
      ),
    ).toBe(true)
  })

  test('a genuinely new moment in the same scene is not suppressed', () => {
    expect(
      same(
        'Player health is low. The boss is winding up an attack.',
        'The player died. A respawn prompt is showing.',
      ),
    ).toBe(false)
  })

  test('the same setting with a different event still gets through', () => {
    expect(
      same(
        'The player is exploring a stone corridor lit by torches.',
        'The player is exploring a stone corridor and a trapdoor just opened.',
      ),
    ).toBe(false)
  })
})
