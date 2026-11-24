/**
 * Keeping the models from thinking — and coping when they do anyway.
 *
 * A heckle is one line. Houselights asks every connection not to think, but
 * Lumiverse can only say that in a provider's own words, and it knows the
 * words for some providers only (`applyProviderReasoningOffSwitch` in the
 * Lumiverse source: DeepSeek, Anthropic, Z.ai, Moonshot, Bedrock, NanoGPT).
 * OpenRouter is the odd one: there "off" strips the reasoning parameters and
 * changes nothing, while reasoning effort "none" is a real request field
 * (`reasoning: { effort: 'none' }`) that Lumiverse sends only when API
 * reasoning is *on*. So for OpenRouter we ask for effort "none" instead of
 * "off" — the same thing Lumiverse does when the user picks "None (disabled)"
 * in their own Reasoning settings.
 *
 * Everything else here is pure, so it can be tested without a host.
 */

import type { GenerationReasoningOverrideDTO, GenerationRequestDTO, GenerationResponseDTO } from 'lumiverse-spindle-types'

/** Extra completion tokens granted to a connection that thinks regardless. */
export const REASONING_HEADROOM = 4096

/**
 * The request-level reasoning override that means "don't think" for this
 * provider. `provider` is `ConnectionProfileDTO.provider`; unknown or missing
 * falls back to the generic "off", which Lumiverse translates where it can.
 */
export function noThinkingOverride(provider: string | null | undefined): GenerationReasoningOverrideDTO {
  if (provider === 'openrouter') return { source: 'custom', apiReasoning: true, effort: 'none' }
  return { source: 'off' }
}

/** The same request with `max_tokens` raised by `headroom` (when it has one). */
export function withHeadroom(request: GenerationRequestDTO, headroom: number): GenerationRequestDTO {
  const max = request.parameters?.max_tokens
  if (headroom <= 0 || typeof max !== 'number') return request
  return { ...request, parameters: { ...request.parameters, max_tokens: max + headroom } }
}

/**
 * How much reasoning came back: characters of reasoning text, `1` when only
 * structured thinking blocks did, `0` when none.
 */
export function reasoningLength(result: Partial<GenerationResponseDTO> | undefined): number {
  const text = typeof result?.reasoning === 'string' ? result.reasoning.length : 0
  if (text > 0) return text
  return (result?.thinking_blocks?.length ?? 0) > 0 ? 1 : 0
}

/** Models that are the right tool here, by name, for the settings copy. */
export const LIGHT_MODEL_EXAMPLES = 'Gemma 4'

/** D-088: the short advice beside the Reaction model; the long version below is in the guide. */
export const LIGHT_MODEL_ADVICE =
  'Choose a light chat model, not a reasoning one: a reaction is a line or two, and a reasoning model thinks for seconds first. More in the guide.'

/** The model names, for the guide, where they can be kept up to date. */
export const LIGHT_MODEL_GUIDE =
  `Pick a light chat model, not a reasoning one. A heckle is one line; a reasoning or "Pro" model ` +
  `spends seconds and hundreds of tokens thinking before it says anything. DeepSeek V4 thinks by ` +
  `default (Flash as well as Pro), and reasoning-only models (DeepSeek R1, the o-series) can't be told ` +
  `not to. ${LIGHT_MODEL_EXAMPLES} answers in a second or two and is what Houselights is tested with.`
