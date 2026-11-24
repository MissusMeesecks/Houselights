/**
 * UI builders shared by the settings panel and the capture tab.
 *
 * Two rules keep the extension looking native under any Lumiverse theme:
 *
 * 1. Form controls are Lumiverse's own shared components (`ctx.components.*`)
 *    whenever the host offers them. The host renders its real React widgets
 *    into an element we own, so they pick up the theme, density and glass
 *    mode with no styling on our side. Older hosts without `ctx.components`
 *    get plain elements styled with the documented `--lumiverse-*` variables.
 * 2. Everything is built with `document.createElement` + property assignment,
 *    never HTML strings, so nothing passes through the host's sanitizer and
 *    attributes like `capture="user"` survive (Phase 0 v2, S5).
 *
 * Mounted components must be destroyed when their DOM is replaced, so the
 * builders live on a *scope*: call `scope.reset()` before rebuilding the part
 * of the page that scope owns.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const c of children) node.append(c)
  return node
}

export function note(text: string, extraClass?: string): HTMLElement {
  return el('p', { className: extraClass ? `hl-sub ${extraClass}` : 'hl-sub', textContent: text })
}

export function statusClass(kind: 'info' | 'ok' | 'err'): string {
  return kind === 'err' ? 'hl-status err' : kind === 'ok' ? 'hl-status ok' : 'hl-status'
}

const X_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'

/**
 * D-086: status and failure, two lines, never one (style guide §2, lesson B3).
 * The status line is ambient and replaced freely ("Sent a 1280×720 frame.").
 * The failure line is something that did not happen, in the danger colour; it
 * stays until it is dismissed or `clearFailure` runs (the chat changed), so the
 * next ordinary status cannot erase it.
 */
export interface StatusLines {
  root: HTMLElement
  /** The ambient line. Empty text hides it. `ok` and `info` look the same. */
  status(text: string): void
  /** A failure: shown until dismissed or cleared. Showing a second one replaces the first. */
  fail(text: string): void
  clearFailure(): void
  /** The failure on show, or '' (for tests and for callers that must not repeat one). */
  readonly failure: string
}

export function statusLines(): StatusLines {
  const statusEl = el('div', { className: 'hl-status' })
  statusEl.setAttribute('role', 'status')
  const failText = el('span')
  const dismiss = el('button', { className: 'hl-icon-btn' })
  dismiss.type = 'button'
  dismiss.innerHTML = X_ICON
  dismiss.setAttribute('aria-label', 'Dismiss')
  const failEl = el('div', { className: 'hl-status err hl-failure' }, [failText, dismiss])
  failEl.setAttribute('role', 'alert')
  statusEl.hidden = true
  failEl.hidden = true
  const clearFailure = (): void => {
    failText.textContent = ''
    failEl.hidden = true
  }
  dismiss.addEventListener('click', clearFailure)
  return {
    root: el('div', { className: 'hl-lines' }, [statusEl, failEl]),
    status(text) {
      statusEl.textContent = text
      statusEl.hidden = !text
    },
    fail(text) {
      failText.textContent = text
      failEl.hidden = !text
    },
    clearFailure,
    get failure() {
      return failEl.hidden ? '' : (failText.textContent ?? '')
    },
  }
}

/**
 * D-085: the `[?]`. All help sits behind a small button after its label and
 * opens in place, under the row (style guide §3): nothing hovers, nothing
 * floats, and a phone reads it the same way. The text is in the page from the
 * first paint, hidden by a rule, so a search can find it later.
 */
export type HelpContent = string | Node | (string | Node)[]

export interface HelpTip {
  button: HTMLButtonElement
  note: HTMLElement
}

const HELP_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'

/** Help the user has opened, by label: a redraw of the panel must not close it (lesson B5). */
const openHelp = new Set<string>()
/** How to open or close a note from outside (the search), without remembering it. */
const helpSetters = new WeakMap<HTMLElement, (open: boolean, remember?: boolean) => void>()
let helpSeq = 0

function helpKey(label: string, content: HelpContent): string {
  const first = Array.isArray(content) ? content[0] : content
  const text = typeof first === 'string' ? first : (first?.textContent ?? '')
  return `${label}|${text.slice(0, 48)}`
}

/** A `[?]` and the note it opens. `onOpen` runs as the note opens (a card header opens its card). */
export function helpTip(label: string, content: HelpContent, onOpen?: () => void): HelpTip {
  const id = `hl-help-${++helpSeq}`
  const key = helpKey(label, content)
  const noteEl = el('div', { className: 'hl-help', id })
  noteEl.setAttribute('role', 'note')
  for (const part of Array.isArray(content) ? content : [content]) {
    noteEl.appendChild(typeof part === 'string' ? el('p', { textContent: part }) : part)
  }
  const b = el('button', { className: 'hl-help-btn' })
  b.type = 'button'
  b.innerHTML = HELP_ICON
  b.setAttribute('aria-label', `Help: ${label}`)
  b.setAttribute('aria-controls', id)
  const set = (open: boolean, remember = true): void => {
    noteEl.hidden = !open
    b.setAttribute('aria-expanded', String(open))
    if (!remember) return
    if (open) openHelp.add(key)
    else openHelp.delete(key)
  }
  set(openHelp.has(key))
  helpSetters.set(noteEl, set)
  b.addEventListener('click', (ev) => {
    // Inside a fold's header a press must not fold the card.
    ev.preventDefault()
    ev.stopPropagation()
    const opening = noteEl.hidden
    delete noteEl.dataset.hlBySearch // a press is the user's own: the search will not close it
    set(opening)
    if (opening) onOpen?.()
  })
  b.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !noteEl.hidden) {
      ev.stopPropagation()
      set(false)
    }
  })
  return { button: b, note: noteEl }
}

/** A row with a `[?]` at its end and the note under it. */
export function helpRow(row: HTMLElement, label: string, content: HelpContent): HTMLElement {
  const tip = helpTip(label, content)
  return el('div', { className: 'hl-stack' }, [el('div', { className: 'hl-helprow' }, [row, tip.button]), tip.note])
}

/** A caption (or any short heading) with a `[?]` directly after it and the note under it. */
export function captionHelp(caption: HTMLElement, label: string, content: HelpContent): HTMLElement {
  const tip = helpTip(label, content)
  const row = el('div', { className: 'hl-caprow' }, [caption, tip.button])
  // A caption's gap above belongs to the row, or the button sits off its line.
  if (caption.classList?.contains('hl-subhead-gap')) {
    caption.classList.remove('hl-subhead-gap')
    row.classList.add('hl-subhead-gap')
  }
  return el('div', { className: 'hl-stack' }, [row, tip.note])
}

/**
 * A button. Lumiverse ships no shared button, so this is ours, themed with its variables.
 * D-086: the style guide's intents (§2): `default`, `small` (secondary actions, rows in
 * lists), `danger` (deletes and resets, at the far end of their row), plus `primary`, the one
 * accent-filled button a card may keep (D9). `true` still means primary.
 */
export type ButtonKind = 'default' | 'primary' | 'small' | 'danger'
export function buttonClass(kind: ButtonKind = 'default'): string {
  return kind === 'default' ? 'hl-btn' : `hl-btn hl-btn-${kind}`
}
export function button(label: string, onClick: () => void, kind: ButtonKind | boolean = 'default'): HTMLButtonElement {
  const k: ButtonKind = kind === true ? 'primary' : kind === false ? 'default' : kind
  const b = el('button', { className: buttonClass(k), textContent: label })
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

/**
 * D-087/D-088: Lumiverse's own confirm dialog (style guide §2): the title names the action, the
 * button is the verb. A host without it gets the browser's own confirm, so nothing acts unasked.
 */
export async function confirmDanger(ctx: SpindleFrontendContext, title: string, message: string, confirmLabel: string): Promise<boolean> {
  const ui = ctx.ui as { showConfirm?: (o: { title: string; message: string; variant?: 'danger'; confirmLabel?: string }) => Promise<{ confirmed: boolean }> }
  if (typeof ui.showConfirm === 'function') {
    try {
      return (await ui.showConfirm({ title, message, variant: 'danger', confirmLabel })).confirmed === true
    } catch {
      return false
    }
  }
  return typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(`${title}\n\n${message}`) : false
}

/** A row of buttons with the destructive ones apart, at the far end (style guide §2). */
export function buttonRow(buttons: HTMLElement[], apart: HTMLElement[] = []): HTMLElement {
  const row = el('div', { className: 'hl-btns' }, buttons)
  if (apart.length) row.appendChild(el('div', { className: 'hl-btns hl-btns-apart' }, apart))
  return row
}

/**
 * D-086, D1: the search at the top of the full settings, after Lumiverse's
 * SearchField. It filters the cards (`details.hl-fold` with `data-section`)
 * inside `scope`: a card whose title or header help holds the query shows
 * whole; otherwise a card shows the rows (its body's direct children) that
 * hold it, each with the caption above it; a card with nothing to show is
 * hidden. What shows is opened, and help that holds the query is opened so
 * the row says why it matched. Opening by search is not remembered, and an
 * empty box puts every card back as it was.
 */
export interface SettingsSearch {
  root: HTMLElement
  input: HTMLInputElement
  /** Filter now. Call after every redraw of `scope`. */
  apply(): void
}

const SEARCH_OUT = 'hl-search-out'
const lower = (node: Element | null | undefined): string => (node?.textContent ?? '').toLowerCase()

function isCaption(node: Element): boolean {
  if (node.classList.contains('hl-subhead')) return true
  const first = node.firstElementChild
  return node.classList.contains('hl-stack') && !!first && first.classList.contains('hl-caprow')
}

export function settingsSearch(scope: HTMLElement): SettingsSearch {
  const input = el('input', { className: 'hl-search-input' }) as HTMLInputElement
  input.type = 'text'
  input.placeholder = 'Search settings'
  input.autocomplete = 'off'
  input.spellcheck = false
  input.setAttribute('aria-label', 'Search settings')
  const glass = el('span', { className: 'hl-search-icon' })
  glass.innerHTML = SEARCH_ICON
  const clear = el('button', { className: 'hl-icon-btn' })
  clear.type = 'button'
  clear.innerHTML = X_ICON
  clear.setAttribute('aria-label', 'Clear the search')
  clear.hidden = true
  const empty = el('div', { className: 'hl-status' })
  empty.setAttribute('role', 'status')
  empty.hidden = true
  const root = el('div', { className: 'hl-search' }, [el('div', { className: 'hl-search-field' }, [glass, input, clear]), empty])

  function apply(): void {
    const query = input.value.trim().toLowerCase()
    clear.hidden = !input.value
    let shown = 0
    // The search hides with its own class, never with `hidden`: what the page itself hid
    // (an unopened help note, a result not yet shown) stays as the page left it.
    const out = (node: Element, hide: boolean): void => {
      node.classList.toggle(SEARCH_OUT, hide)
    }
    for (const card of Array.from(scope.querySelectorAll<HTMLDetailsElement>('details.hl-fold[data-section]'))) {
      const body = Array.from(card.children).find((c) => c.classList.contains('hl-fold-body'))
      const rows = body ? Array.from(body.children) : []
      if (!query) {
        out(card, false)
        for (const row of rows) out(row, false)
        if (card.dataset.hlBySearch) {
          delete card.dataset.hlBySearch
          card.open = card.dataset.hlWasOpen === '1'
        }
        continue
      }
      const head = Array.from(card.children).filter((c) => c.tagName === 'SUMMARY' || c.classList.contains('hl-help'))
      const whole = head.some((c) => lower(c).includes(query))
      let any = whole
      let caption: Element | null = null
      let captionHit = false
      let previousOut = false
      for (const row of rows) {
        if (row.classList.contains('hl-help')) {
          // A row's own help note goes with the row above it.
          out(row, previousOut)
          continue
        }
        if (isCaption(row)) {
          caption = row
          captionHit = lower(row).includes(query)
          out(row, !(whole || captionHit))
          if (captionHit && !(row as HTMLElement).hidden) any = true
          previousOut = !(whole || captionHit)
          continue
        }
        const hit = whole || captionHit || lower(row).includes(query)
        out(row, !hit)
        previousOut = !hit
        if (hit && !(row as HTMLElement).hidden) {
          any = true
          if (caption) out(caption, false)
        }
      }
      out(card, !any)
      if (any) {
        shown++
        if (!card.open) {
          if (!card.dataset.hlBySearch) card.dataset.hlWasOpen = '0'
          card.dataset.hlBySearch = '1'
          card.open = true
        } else if (!card.dataset.hlBySearch) {
          card.dataset.hlWasOpen = '1'
        }
      }
    }
    empty.textContent = query && !shown ? 'No settings match.' : ''
    empty.hidden = !empty.textContent
    revealHelp(scope, query)
  }

  input.addEventListener('input', apply)
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && input.value) {
      ev.stopPropagation()
      input.value = ''
      apply()
    }
  })
  clear.addEventListener('click', () => {
    input.value = ''
    apply()
    input.focus()
  })
  return { root, input, apply }
}

/** Open the help that holds `query`; close what an earlier query opened and this one does not. */
export function revealHelp(scope: ParentNode, query: string): void {
  for (const n of Array.from(scope.querySelectorAll<HTMLElement>('.hl-help'))) {
    const set = helpSetters.get(n)
    if (!set) continue
    if (query && lower(n).includes(query)) {
      if (n.hidden) {
        n.dataset.hlBySearch = '1'
        set(true, false)
      }
    } else if (n.dataset.hlBySearch) {
      delete n.dataset.hlBySearch
      set(false, false)
    }
  }
}

export interface SelectOption<T extends string = string> {
  value: T
  label: string
}

export interface BadgeHandle {
  element: HTMLElement
  set(text: string, color: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'): void
}

export interface UiScope {
  /** Destroy every component this scope mounted. Call before rebuilding its DOM. */
  reset(): void
  numberRow(
    label: string,
    value: number,
    attrs: { min: number; max: number; step: number; disabled?: boolean },
    onChange: (v: number) => void,
    hint?: HelpContent,
  ): HTMLElement
  checkboxRow(label: string, value: boolean, onChange: (v: boolean) => void, hint?: HelpContent, disabled?: boolean): HTMLElement
  /** A slider. `onDrag` fires with the live value while dragging (for a preview), `onCommit` once at the end. */
  rangeRow(
    label: string,
    value: number,
    attrs: { min: number; max: number; step: number; suffix?: string; disabled?: boolean },
    onCommit: (v: number) => void,
    onDrag?: (v: number | null) => void,
    hint?: HelpContent,
  ): HTMLElement
  selectRow<T extends string>(
    label: string,
    value: T,
    options: SelectOption<T>[],
    onChange: (v: T) => void,
    hint?: HelpContent,
  ): HTMLElement
  textField(
    label: string,
    hint: HelpContent,
    value: string,
    rows: number,
    onInput: (v: string) => void,
    onReset?: () => void,
  ): HTMLElement
  badge(text: string, color: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'): BadgeHandle
}

export interface UiKit {
  /** True when the host renders its own components for us. */
  readonly native: boolean
  scope(): UiScope
}

type Components = NonNullable<SpindleFrontendContext['components']>

export function createUiKit(ctx: SpindleFrontendContext): UiKit {
  const components: Components | null =
    ctx.components && typeof ctx.components.mountSelect === 'function' ? ctx.components : null

  function scope(): UiScope {
    const handles: { destroy(): void }[] = []
    const track = <H extends { destroy(): void }>(h: H): H => {
      handles.push(h)
      return h
    }

    const some = (hint?: HelpContent): hint is HelpContent => (Array.isArray(hint) ? hint.length > 0 : !!hint)
    const labelled = (label: string, control: HTMLElement, hint?: HelpContent): HTMLElement => {
      const text = el('label', { textContent: label })
      if (!some(hint)) return el('div', { className: 'hl-row' }, [text, control])
      const tip = helpTip(label, hint)
      const row = el('div', { className: 'hl-row' }, [el('span', { className: 'hl-label' }, [text, tip.button]), control])
      return el('div', { className: 'hl-stack' }, [row, tip.note])
    }

    return {
      reset() {
        for (const h of handles.splice(0)) {
          try {
            h.destroy()
          } catch {
            // The host destroys mounts whose DOM went away; a second destroy is harmless.
          }
        }
      },

      numberRow(label, value, attrs, onChange, hint) {
        if (components) {
          const slot = el('div', { className: 'hl-control' })
          track(
            components.mountNumberStepper(slot, {
              value,
              min: attrs.min,
              max: attrs.max,
              step: attrs.step,
              disabled: attrs.disabled === true,
              onChange: (v) => {
                if (typeof v === 'number' && Number.isFinite(v)) onChange(v)
              },
            }),
          )
          return labelled(label, slot, hint)
        }
        const input = el('input', { type: 'number', value: String(value), className: 'hl-input' })
        input.min = String(attrs.min)
        input.max = String(attrs.max)
        input.step = String(attrs.step)
        input.disabled = attrs.disabled === true
        input.addEventListener('change', () => {
          const n = Number(input.value)
          if (Number.isFinite(n)) onChange(n)
        })
        return labelled(label, input, hint)
      },

      checkboxRow(label, value, onChange, hint, disabled) {
        if (components) {
          const slot = el('div', { className: 'hl-control-wide' })
          // The host's checkbox would show a hint always; the help goes behind our `[?]` instead.
          track(components.mountCheckbox(slot, { checked: value, label, onChange, disabled: disabled === true }))
          if (disabled) slot.classList.add('hl-disabled')
          return some(hint) ? helpRow(slot, label, hint) : slot
        }
        const input = el('input', { type: 'checkbox', checked: value, disabled: disabled === true })
        input.addEventListener('change', () => onChange(input.checked))
        const row = el('label', { className: 'hl-row' }, [el('span', { textContent: label }), input])
        return some(hint) ? helpRow(row, label, hint) : row
      },

      rangeRow(label, value, attrs, onCommit, onDrag, hint) {
        if (components && typeof components.mountRangeSlider === 'function') {
          const slot = el('div', { className: 'hl-control-wide' })
          track(
            components.mountRangeSlider(slot, {
              label,
              value,
              min: attrs.min,
              max: attrs.max,
              step: attrs.step,
              integer: Number.isInteger(attrs.step),
              disabled: attrs.disabled === true,
              format: attrs.suffix ? { suffix: attrs.suffix } : undefined,
              onCommit: (v) => {
                if (Number.isFinite(v)) onCommit(v)
              },
              onDragValue: onDrag,
            }),
          )
          if (attrs.disabled) slot.classList.add('hl-disabled')
          return some(hint) ? helpRow(slot, label, hint) : slot
        }
        const shown = el('span', { textContent: `${value}${attrs.suffix ?? ''}` })
        const input = el('input', { type: 'range', value: String(value) })
        input.min = String(attrs.min)
        input.max = String(attrs.max)
        input.step = String(attrs.step)
        input.disabled = attrs.disabled === true
        input.addEventListener('input', () => {
          shown.textContent = `${input.value}${attrs.suffix ?? ''}`
          onDrag?.(Number(input.value))
        })
        input.addEventListener('change', () => {
          const n = Number(input.value)
          if (Number.isFinite(n)) onCommit(n)
        })
        const row = labelled(label, el('div', { className: 'hl-range' }, [input, shown]), hint)
        if (attrs.disabled) row.classList.add('hl-disabled')
        return row
      },

      selectRow(label, value, options, onChange, hint) {
        if (components) {
          const slot = el('div', { className: 'hl-control' })
          track(
            components.mountSelect(slot, {
              value,
              options: options.map((o) => ({ value: o.value, label: o.label })),
              onChange: (v) => onChange(v as typeof value),
              searchThreshold: 8,
            }),
          )
          return labelled(label, slot, hint)
        }
        const select = el('select', { className: 'hl-input' })
        for (const o of options) select.appendChild(el('option', { value: o.value, textContent: o.label }))
        select.value = value
        select.addEventListener('change', () => onChange(select.value as typeof value))
        return labelled(label, select, hint)
      },

      textField(label, hint, value, rows, onInput, onReset) {
        const title = el('span', { textContent: label })
        const wrap = el('div', { className: 'hl-field' })
        if (some(hint)) {
          const tip = helpTip(label, hint)
          wrap.append(el('div', { className: 'hl-field-head' }, [title, tip.button]), tip.note)
        } else {
          wrap.appendChild(el('div', { className: 'hl-field-head' }, [title]))
        }
        if (components) {
          const slot = el('div', { className: 'hl-control-wide' })
          track(components.mountTextArea(slot, { value, rows, onChange: onInput }))
          wrap.appendChild(slot)
        } else {
          const area = el('textarea', { value, rows, className: 'hl-input hl-prompt' })
          area.addEventListener('input', () => onInput(area.value))
          wrap.appendChild(area)
        }
        if (onReset) {
          // D-086: a small button at the right. D-088: "Reset to stock" (D10), and it asks first (D6).
          const reset = (): void => {
            void confirmDanger(ctx, `Reset ${label}`, 'Your text for this prompt is replaced with the stock text.', 'Reset').then((yes) => {
              if (yes) onReset()
            })
          }
          wrap.appendChild(el('div', { className: 'hl-field-foot' }, [button('Reset to stock', reset, 'small')]))
        }
        return wrap
      },

      badge(text, color) {
        if (components) {
          const slot = el('span', { className: 'hl-badge-slot' })
          const handle = track(components.mountBadge(slot, { text, color, size: 'pill' }))
          return { element: slot, set: (t, c) => handle.update({ text: t, color: c }) }
        }
        const span = el('span', { className: `hl-badge hl-badge-${color}`, textContent: text })
        return {
          element: span,
          set: (t, c) => {
            span.textContent = t
            span.className = `hl-badge hl-badge-${c}`
          },
        }
      },
    }
  }

  return { native: components !== null, scope }
}

/**
 * The stylesheet both surfaces share. Only Lumiverse's documented variables
 * (`--lumiverse-text`, `-text-muted`, `-text-dim`, `-fill`, `-fill-subtle`,
 * `-border`, `-border-hover`, `-accent`, `-accent-fg`, `-radius`,
 * `-transition-fast`) with neutral fallbacks for hosts that lack one.
 *
 * D-058: the docs list `-accent` / `-accent-fg`, but the host's theme engine
 * never sets them (it sets `--lumiverse-primary` and `-primary-contrast`,
 * `theme/engine.ts`). So every accent reads the documented name first and the
 * engine's real one second: `var(--lumiverse-accent, var(--lumiverse-primary, …))`.
 * If the host ever defines the documented pair, it wins with no change here.
 */
export const SHARED_STYLES = `
  /* D-089: the four sizes (style guide §2), card title 1, label 0.92, help and status 0.8, caption
     0.72, of 14 px times Lumiverse's own text-size setting, as its own components scale. Every
     font-size in these stylesheets is one of the four variables (a test holds it). */
  .hl-panel, .hl-tab {
    --hl-fs-title: calc(14px * var(--lumiverse-font-scale, 1));
    --hl-fs-label: calc(12.88px * var(--lumiverse-font-scale, 1));
    --hl-fs-help: calc(11.2px * var(--lumiverse-font-scale, 1));
    --hl-fs-caption: calc(10.08px * var(--lumiverse-font-scale, 1));
    display: flex; flex-direction: column; gap: 14px; padding: 14px;
    font-size: var(--hl-fs-label); color: var(--lumiverse-text, inherit); }
  .hl-panel h3, .hl-tab h3 { margin: 0; font-size: var(--hl-fs-title); font-weight: 600; color: var(--lumiverse-text, inherit); }
  .hl-sub { margin: 0; font-size: var(--hl-fs-help); line-height: 1.5; color: var(--lumiverse-text-muted, inherit); opacity: 0.9; }
  /* D-089: two levels of chrome. A card is a border; nothing inside a card is another box. */
  .hl-group { display: flex; flex-direction: column; gap: 8px; padding: 12px;
              border-radius: var(--lumiverse-radius, 8px);
              border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.25));
              background: transparent; }
  details.hl-fold:not([open]) { row-gap: 0; }
  .hl-group .hl-fold:not(.hl-group) { border-top: 1px solid var(--lumiverse-border, rgba(128,128,128,0.25)); padding-top: 6px; }
  /* One caption for every group label inside a card: no dashes, no colons. */
  .hl-subhead, .hl-eyes-head, .hl-viewer-name {
    display: block; margin: 0; font-size: var(--hl-fs-caption); line-height: 1.5; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em; color: var(--lumiverse-text-muted, inherit); }
  .hl-subhead-gap { margin-top: 10px; }
  .hl-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; line-height: 0;
             color: var(--lumiverse-text-muted, currentColor); }
  .hl-icon svg { display: block; }
  .hl-card-title { display: inline-flex; align-items: center; gap: 8px; font-size: var(--hl-fs-title); }
  .hl-stack { display: flex; flex-direction: column; gap: 4px; }
  .hl-row { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
  .hl-row > label, .hl-row > .hl-label { flex: 0 1 auto; }
  .hl-label { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
  .hl-tab [hidden], .hl-panel [hidden], .hl-panel .hl-search-out { display: none !important; }
  .hl-help-btn { flex: none; display: inline-flex; align-items: center; justify-content: center;
                 width: 28px; height: 28px; margin: -6px 0; padding: 0; border: 0; border-radius: 50%;
                 background: transparent; cursor: pointer; color: var(--lumiverse-text-dim, var(--lumiverse-text-muted, currentColor));
                 opacity: 0.7; transition: opacity var(--lumiverse-transition-fast, 120ms), color var(--lumiverse-transition-fast, 120ms); }
  .hl-help-btn:hover, .hl-help-btn:focus-visible, .hl-help-btn[aria-expanded="true"] {
                 opacity: 1; color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-help-btn:focus-visible { outline: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); outline-offset: -4px; }
  .hl-help { display: flex; flex-direction: column; gap: 4px; margin: 2px 0 4px; padding: 4px 0 4px 10px;
             border-left: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor));
             font-size: var(--hl-fs-help); line-height: 1.5; color: var(--lumiverse-text-muted, inherit); }
  .hl-help p { margin: 0; }
  .hl-helprow { display: flex; align-items: flex-start; gap: 4px; }
  .hl-helprow > :first-child { flex: 1 1 auto; min-width: 0; }
  .hl-helprow > .hl-help-btn { margin: -4px 0; }
  .hl-caprow { display: flex; align-items: center; gap: 2px; }
  .hl-field-head { display: flex; align-items: center; gap: 2px; }
  .hl-field-head > span { font-size: var(--hl-fs-label); font-weight: 600; color: var(--lumiverse-text, inherit); }
  .hl-control { flex: 1 1 160px; max-width: 260px; min-width: 120px; }
  .hl-control > * { max-width: 100%; } /* a select is capped at its row's width (style guide §2) */
  .hl-control-wide { width: 100%; }
  /* D-086: Lumiverse's settings input (style guide §2), on the inputs Houselights draws itself
     (class hl-input). Never on a bare element selector: Lumiverse's own components render
     inside these panels and must keep their own look. */
  .hl-input { box-sizing: border-box; max-width: 100%; padding: 6px 10px; font: inherit; font-size: var(--hl-fs-label);
              border-radius: var(--lumiverse-radius, 8px);
              border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
              background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.08)); color: var(--lumiverse-text, inherit);
              transition: border-color var(--lumiverse-transition-fast, 120ms); }
  .hl-row > .hl-input, .hl-range { flex: 1 1 160px; max-width: 260px; min-width: 120px; }
  .hl-input:hover { border-color: var(--lumiverse-border-hover, var(--lumiverse-border, rgba(128,128,128,0.5))); }
  .hl-input:focus, .hl-input:focus-visible { outline: none; border-color: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); }
  textarea.hl-input { width: 100%; resize: vertical; line-height: 1.5; }
  textarea.hl-prompt { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: var(--hl-fs-help); }
  select.hl-input option { background: var(--lumiverse-bg, #1e1e1e); color: var(--lumiverse-text, inherit); }
  .hl-btn:focus-visible, .hl-icon-btn:focus-visible {
              outline: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); outline-offset: 1px; }
  .hl-row input[type="checkbox"] { flex: 0 0 auto; width: 16px; height: 16px; cursor: pointer;
              accent-color: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); }
  label.hl-row { cursor: pointer; }
  .hl-disabled { opacity: 0.55; }
  .hl-range { display: flex; align-items: center; gap: 8px; }
  .hl-range input[type="range"] { flex: 1 1 auto; accent-color: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); }
  .hl-field { display: flex; flex-direction: column; gap: 5px; }
  .hl-field-foot { display: flex; justify-content: flex-end; }
  .hl-btn { padding: 7px 14px; cursor: pointer; font-size: var(--hl-fs-label); font-family: inherit;
            border-radius: var(--lumiverse-radius, 6px);
            border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
            background: var(--lumiverse-fill, rgba(128,128,128,0.12)); color: var(--lumiverse-text, inherit);
            transition: border-color var(--lumiverse-transition-fast, 120ms), filter var(--lumiverse-transition-fast, 120ms); }
  .hl-btn:hover:not(:disabled) { border-color: var(--lumiverse-border-hover, var(--lumiverse-border, rgba(128,128,128,0.5))); filter: brightness(1.1); }
  .hl-btn:disabled { opacity: 0.4; cursor: default; }
  .hl-btn-primary { font-weight: 600; background: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2));
                    color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); border-color: transparent; }
  /* D-086: three intents and the one filled button (style guide §2). Small is 28 px high, the floor. */
  .hl-btn-small { padding: 3px 10px; font-size: var(--hl-fs-help); min-height: 28px; }
  .hl-btn-danger { background: transparent; color: var(--lumiverse-danger, rgb(220,70,70));
                   border-color: var(--lumiverse-danger-050, rgba(220,70,70,0.5)); }
  .hl-btn-danger:hover:not(:disabled) { filter: none; border-color: var(--lumiverse-danger, rgb(220,70,70));
                   background: var(--lumiverse-danger-015, rgba(220,70,70,0.15)); }
  .hl-btn.hl-btn-on { border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-btns { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .hl-btns-apart { margin-left: auto; }
  /* D-088: Reset to factory, a card's last line: small, dim until hovered, red then (style guide §2). */
  .hl-reset { opacity: 0.75; }
  .hl-reset:hover:not(:disabled), .hl-reset:focus-visible { opacity: 1; color: var(--lumiverse-danger, rgb(220,70,70));
                 border-color: var(--lumiverse-danger, rgb(220,70,70)); }
  .hl-card-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px; padding-top: 8px;
                  border-top: 1px dashed var(--lumiverse-border, rgba(128,128,128,0.3)); }
  .hl-card-foot > .hl-status { flex: 1 1 auto; min-width: 0; }
  .hl-icon-btn { flex: none; display: inline-flex; align-items: center; justify-content: center;
                 width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: transparent;
                 cursor: pointer; color: inherit; opacity: 0.7; }
  .hl-icon-btn:hover { opacity: 1; }
  /* D-086: status is a plain line, not a box; a failure is a line in the danger colour with a rule
     on its left (style guide §2). Colours are Lumiverse's own, set by its theme engine. */
  .hl-status { margin: 0; font-size: var(--hl-fs-help); line-height: 1.5; overflow-wrap: anywhere;
               color: var(--lumiverse-text-muted, inherit); }
  .hl-status.err { color: var(--lumiverse-danger, rgb(220,70,70)); padding-left: 8px;
                   border-left: 2px solid var(--lumiverse-danger, rgb(220,70,70)); }
  .hl-status.err .hl-sub { color: inherit; }
  .hl-failure { display: flex; align-items: flex-start; gap: 6px; }
  .hl-failure > span { flex: 1 1 auto; min-width: 0; }
  .hl-failure > .hl-icon-btn { margin: -5px 0; }
  .hl-lines { display: flex; flex-direction: column; gap: 4px; }
  .hl-lines:not(:has(> :not([hidden]))) { display: none; }
  /* D1: the search, after Lumiverse's SearchField. */
  .hl-search { display: flex; flex-direction: column; gap: 4px; }
  .hl-search-field { display: flex; align-items: center; gap: 6px; padding: 0 4px 0 10px; border-radius: 10px;
                     border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                     background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.08)); }
  .hl-search-field:focus-within { border-color: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); }
  .hl-search-icon { display: inline-flex; opacity: 0.6; flex: none; }
  .hl-search-input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 6px 0; min-height: 30px; border: 0; outline: none;
                     background: transparent; color: var(--lumiverse-text, inherit); font: inherit; font-size: var(--hl-fs-label); }
  .hl-kinds { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 2px 12px; }
  .hl-kinds label.hl-row { justify-content: flex-start; gap: 6px; }
  .hl-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: var(--hl-fs-caption); font-weight: 600;
              letter-spacing: 0.04em; border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
              background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.2)); color: var(--lumiverse-text, inherit); }
  .hl-badge-danger { background: var(--lumiverse-danger, rgba(220,70,70,0.85)); color: #fff; border-color: transparent; }
  .hl-badge-success { background: var(--lumiverse-success, rgba(70,180,110,0.85)); color: #fff; border-color: transparent; }
  .hl-badge-warning { background: var(--lumiverse-warning, rgba(230,160,40,0.9)); color: #111; border-color: transparent; }
  .hl-badge-slot { display: inline-flex; }
  /* D-090: the phone, in one block at the end (style guide §6). Lumiverse's own test for a phone: a
     coarse pointer, or a window 600 px wide or less. The desktop reads none of it. */
  @media (pointer: coarse), (max-width: 600px) {
    .hl-panel .hl-btn, .hl-tab .hl-btn, .hl-panel .hl-icon-btn, .hl-tab .hl-icon-btn { min-height: 28px; min-width: 28px; }
    .hl-panel .hl-input, .hl-tab .hl-input, .hl-search-input { min-height: 28px; }
    .hl-tab input[type="checkbox"].hl-input, .hl-row input[type="checkbox"] { width: 20px; height: 20px; }
    /* Nothing hovers on a phone: what is faint until hovered is drawn at its hovered strength. */
    .hl-help-btn, .hl-icon-btn { opacity: 1; }
    .hl-reset { opacity: 1; }
  }
`
