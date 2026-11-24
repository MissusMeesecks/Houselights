import { describe, expect, test } from 'bun:test'
import { GUIDE_MARKDOWN, GUIDE_SOURCE, unwrapMarkdown } from '../src/guide.ts'

describe('the guide is unwrapped for Lumiverse, which keeps line breaks (D-104)', () => {
  test('a wrapped paragraph becomes one line', () => {
    expect(unwrapMarkdown('Start session opens your\nbrowser\'s share dialog.\n\nNext one.')).toBe("Start session opens your browser's share dialog.\n\nNext one.")
  })
  test('headings stay on their own line, and the line after a heading is not joined to it', () => {
    expect(unwrapMarkdown('## Session\nStart it.\nNow.')).toBe('## Session\nStart it. Now.')
  })
  test('each list item stays its own line, with its indented continuation joined to it', () => {
    expect(unwrapMarkdown('- One search per change\n  of that text.\n- A second item.\n1. Numbered\n   too.')).toBe(
      '- One search per change of that text.\n- A second item.\n1. Numbered too.',
    )
  })
  test('bold that was split across a wrap is joined back together', () => {
    expect(unwrapMarkdown('and **Curtain call when\na session ends**, under Pacing.')).toBe('and **Curtain call when a session ends**, under Pacing.')
  })
  test('the real guide: no paragraph carries a line break, and no words are lost', () => {
    const words = (t: string) => t.split(/\s+/).filter(Boolean)
    expect(words(GUIDE_MARKDOWN)).toEqual(words(GUIDE_SOURCE))
    for (const line of GUIDE_MARKDOWN.split('\n')) {
      if (!line.trim()) continue
      // Every line is a heading, a list item or a whole paragraph: never a continuation.
      expect(/^\s/.test(line)).toBe(false)
    }
    const paragraphs = GUIDE_MARKDOWN.split(/\n\s*\n/).filter((p) => p.trim() && !/^(#|- |\d+\. )/.test(p.trim()))
    for (const p of paragraphs) expect(p.trim().includes('\n')).toBe(false)
    expect(GUIDE_MARKDOWN).toContain('**Curtain call when a session ends**')
  })
})
