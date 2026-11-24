import { describe, expect, test } from 'bun:test'
import { cssColor, isDark, over, parseColor, resolveThemeCss } from '../src/pane.ts'

describe('resolveThemeCss', () => {
  const theme: Record<string, string> = {
    '--lumiverse-text': 'rgba(255, 255, 255, 0.9)',
    '--lumiverse-fill': 'rgba(0, 0, 0, 0.15)',
  }
  const lookup = (name: string) => theme[name] ?? ''

  test('substitutes host values and leaves no var() behind', () => {
    const out = resolveThemeCss('.a { color: var(--lumiverse-text, #fff); background: var(--lumiverse-fill, rgba(20,20,28,0.95)); }', lookup)
    expect(out).toBe('.a { color: rgba(255, 255, 255, 0.9); background: rgba(0, 0, 0, 0.15); }')
    expect(out).not.toContain('var(')
  })

  test('falls back when the host does not define a variable, including parenthesised fallbacks', () => {
    expect(resolveThemeCss('x: var(--lumiverse-radius, 8px);', lookup)).toBe('x: 8px;')
    expect(resolveThemeCss('x: var(--lumiverse-border, rgba(128,128,128,0.3));', lookup)).toBe('x: rgba(128,128,128,0.3);')
    expect(resolveThemeCss('x: var(--lumiverse-text-muted, inherit);', lookup)).toBe('x: inherit;')
  })

  test('resolves a fallback that is itself a var()', () => {
    expect(resolveThemeCss('x: var(--lumiverse-border-hover, var(--lumiverse-accent, currentColor));', lookup)).toBe('x: currentColor;')
    expect(resolveThemeCss('x: var(--lumiverse-border-hover, var(--lumiverse-text, currentColor));', lookup)).toBe('x: rgba(255, 255, 255, 0.9);')
  })

  test('D-058: the accent falls through to the theme engine\'s primary in the pop-out', () => {
    const engine = (name: string) => ({ '--lumiverse-primary': 'hsla(150, 60%, 50%, 0.9)' } as Record<string, string>)[name] ?? ''
    expect(resolveThemeCss('x: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2));', engine)).toBe('x: hsla(150, 60%, 50%, 0.9);')
    expect(resolveThemeCss('x: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2));', lookup)).toBe('x: #7e57c2;')
  })

  test('D-062: the measured solid surface reaches the pop-out for options, corner and caption', async () => {
    const { PANE_STYLES } = await import('../src/pane.ts')
    const theme = (name: string) => ({ '--hl-surface': 'rgb(18, 22, 20)', '--lumiverse-text': 'rgba(230, 240, 235, 0.9)' } as Record<string, string>)[name] ?? ''
    const sheet = resolveThemeCss(PANE_STYLES, theme)
    expect(sheet).toContain('.hl-pane-stance-select option { background-color: rgb(18, 22, 20); color: rgba(230, 240, 235, 0.9); }')
    expect(sheet).toContain('linear-gradient(to top, rgb(18, 22, 20) calc(100% - 18px), transparent)')
    expect(sheet).not.toContain('var(')
  })

  test('a variable with no fallback and no value becomes empty', () => {
    expect(resolveThemeCss('x: var(--lumiverse-nope);', lookup)).toBe('x: ;')
  })
})

describe('colours', () => {
  test('parses the forms getComputedStyle produces', () => {
    expect(parseColor('rgb(28, 24, 38)')).toEqual({ r: 28, g: 24, b: 38, a: 1 })
    expect(parseColor('rgba(0, 0, 0, 0.15)')).toEqual({ r: 0, g: 0, b: 0, a: 0.15 })
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor('rgb(28 24 38 / 0.5)')).toEqual({ r: 28, g: 24, b: 38, a: 0.5 })
    expect(parseColor('transparent')).toBeNull()
    expect(parseColor('')).toBeNull()
  })

  test('composites the host page the way the browser does', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 }
    const page = over(white, { r: 28, g: 24, b: 38, a: 0.95 }) // --lumiverse-bg over the canvas
    expect(cssColor(page)).toBe('rgb(39, 36, 49)')
    const pane = over(page, { r: 0, g: 0, b: 0, a: 0.15 }) // --lumiverse-fill on top
    expect(cssColor(pane)).toBe('rgb(33, 30, 42)')
    expect(isDark(pane)).toBe(true)
    expect(isDark(white)).toBe(false)
    // Fully transparent on top changes nothing.
    expect(over(page, { r: 255, g: 0, b: 0, a: 0 })).toEqual(page)
  })
})

describe('compositeStack', () => {
  test('composites bottom-most first, so the page surface sits under translucent layers', () => {
    const { compositeStack } = require('../src/pane.ts') as typeof import('../src/pane.ts')
    const html = { id: 'html' } as unknown as Element
    const shell = { id: 'shell' } as unknown as Element
    const overlay = { id: 'overlay' } as unknown as Element
    const bg: Record<string, string> = { html: 'rgba(0, 0, 0, 0)', shell: 'rgba(28, 24, 38, 0.95)', overlay: 'rgba(0, 0, 0, 0.15)' }
    const stack = [overlay, shell, html] // topmost first, as elementsFromPoint returns
    expect(cssColor(compositeStack(stack, (el) => bg[(el as unknown as { id: string }).id]))).toBe('rgb(33, 30, 42)')
    expect(cssColor(compositeStack([], () => ''))).toBe('rgb(255, 255, 255)')
  })
})
