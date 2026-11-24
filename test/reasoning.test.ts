import { describe, expect, test } from 'bun:test'
import { noThinkingOverride, reasoningLength, REASONING_HEADROOM, withHeadroom } from '../src/reasoning.ts'

describe('noThinkingOverride', () => {
  test('OpenRouter gets an explicit effort of none, because "off" is a no-op there', () => {
    expect(noThinkingOverride('openrouter')).toEqual({ source: 'custom', apiReasoning: true, effort: 'none' })
  })
  test('every other provider, and no provider, gets the generic off switch', () => {
    for (const p of ['deepseek', 'anthropic', 'custom', 'openai', '', null, undefined]) {
      expect(noThinkingOverride(p)).toEqual({ source: 'off' })
    }
  })
})

describe('withHeadroom', () => {
  const base = { type: 'quiet' as const, messages: [], parameters: { max_tokens: 300, temperature: 1 } }
  test('raises max_tokens and keeps the other parameters', () => {
    const out = withHeadroom(base, REASONING_HEADROOM)
    expect(out.parameters).toEqual({ max_tokens: 300 + REASONING_HEADROOM, temperature: 1 })
    expect(base.parameters.max_tokens).toBe(300) // untouched
  })
  test('does nothing for zero headroom or a request without a cap', () => {
    expect(withHeadroom(base, 0)).toBe(base)
    const uncapped = { type: 'quiet' as const, messages: [], parameters: { temperature: 1 } }
    expect(withHeadroom(uncapped, 4096)).toBe(uncapped)
  })
})

describe('reasoningLength', () => {
  test('counts reasoning text, flags thinking blocks, and is zero otherwise', () => {
    expect(reasoningLength({ content: 'x', reasoning: 'abc' })).toBe(3)
    expect(reasoningLength({ content: 'x', thinking_blocks: [{ type: 'thinking', thinking: 'y' }] as never })).toBe(1)
    expect(reasoningLength({ content: 'x' })).toBe(0)
    expect(reasoningLength(undefined)).toBe(0)
  })
})
