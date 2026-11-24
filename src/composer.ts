/**
 * D19: Lumiverse's own chat box (the composer, `ctx.composer`, host capability
 * `composer-v1`) as Houselights uses it. Send + look reads the draft from the
 * chat box and sends it with a fresh look through the talk-back pipeline (D14).
 *
 * Two rules live here so the phone toolbar and the input-bar Look share them:
 * - The draft is cleared only once the line has landed in the chat (the backend
 *   says `talk_landed`). A failed look leaves it where it was.
 * - It is cleared only if the chat box still holds exactly what was sent, in the
 *   same chat: anything typed since is the user's and stays.
 *
 * `composer.send()` is never called: it is the Send button, Lumiverse's normal
 * generation, which answers in the card's ordinary voice rather than the watcher's.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

/** The part of the host's composer API Houselights uses. */
export interface ComposerLike {
  getState(): { mounted: boolean; chatId: string | null; text: string }
  onChange(handler: (state: { mounted: boolean; chatId: string | null; text: string }) => void): () => void
  setText(text: string): void
  focus(): void
}

export interface ComposerBridge {
  /** The host offers `composer-v1`. */
  available: boolean
  /** The chat box on screen: its chat and its draft, trimmed. Null when there is none. */
  current(): { chatId: string; text: string } | null
  /** Called after the draft, the chat or the chat box itself changes. Returns an unsubscribe. */
  onChange(listener: () => void): () => void
  /** A draft was taken from the chat box and sent; clear it when it lands. */
  sent(chatId: string, text: string): void
  /** The backend appended a line the user said to `chatId`. */
  landed(chatId: string, text: string): void
  destroy(): void
}

/** The longest line the backend keeps (it cuts at this length before appending). */
export const TALK_MAX = 2000

/** The host's composer, when it has one (`composer-v1`); null on older hosts. */
export function composerFrom(ctx: SpindleFrontendContext): ComposerLike | null {
  const caps = (ctx.host?.capabilities ?? {}) as Record<string, number | undefined>
  const api = (ctx as { composer?: ComposerLike }).composer
  return Number(caps['composer-v1'] ?? 0) >= 1 && api ? api : null
}

export function createComposerBridge(api: ComposerLike | null): ComposerBridge {
  let pending: { chatId: string; text: string } | null = null
  const listeners = new Set<() => void>()
  let unsubscribe: (() => void) | null = null
  if (api) {
    try {
      unsubscribe = api.onChange(() => {
        for (const l of listeners) l()
      })
    } catch (err) {
      console.warn('[Houselights] could not follow the chat box', err)
    }
  }

  function current(): { chatId: string; text: string } | null {
    if (!api) return null
    try {
      const s = api.getState()
      if (!s.mounted || !s.chatId) return null
      return { chatId: s.chatId, text: s.text.trim() }
    } catch {
      return null
    }
  }

  return {
    available: api !== null,
    current,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    sent(chatId, text) {
      const line = text.trim()
      pending = line ? { chatId, text: line } : null
    },
    landed(chatId, text) {
      if (!pending || pending.chatId !== chatId || text !== pending.text.slice(0, TALK_MAX)) return
      const was = pending
      pending = null
      const now = current()
      // Only what was sent, still in the same chat's box: anything typed since stays. A line longer
      // than the backend keeps was cut, so the box keeps the whole of it.
      if (!api || !now || now.chatId !== was.chatId || now.text !== was.text || was.text.length > TALK_MAX) return
      try {
        api.setText('')
      } catch (err) {
        console.warn('[Houselights] could not clear the chat box', err)
      }
    },
    destroy() {
      unsubscribe?.()
      unsubscribe = null
      listeners.clear()
      pending = null
    },
  }
}
