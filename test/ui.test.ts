import { describe, expect, test } from 'bun:test'

// A DOM just big enough for the `[?]`: the kit builds with createElement, properties and append.
class FakeEl {
  tag: string
  className = ''
  id = ''
  hidden = false
  dataset: Record<string, string> = {}
  textContent = ''
  innerHTML = ''
  type = ''
  children: FakeEl[] = []
  attrs = new Map<string, string>()
  listeners = new Map<string, ((ev: unknown) => void)[]>()
  constructor(tag: string) {
    this.tag = tag
  }
  append(...nodes: (FakeEl | string)[]) {
    for (const n of nodes) if (typeof n !== 'string') this.children.push(n)
  }
  appendChild(n: FakeEl) {
    this.children.push(n)
    return n
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v)
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null
  }
  addEventListener(name: string, fn: (ev: unknown) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn])
  }
  fire(name: string, ev: Record<string, unknown> = {}) {
    const full = { preventDefault() {}, stopPropagation() {}, ...ev }
    for (const fn of this.listeners.get(name) ?? []) fn(full)
  }
}
;(globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeEl(tag) }

const { helpTip, helpRow, captionHelp, statusLines, button, buttonClass, confirmDanger } = await import('../src/ui.ts')
const fake = (x: unknown) => x as FakeEl

describe('the [?] help tip (D-085)', () => {
  test('the note is hidden at creation and the button says so', () => {
    const tip = helpTip('Portrait size', 'How tall the portrait is.')
    expect(tip.note.hidden).toBe(true)
    expect(tip.button.getAttribute('aria-expanded')).toBe('false')
    expect(tip.button.getAttribute('aria-label')).toBe('Help: Portrait size')
    expect(tip.button.getAttribute('aria-controls')).toBe(tip.note.id)
    expect(tip.note.getAttribute('role')).toBe('note')
    expect(fake(tip.button).type).toBe('button')
  })

  test('a press opens it, another closes it, and Escape closes it', () => {
    const tip = helpTip('Text size', 'The size of the text.')
    fake(tip.button).fire('click')
    expect(tip.note.hidden).toBe(false)
    expect(tip.button.getAttribute('aria-expanded')).toBe('true')
    fake(tip.button).fire('click')
    expect(tip.note.hidden).toBe(true)
    fake(tip.button).fire('click')
    fake(tip.button).fire('keydown', { key: 'Escape' })
    expect(tip.note.hidden).toBe(true)
    expect(tip.button.getAttribute('aria-expanded')).toBe('false')
  })

  test('a press never reaches the fold it sits in, and opening tells the card', () => {
    let opened = 0
    let stopped = 0
    let prevented = 0
    const tip = helpTip('Pacing', 'How choosy it is.', () => opened++)
    const ev = { preventDefault: () => prevented++, stopPropagation: () => stopped++ }
    fake(tip.button).fire('click', ev) // opens
    fake(tip.button).fire('click', ev) // closes: the card is left alone
    expect(opened).toBe(1)
    expect(stopped).toBe(2)
    expect(prevented).toBe(2)
  })

  test('help left open stays open when the panel is redrawn', () => {
    const first = helpTip('Stance', 'Mocks what it sees.')
    fake(first.button).fire('click')
    const redrawn = helpTip('Stance', 'Mocks what it sees.')
    expect(redrawn.note.hidden).toBe(false)
    expect(redrawn.button.getAttribute('aria-expanded')).toBe('true')
    fake(redrawn.button).fire('click')
    expect(helpTip('Stance', 'Mocks what it sees.').note.hidden).toBe(true)
    // A different text under the same label is different help.
    expect(helpTip('Stance', 'Offers a pointer.').note.hidden).toBe(true)
  })

  test('several paragraphs and ready-made nodes both go in the note', () => {
    const node = new FakeEl('div') as unknown as Node
    const tip = helpTip('Look things up', ['First.', 'Second.', node])
    const kids = fake(tip.note).children
    expect(kids.length).toBe(3)
    expect(kids[0]!.tag).toBe('p')
    expect(kids[0]!.textContent).toBe('First.')
    expect(kids[2]).toBe(fake(node))
  })

  test('a row and a caption carry the button beside them and the note under them', () => {
    const row = new FakeEl('div') as unknown as HTMLElement
    const stack = fake(helpRow(row, 'Speak reactions aloud', 'Reads each reaction aloud.'))
    expect(stack.className).toBe('hl-stack')
    expect(stack.children[0]!.className).toBe('hl-helprow')
    expect(stack.children[0]!.children[0]).toBe(fake(row))
    expect(stack.children[0]!.children[1]!.className).toBe('hl-help-btn')
    expect(stack.children[1]!.className).toBe('hl-help')
    expect(stack.children[1]!.hidden).toBe(true)
    const cap = fake(captionHelp(new FakeEl('span') as unknown as HTMLElement, 'Webcam', 'A preview appears.'))
    expect(cap.children[0]!.className).toBe('hl-caprow')
    expect(cap.children[1]!.hidden).toBe(true)
  })
})

describe('status and failure lines (D-086)', () => {
  test('both lines start hidden; a status shows and empty text hides it', () => {
    const lines = statusLines()
    const [statusEl, failEl] = fake(lines.root).children
    expect(statusEl.hidden).toBe(true)
    expect(failEl.hidden).toBe(true)
    lines.status('Sent a 1280×720 frame.')
    expect(statusEl.hidden).toBe(false)
    expect(statusEl.textContent).toBe('Sent a 1280×720 frame.')
    lines.status('')
    expect(statusEl.hidden).toBe(true)
    expect(statusEl.getAttribute('role')).toBe('status')
    expect(failEl.getAttribute('role')).toBe('alert')
  })

  test('the next status cannot erase a failure; Dismiss and clearFailure can', () => {
    const lines = statusLines()
    const failEl = fake(lines.root).children[1]
    const dismiss = failEl.children[1]
    lines.fail('Your computer did not answer.')
    lines.status('Sent a 1280×720 frame.')
    expect(failEl.hidden).toBe(false)
    expect(lines.failure).toBe('Your computer did not answer.')
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss')
    dismiss.fire('click')
    expect(failEl.hidden).toBe(true)
    expect(lines.failure).toBe('')
    lines.fail('Snap failed.')
    lines.clearFailure()
    expect(lines.failure).toBe('')
  })
})

describe('button intents (D-086)', () => {
  test('default, primary, small and danger, and the old `true` for primary', () => {
    expect(buttonClass()).toBe('hl-btn')
    expect(buttonClass('small')).toBe('hl-btn hl-btn-small')
    expect(buttonClass('danger')).toBe('hl-btn hl-btn-danger')
    expect(fake(button('Save', () => {}, true)).className).toBe('hl-btn hl-btn-primary')
    expect(fake(button('Delete', () => {}, 'danger')).className).toBe('hl-btn hl-btn-danger')
    expect(fake(button('Edit', () => {})).type).toBe('button')
  })
})

describe('every delete and reset asks first (D-087, D-088)', () => {
  test("Lumiverse's dialog, danger variant; cancel is no, confirm is yes", async () => {
    const asked: unknown[] = []
    let answer = false
    const ctx = { ui: { showConfirm: async (o: unknown) => { asked.push(o); return { confirmed: answer } } } }
    expect(await confirmDanger(ctx as never, 'Reset Prompts', 'Every prompt goes back.', 'Reset')).toBe(false)
    answer = true
    expect(await confirmDanger(ctx as never, 'Reset Prompts', 'Every prompt goes back.', 'Reset')).toBe(true)
    expect(asked[0]).toEqual({ title: 'Reset Prompts', message: 'Every prompt goes back.', variant: 'danger', confirmLabel: 'Reset' })
  })

  test('a dialog that throws, or no way to ask at all, never acts', async () => {
    const throwing = { ui: { showConfirm: async () => { throw new Error('closed') } } }
    expect(await confirmDanger(throwing as never, 'Delete', 'x', 'Delete')).toBe(false)
    expect(await confirmDanger({ ui: {} } as never, 'Delete', 'x', 'Delete')).toBe(false)
  })
})

describe('the look (D-089)', () => {
  test('every font size is one of the four, and they follow Lumiverse\'s text size', async () => {
    const { SHARED_STYLES } = await import('../src/ui.ts')
    const { TAB_STYLES } = await import('../src/capture-tab.ts')
    const sizes = [...(SHARED_STYLES + TAB_STYLES).matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim())
    expect(sizes.length).toBeGreaterThan(10)
    for (const s of sizes) expect(['var(--hl-fs-title)', 'var(--hl-fs-label)', 'var(--hl-fs-help)', 'var(--hl-fs-caption)']).toContain(s)
    for (const v of ['--hl-fs-title', '--hl-fs-label', '--hl-fs-help', '--hl-fs-caption']) {
      expect(SHARED_STYLES).toMatch(new RegExp(`${v}: calc\\([0-9.]+px \\* var\\(--lumiverse-font-scale, 1\\)\\)`))
    }
  })

  test('every card has an icon and none repeats', async () => {
    const { ICON_NAMES, CARD_ICONS, iconSvg } = await import('../src/icons.ts')
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
    expect(new Set(CARD_ICONS).size).toBe(17) // six in the tab (Session's phone form included) and eleven in the full settings
    for (const n of CARD_ICONS) expect(ICON_NAMES).toContain(n)
    for (const n of ICON_NAMES) expect(iconSvg(n)).toContain('stroke="currentColor"')
  })
})
