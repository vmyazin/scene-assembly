// lib/micro-ai/browser.ts
import { SEED_TONES } from '@/lib/example-prompts';
import type { MicroAiUsage } from '@/lib/micro-ai/models';
import type { MicroAiEnvelope } from '@/lib/micro-ai/types';
import { useMicroAiUsageStore } from '@/store/useMicroAiUsageStore';

/**
 * Browser-side entry points for the micro-task routes. Both record whatever
 * usage the server reports so the Connections panel can show what the session
 * cost, and both announce which model answered when running `next dev`.
 */

export type MicroTaskName = 'slug' | 'example' | 'describe';

export function isUsage(value: unknown): value is MicroAiUsage {
  const usage = value as MicroAiUsage | undefined;
  return (
    !!usage &&
    typeof usage.promptTokens === 'number' &&
    typeof usage.completionTokens === 'number' &&
    typeof usage.costUsd === 'number'
  );
}

/**
 * One-line summary of who answered a micro-task, e.g.
 * `[micro-ai] slug → Llama-3.1-8B-Instruct (shared tier) · 128 tokens · ~$0.0000`.
 * Exported so its formatting can be tested without a live console.
 */
export function describeMicroTask(task: MicroTaskName, envelope: MicroAiEnvelope): string {
  const origin =
    envelope.source === 'micro-ai'
      ? 'shared tier'
      : envelope.source === 'gemini'
        ? 'your Gemini key'
        : 'no model — deterministic fallback';
  const model = envelope.model?.split('/').pop();
  const parts = [`[micro-ai] ${task} → ${model ? `${model} (${origin})` : origin}`];

  if (envelope.usage) {
    const { promptTokens, completionTokens, costUsd } = envelope.usage;
    parts.push(`${promptTokens + completionTokens} tokens`, `~$${costUsd.toFixed(6)}`);
  }

  return parts.join(' · ');
}

/**
 * Dev-only. `process.env.NODE_ENV` is inlined at build time, so this whole
 * branch is eliminated from the production bundle.
 */
function reportMicroTask(task: MicroTaskName, envelope: MicroAiEnvelope) {
  if (process.env.NODE_ENV === 'development') {
    console.info(describeMicroTask(task, envelope));
  }
}

export function settle(
  task: MicroTaskName,
  data: Partial<MicroAiEnvelope> & { usageModel?: string }
) {
  const envelope: MicroAiEnvelope = {
    source: data.source ?? 'deterministic',
    model: data.model,
    usage: isUsage(data.usage) ? data.usage : undefined,
  };
  // `usageModel` is the model that was billed when it is not the model that
  // wrote the prompt — a shared-tier attempt that failed, then Gemini.
  if (envelope.usage) {
    useMicroAiUsageStore.getState().record(envelope.usage, data.usageModel || envelope.model || '');
  }
  reportMicroTask(task, envelope);
}

/**
 * Short evocative filename slug for a prompt. The route always answers — it
 * falls back to a regex slugifier — so this only returns null when the request
 * itself fails, which leaves the caller's own fallback in charge.
 */
export async function requestPromptSlug(
  prompt: string,
  apiKey: string,
  options: { signal?: AbortSignal } = {}
): Promise<string | null> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return null;

  try {
    const response = await fetch('/api/slug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: trimmedPrompt, apiKey }),
      signal: options.signal,
    });
    const data = (await response.json()) as Partial<MicroAiEnvelope> & { slug?: string };
    if (!response.ok || typeof data.slug !== 'string') return null;
    settle('slug', data);
    return data.slug || null;
  } catch {
    return null;
  }
}

/**
 * Fresh, feature-tailored example prompt. Picks the variety seed so every
 * caller behaves the same. Throws with the route's message when neither the
 * shared tier nor the user's own key can serve it.
 */
export async function requestExamplePrompt(featureId: string, apiKey: string): Promise<string> {
  const seed = SEED_TONES[Math.floor(Math.random() * SEED_TONES.length)];
  const response = await fetch('/api/example', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ featureId, apiKey, seed }),
  });
  const data = (await response.json()) as Partial<MicroAiEnvelope> & {
    prompt?: string;
    error?: string;
  };
  if (!response.ok || !data.prompt) {
    throw new Error(data.error || 'Could not generate an example prompt.');
  }
  settle('example', data);
  return data.prompt;
}
