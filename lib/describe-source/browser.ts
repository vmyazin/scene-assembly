// lib/describe-source/browser.ts

import { prepareDescribeParts, type DescribeSourceInput } from '@/lib/describe-source/prepare';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import { describeMicroTask, type MicroTaskName } from '@/lib/micro-ai/browser';
import type { MicroAiUsage } from '@/lib/micro-ai/models';
import type { MicroAiEnvelope } from '@/lib/micro-ai/types';
import { useMicroAiUsageStore } from '@/store/useMicroAiUsageStore';

export type { DescribeSourceInput };

function isUsage(value: unknown): value is MicroAiUsage {
  const usage = value as MicroAiUsage | undefined;
  return (
    !!usage &&
    typeof usage.promptTokens === 'number' &&
    typeof usage.completionTokens === 'number' &&
    typeof usage.costUsd === 'number'
  );
}

function settle(task: MicroTaskName, data: Partial<MicroAiEnvelope>) {
  const envelope: MicroAiEnvelope = {
    source: data.source ?? 'deterministic',
    model: data.model,
    usage: isUsage(data.usage) ? data.usage : undefined,
  };
  if (envelope.usage) useMicroAiUsageStore.getState().record(envelope.usage, envelope.model ?? '');
  if (process.env.NODE_ENV === 'development') console.info(describeMicroTask(task, envelope));
}

/**
 * Fill a generation prompt from the selected source. Throws a sentence the
 * button can show; the route is the one that talks to the vision model.
 */
export async function requestSourceDescription(
  sources: DescribeSourceInput[],
  apiKey: string,
  options: { signal?: AbortSignal; target?: 'video' | 'image' } = {}
): Promise<string> {
  const parts = await prepareDescribeParts(sources);
  let response: Response;
  try {
    response = await fetch('/api/describe-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        target: options.target ?? 'video',
        parts,
      }),
      signal: options.signal,
    });
  } catch {
    throw new Error(DESCRIBE_ERRORS.failed);
  }

  const data = (await response.json().catch(() => ({}))) as Partial<MicroAiEnvelope> & {
    prompt?: string;
    error?: string;
  };
  if (!response.ok || typeof data.prompt !== 'string' || !data.prompt.trim()) {
    throw new Error(typeof data.error === 'string' && data.error.trim() ? data.error : DESCRIBE_ERRORS.failed);
  }
  settle('describe', data);
  return data.prompt;
}
