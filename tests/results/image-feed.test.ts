import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { KieJob } from '@/lib/kie/types';
import { useImageResultFeed } from '@/lib/results/image-feed';
import { useImageResultsStore } from '@/store/useImageResultsStore';
import { useKieJobsStore } from '@/store/useKieJobsStore';

function kieJob(id: string, modelId: string, finishedAt: number, overrides: Partial<KieJob> = {}): KieJob {
  return {
    id,
    taskId: id,
    modelId,
    mediaType: 'image',
    inputMode: 'text',
    protocol: 'market',
    prompt: `${id} prompt`,
    state: 'success',
    resultUrls: [`https://tempfile.kie.test/${id}.png`],
    createdAt: finishedAt - 10,
    updatedAt: finishedAt,
    pollAttempt: 1,
    ...overrides,
  } as KieJob;
}

describe('the shared image result feed', () => {
  it('merges every engine and model, newest first', () => {
    useKieJobsStore.setState({
      jobs: [
        kieJob('kie-a', 'flux-kontext-pro', 300),
        kieJob('kie-b', 'gpt-image-1', 100),
        kieJob('kie-video', 'veo3', 400, { mediaType: 'video' }),
        kieJob('kie-running', 'flux-kontext-pro', 500, { state: 'generating', resultUrls: [] }),
      ],
    });
    const { result } = renderHook(() => useImageResultFeed());

    act(() => {
      useImageResultsStore.getState().add({
        src: 'data:image/png;base64,Z2VtaW5p',
        provider: 'gemini',
        modelId: 'gemini-3-pro-image-preview',
        createdAt: 200,
        finishedAt: 200,
      });
    });

    expect(result.current.map((item) => item.provider)).toEqual(['kie', 'gemini', 'kie']);
    expect(result.current.map((item) => item.modelId)).toEqual([
      'flux-kontext-pro',
      'gemini-3-pro-image-preview',
      'gpt-image-1',
    ]);
    useKieJobsStore.setState({ jobs: [] });
  });
});
