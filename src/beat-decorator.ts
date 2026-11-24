/**
 * Shows what the character saw, under the hidden beat message — and (D-053)
 * a council member's own portrait beside the name on their Box Seat lines.
 *
 * The beat's thumbnail (and, when "keep the full frame" is on, the frame)
 * lives in the message's metadata — never in its text, which would put
 * base64 into every later prompt. Lumiverse doesn't draw metadata, so this
 * module does.
 *
 * What the host really offers (verified against the Lumiverse source, not the
 * docs — the two disagree here):
 *
 * - There is no `ctx.messages.get`. The frontend store is read with the
 *   synchronous `ctx.messages.getRecent(n)` (last n of the open chat, n ≤ 200,
 *   full `extra` included). Anything older is fetched through our backend,
 *   which reads the chat and returns the beat metadata by id.
 * - `USER_MESSAGE_RENDERED` / `CHARACTER_MESSAGE_RENDERED` are declared in the
 *   event enum but nothing in Lumiverse emits them. What does fire when a
 *   message is created — ours included — is `MESSAGE_SENT`, with the whole
 *   message (metadata and all) in the payload.
 * - Bubbles mount and unmount as the chat list virtualizes, so the thing to
 *   watch is the DOM itself: a MutationObserver sees every `[data-message-id]`
 *   element the moment it appears. `ctx.dom.inject` registers what we add and
 *   replays it when the same bubble remounts, so each message is decorated
 *   once per page load.
 * - Each message has two `[data-message-id]` roots: the virtualizer row and,
 *   inside it, the card. The picture goes inside the card, right after the
 *   message body (`message_body_after` mount), so it reads as part of the
 *   bubble instead of a stray block under the row.
 *
 * The image element is created with `createElement`, not from an HTML string,
 * so the data: URL never meets the sanitizer.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

interface BeatMeta {
  beat?: boolean
  thumbB64?: string
  frameB64?: string
  width?: number
  height?: number
  source?: string
  /** H3: seen during a hush. */
  hushed?: boolean
}

export interface BeatDecorator {
  destroy(): void
}

const RECENT_WINDOW = 200
/** Anything this module draws inside a message. */
const OURS = '.hl-beat, .hl-portrait'
const MESSAGE_ATTR = 'data-message-id'

/**
 * What we draw on a message: the beat's picture, or (D-053) a council member's
 * own portrait beside the name on their line. A message is never both — beats
 * are hidden user turns, council lines are assistant turns.
 */
type DecorMeta = { kind: 'beat'; beat: BeatMeta } | { kind: 'portrait'; url: string; name: string }

/** Spindle metadata → what to draw, or null when it's not one of ours (or nothing to draw). */
export function decorOf(spindleMetadata: unknown): DecorMeta | null {
  if (!spindleMetadata || typeof spindleMetadata !== 'object') return null
  const hl = (spindleMetadata as { houselights?: unknown }).houselights
  if (!hl || typeof hl !== 'object') return null
  const meta = hl as BeatMeta & { speakerAvatar?: unknown; speaker?: unknown }
  if (meta.beat) return typeof meta.thumbB64 === 'string' && meta.thumbB64 ? { kind: 'beat', beat: meta } : null
  // Only council lines carry `speakerAvatar`: a card's own line already has the right picture.
  if (typeof meta.speakerAvatar === 'string' && meta.speakerAvatar) {
    return { kind: 'portrait', url: meta.speakerAvatar, name: typeof meta.speaker === 'string' ? meta.speaker : '' }
  }
  return null
}

/** A message as the frontend store (and the MESSAGE_SENT payload) carries it. */
function decorOfStoreMessage(message: unknown): DecorMeta | null {
  if (!message || typeof message !== 'object') return null
  const extra = (message as { extra?: unknown }).extra
  if (!extra || typeof extra !== 'object') return null
  return decorOf((extra as { spindle_metadata?: unknown }).spindle_metadata)
}

export function createBeatDecorator(ctx: SpindleFrontendContext): BeatDecorator {
  const decorated = new Map<string, Element>()
  /** What to draw, by message id; `null` means "seen, and nothing of ours to draw". */
  const known = new Map<string, DecorMeta | null>()
  const inflight = new Set<string>()
  let alive = true

  // --- reading a message's metadata ----------------------------------------

  // Present in the shipped host (frontend-domain-api.ts) but not yet in the
  // published types, hence the loose shape and the feature check.
  const messagesApi = ctx.messages as unknown as { getRecent?: (limit: number) => unknown[] } | undefined
  const getRecent =
    typeof messagesApi?.getRecent === 'function' ? messagesApi.getRecent.bind(messagesApi) : null

  function harvest(message: unknown): void {
    const id = (message as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) return
    const meta = decorOfStoreMessage(message)
    if (meta) known.set(id, meta)
    else if (!known.get(id)) known.set(id, null)
  }

  function harvestStore(): void {
    if (!getRecent) return
    try {
      for (const message of getRecent(RECENT_WINDOW)) harvest(message)
    } catch {
      // Store unavailable (no chat open, host teardown) — the backend path remains.
    }
  }

  // Backend fallback for ids outside the store window: batch the ids, ask once.
  const waiting = new Map<string, (meta: DecorMeta | null) => void>()
  let batch: string[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null

  function askBackend(messageId: string): Promise<DecorMeta | null> {
    return new Promise((resolve) => {
      waiting.set(messageId, resolve)
      batch.push(messageId)
      if (batchTimer === null) {
        batchTimer = setTimeout(() => {
          batchTimer = null
          const ids = batch.splice(0)
          ctx.sendToBackend({ type: 'get_beats', messageIds: ids })
        }, 100)
      }
    })
  }

  const unsubBackend = ctx.onBackendMessage((payload: unknown) => {
    const msg = payload as { type?: string; beats?: Record<string, unknown> }
    if (msg?.type !== 'beats' || !msg.beats) return
    for (const [id, resolve] of [...waiting]) {
      if (!(id in msg.beats)) continue
      waiting.delete(id)
      const raw = msg.beats[id]
      const meta = raw && typeof raw === 'object' ? decorOf({ houselights: raw }) : null
      known.set(id, meta)
      resolve(meta)
    }
  })

  async function readMeta(messageId: string): Promise<DecorMeta | null> {
    if (known.has(messageId)) return known.get(messageId) ?? null
    harvestStore()
    if (known.has(messageId)) return known.get(messageId) ?? null
    return askBackend(messageId)
  }

  // --- drawing ---------------------------------------------------------------

  /** The card for a message: the innermost `[data-message-id]` root. */
  function findCard(messageId: string): Element | null {
    const roots = ctx.dom.listMessageElements().filter((m) => m.messageId === messageId).map((m) => m.element)
    if (roots.length === 0) return null
    return roots.find((el) => !roots.some((other) => other !== el && el.contains(other))) ?? roots[0]
  }

  function inject(card: Element): Element {
    const html = '<div class="hl-beat"></div>'
    const afterBody = card.querySelector('[data-spindle-mount="message_body_after"]')
    if (afterBody) return ctx.dom.inject(afterBody, html, 'afterend')
    const footer = card.querySelector('[data-spindle-mount="message_footer"]')
    if (footer) return ctx.dom.inject(footer, html, 'beforebegin')
    return ctx.dom.inject(card, html, 'beforeend')
  }

  /**
   * D-053: a council member's own portrait, in the message header right after
   * Lumiverse's avatar and name (the `message_header` mount). Lumiverse draws
   * the big avatar from the chat's character, since a council member has none;
   * this says who actually spoke. Nothing is written to the chat.
   */
  function injectPortrait(card: Element, url: string, name: string): Element | null {
    const header = card.querySelector('[data-spindle-mount="message_header"]')
    if (!header) return null // A host without the slot: leave the header alone.
    const wrapper = ctx.dom.inject(header, '<span class="hl-portrait"></span>', 'afterend')
    const slot = wrapper.querySelector('.hl-portrait') ?? wrapper
    const img = document.createElement('img')
    img.className = 'hl-portrait-img'
    img.alt = name ? `${name}'s portrait` : 'Council member\'s portrait'
    img.decoding = 'async'
    try {
      img.src = new URL(url, location.origin).href
    } catch {
      return wrapper
    }
    slot.appendChild(img)
    return wrapper
  }

  function draw(slot: Element, meta: BeatMeta, card: Element): void {
    if (card.getAttribute('data-part') === 'user') slot.classList.add('hl-beat-right')

    const img = document.createElement('img')
    img.className = 'hl-beat-thumb'
    img.alt = meta.source === 'webcam' ? 'Webcam photo the character saw' : 'What the character saw'
    img.src = `data:image/jpeg;base64,${meta.thumbB64}`
    img.decoding = 'async'
    slot.appendChild(img)

    const caption = document.createElement('div')
    caption.className = 'hl-beat-caption'
    if (meta.frameB64) {
      caption.textContent = 'Press to see the full-size picture.'
      let full = false
      img.addEventListener('click', (ev) => {
        ev.stopPropagation()
        full = !full
        img.src = `data:image/jpeg;base64,${full ? meta.frameB64 : meta.thumbB64}`
        img.classList.toggle('hl-beat-full', full)
        caption.textContent = (meta.hushed ? 'Seen while hushed. ' : '') + (full ? 'Press to shrink it.' : 'Press to see the full-size picture.')
      })
      img.style.cursor = 'zoom-in'
    } else {
      caption.textContent =
        meta.width && meta.height
          ? `Thumbnail of a ${meta.width}×${meta.height} picture. Only this thumbnail was kept.`
          : 'Thumbnail. Only this thumbnail was kept.'
    }
    if (meta.hushed) caption.textContent = `Seen while hushed. ${caption.textContent}`
    slot.appendChild(caption)
  }

  async function decorate(messageId: string): Promise<void> {
    if (!alive || !messageId || decorated.has(messageId) || inflight.has(messageId)) return
    inflight.add(messageId)
    try {
      const meta = await readMeta(messageId)
      if (!meta || !alive || decorated.has(messageId)) return
      const card = findCard(messageId)
      if (!card) return // Scrolled away meanwhile; the observer will see it again.
      const already = card.querySelector(OURS)
      if (already) {
        // The host replayed an earlier injection before we got here.
        decorated.set(messageId, already.parentElement ?? already)
        return
      }
      if (meta.kind === 'beat') {
        const wrapper = inject(card)
        draw(wrapper.querySelector('.hl-beat') ?? wrapper, meta.beat, card)
        decorated.set(messageId, wrapper)
      } else {
        const wrapper = injectPortrait(card, meta.url, meta.name)
        if (wrapper) decorated.set(messageId, wrapper)
      }
    } catch {
      // Host refused the injection (teardown, detached node) — try again next time.
    } finally {
      inflight.delete(messageId)
    }
  }

  function sweep(): void {
    if (!alive) return
    const ids = new Set(ctx.dom.listMessageElements().map((m) => m.messageId))
    for (const id of ids) void decorate(id)
  }

  // --- triggers ----------------------------------------------------------------

  // The DOM is the source of truth for "a bubble is on screen".
  let scheduled = false
  const pendingIds = new Set<string>()
  function scheduleFlush(): void {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      const ids = [...pendingIds]
      pendingIds.clear()
      for (const id of ids) {
        const wrapper = decorated.get(id)
        if (!wrapper) {
          void decorate(id)
          continue
        }
        // A bubble we decorated earlier has remounted. The host replays our
        // wrapper itself (identity preserved, picture included); give it a
        // moment, and only if it didn't, draw again.
        later(500, () => {
          if (wrapper.isConnected) return
          const card = findCard(id)
          if (!card || card.querySelector(OURS)) return
          decorated.delete(id)
          void decorate(id)
        })
      }
    }, 0)
  }
  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (!(node instanceof Element)) continue
              const own = node.getAttribute(MESSAGE_ATTR)
              if (own) pendingIds.add(own)
              for (const el of node.querySelectorAll(`[${MESSAGE_ATTR}]`)) {
                const id = el.getAttribute(MESSAGE_ATTR)
                if (id) pendingIds.add(id)
              }
            }
          }
          if (pendingIds.size) scheduleFlush()
        })
      : null
  observer?.observe(document.body, { childList: true, subtree: true })

  const unsubs: (() => void)[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  function later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      timers.delete(t)
      if (alive) fn()
    }, ms)
    timers.add(t)
  }

  // A new message (ours arrives this way too): keep its metadata, then look
  // for its bubble a few times — the store updates before React mounts it.
  unsubs.push(
    ctx.events.on('MESSAGE_SENT', (payload: unknown) => {
      const message = (payload as { message?: unknown })?.message
      harvest(message)
      const id = (message as { id?: unknown })?.id
      if (typeof id !== 'string') return
      for (const ms of [0, 300, 1200, 3000]) later(ms, () => void decorate(id))
    }),
  )
  unsubs.push(
    ctx.events.on('MESSAGE_DELETED', (payload: unknown) => {
      const id = (payload as { messageId?: unknown })?.messageId
      if (typeof id !== 'string') return
      const wrapper = decorated.get(id)
      decorated.delete(id)
      known.delete(id)
      if (wrapper) {
        try {
          ctx.dom.uninject(wrapper)
        } catch {
          // Already gone with the bubble.
        }
      }
    }),
  )
  // A chat switch brings a whole new set of bubbles and a fresh store.
  unsubs.push(
    ctx.events.on('CHAT_SWITCHED', () => {
      known.clear()
      decorated.clear() // The old chat's DOM is gone; the host dropped our injections with it.
      later(250, sweep)
      later(1500, sweep)
    }),
  )
  sweep()
  later(1000, sweep)

  return {
    destroy() {
      alive = false
      observer?.disconnect()
      unsubBackend()
      if (batchTimer !== null) clearTimeout(batchTimer)
      for (const t of timers) clearTimeout(t)
      for (const u of unsubs) u()
      for (const wrapper of decorated.values()) {
        try {
          ctx.dom.uninject(wrapper)
        } catch {
          // Already removed by the host.
        }
      }
      decorated.clear()
      known.clear()
    },
  }
}

export const BEAT_STYLES = `
  .hl-beat { position: relative; z-index: 1; margin: 0 24px 16px;
             display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
  .hl-beat.hl-beat-right { align-items: flex-end; text-align: right; }
  .hl-beat-thumb { display: block; max-width: min(320px, 100%); height: auto;
                   border-radius: var(--lumiverse-radius, 6px);
                   border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3)); }
  .hl-beat-thumb.hl-beat-full { max-width: 100%; }
  .hl-portrait { display: inline-flex; align-items: center; margin: 0 6px; flex: none; vertical-align: middle; }
  .hl-portrait-img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; display: block;
                     border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                     background: var(--lumiverse-fill-subtle, transparent); }
  .hl-beat-caption { font-size: calc(11.2px * var(--lumiverse-font-scale, 1)); color: var(--lumiverse-text-dim, inherit); opacity: 0.85; }
`
