// lib/micro-ai/models.ts
/**
 * Model tiering for small helper tasks (filenames, example prompts).
 *
 * These run on open-weight Llama models through Hugging Face's OpenAI-compatible
 * router rather than a closed-source frontier model, because the work is tiny
 * and latency matters more than reasoning depth.
 */

export type MicroAiTier = 'micro' | 'pro';

export interface MicroAiModel {
  /** Hugging Face repo id, sent verbatim as the `model` field. */
  id: string;
  /** USD per 1M tokens. See PRICING_NOTE — treat readouts as estimates. */
  inputPer1M: number;
  outputPer1M: number;
}

/**
 * Published input pricing at the time of writing. Output pricing is assumed
 * equal to input pending verified per-model figures, so every cost figure the
 * UI shows is labelled an estimate. Update both numbers together from the
 * provider's current price list — this table is the single source of truth.
 */
export const PRICING_NOTE = 'Estimated from list pricing; output priced as input.';

export const MICRO_AI_MODELS: Record<MicroAiTier, MicroAiModel> = {
  // Simple, deterministic work: file naming, slugs, keyword extraction.
  micro: {
    id: 'meta-llama/Llama-3.1-8B-Instruct',
    inputPer1M: 0.02,
    outputPer1M: 0.02,
  },
  // Reserved for prompt expansion and style breakdown. Defined so the tier
  // exists in one place; no task routes here yet.
  pro: {
    id: 'meta-llama/Llama-3.3-70B-Instruct',
    inputPer1M: 0.12,
    outputPer1M: 0.12,
  },
};

/**
 * Fallback model for deployments with no shared tier, billed to the user's own
 * Gemini key. Named here so responses can report it alongside the Llama tiers.
 */
export const GEMINI_MICRO_MODEL = 'gemini-2.5-flash-lite';

/**
 * Vision fallback for describing a source image or video, billed to the
 * visitor's own Gemini key. Flash rather than the lite slug model: a source
 * description has to notice motion, camera, and light, and lite is kept for
 * the tiny text tasks.
 */
export const GEMINI_VISION_MODEL = 'gemini-2.5-flash';

/**
 * Shared vision model for the same job when `HF_TOKEN` is set. The text tiers
 * above cannot see pixels, so source description does not use them.
 *
 * Rates are the cheapest widely listed per-token price for this model
 * (Fireworks / Qwen, $0.20 per 1M in and out), read 2026-10-12. The router may
 * bill a different provider; `PRICING_NOTE` already labels every figure here
 * an estimate.
 */
export const VISION_MODEL: MicroAiModel = {
  id: 'Qwen/Qwen2.5-VL-7B-Instruct',
  inputPer1M: 0.2,
  outputPer1M: 0.2,
};

export interface MicroAiUsage {
  promptTokens: number;
  completionTokens: number;
  /** Estimated USD for this single request. */
  costUsd: number;
}

function modelCost(model: MicroAiModel, promptTokens: number, completionTokens: number): number {
  const cost =
    (promptTokens / 1_000_000) * model.inputPer1M +
    (completionTokens / 1_000_000) * model.outputPer1M;
  return Number.isFinite(cost) ? cost : 0;
}

export function usageCost(tier: MicroAiTier, promptTokens: number, completionTokens: number): number {
  return modelCost(MICRO_AI_MODELS[tier], promptTokens, completionTokens);
}

/** Normalize the OpenAI-shaped `usage` block into our own accounting. */
export function readModelUsage(model: MicroAiModel, raw: unknown): MicroAiUsage {
  const usage = (raw ?? {}) as Record<string, unknown>;
  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  const safePrompt = Number.isFinite(promptTokens) && promptTokens >= 0 ? Math.trunc(promptTokens) : 0;
  const safeCompletion =
    Number.isFinite(completionTokens) && completionTokens >= 0 ? Math.trunc(completionTokens) : 0;

  return {
    promptTokens: safePrompt,
    completionTokens: safeCompletion,
    costUsd: modelCost(model, safePrompt, safeCompletion),
  };
}

export function readUsage(tier: MicroAiTier, raw: unknown): MicroAiUsage {
  return readModelUsage(MICRO_AI_MODELS[tier], raw);
}
