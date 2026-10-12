// lib/describe-source/browser.ts

import { prepareDescribeParts, type DescribeSourceInput } from '@/lib/describe-source/prepare';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import { settle } from '@/lib/micro-ai/browser';
import type { MicroAiEnvelope } from '@/lib/micro-ai/types';

export type { DescribeSourceInput };

export interface SourceDescription {
  prompt: string;
  /** Sources that could not take a part. Empty when everything was sent. */
  omitted: string[];
}

function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === 'AbortError';
}

/**
 * Fill a generation prompt from the selected source. Throws a sentence the
 * button can show; the route is the one that talks to the vision model.
 * A short clip is sent as video only when `apiKey` is set, because that is
 * the reader that can watch it. With no key, the clip becomes stills so the
 * shared vision model can see it.
 */
export async function requestSourceDescription(
  sources: DescribeSourceInput[],
  apiKey: string,
  options: { signal?: AbortSignal; target?: 'video' | 'image' } = {}
): Promise<SourceDescription> {
  const prepared = await prepareDescribeParts(sources, { inlineVideo: apiKey.trim().length > 0 });
  let response: Response;
  try {
    response = await fetch('/api/describe-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        target: options.target ?? 'video',
        parts: prepared.parts,
      }),
      signal: options.signal,
    });
  } catch (caught) {
    if (isAbortError(caught)) throw caught;
    throw new Error(DESCRIBE_ERRORS.failed);
  }

  const data = (await response.json().catch(() => ({}))) as Partial<MicroAiEnvelope> & {
    prompt?: string;
    error?: string;
    usageModel?: string;
  };
  // Record a billed attempt even when the route answers with an error. A
  // rejected paragraph still spent the shared tier's tokens.
  settle('describe', data);
  if (!response.ok || typeof data.prompt !== 'string' || !data.prompt.trim()) {
    throw new Error(typeof data.error === 'string' && data.error.trim() ? data.error : DESCRIBE_ERRORS.failed);
  }
  return { prompt: data.prompt, omitted: prepared.omitted };
}
