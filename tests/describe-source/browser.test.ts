// tests/describe-source/browser.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestSourceDescription } from '@/lib/describe-source/browser';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import { VISION_MODEL } from '@/lib/micro-ai/models';
import { useMicroAiUsageStore } from '@/store/useMicroAiUsageStore';

describe('requestSourceDescription', () => {
  afterEach(() => {
    useMicroAiUsageStore.getState().reset();
    vi.unstubAllGlobals();
  });

  it('records tokens from a shared-tier failure', async () => {
    useMicroAiUsageStore.getState().reset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: DESCRIBE_ERRORS.emptyModel,
            source: 'micro-ai',
            model: VISION_MODEL.id,
            usage: { promptTokens: 200, completionTokens: 80, costUsd: 0.000056 },
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const file = new File([Uint8Array.of(1, 2, 3, 4)], 'still.png', { type: 'image/png' });
    await expect(requestSourceDescription([{ file, label: 'Image 1' }], '')).rejects.toThrow(DESCRIBE_ERRORS.emptyModel);

    const state = useMicroAiUsageStore.getState();
    expect(state.requests).toBe(1);
    expect(state.promptTokens).toBe(200);
    expect(state.lastModel).toBe(VISION_MODEL.id);
  });
});
