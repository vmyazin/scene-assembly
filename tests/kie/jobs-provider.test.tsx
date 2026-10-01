import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import KieJobsProvider from '../../components/KieJobsProvider';
import { useAppStore } from '../../store/useAppStore';
import { useKieJobsStore } from '../../store/useKieJobsStore';
import { useSpendStore } from '../../store/useSpendStore';

const { fetchKieCredits, getKieJobStatus } = vi.hoisted(() => ({
  fetchKieCredits: vi.fn().mockResolvedValue(940),
  getKieJobStatus: vi.fn(),
}));
vi.mock('../../lib/kie/browser', () => ({ fetchKieCredits, getKieJobStatus }));

describe('KieJobsProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchKieCredits.mockReset();
    fetchKieCredits.mockResolvedValue(940);
    getKieJobStatus.mockReset();
    useAppStore.setState({ kieApiKey: 'kie_test_key' });
    useKieJobsStore.getState().clearJobs();
    useSpendStore.setState({ entries: [] });
  });

  afterEach(() => vi.useRealTimers());

  it('polls an active task without resubmitting it', async () => {
    getKieJobStatus.mockResolvedValue({
      taskId: 'task_poll_1',
      state: 'success',
      resultUrls: ['https://temp.kie.ai/result.png'],
    });
    useKieJobsStore.getState().upsertJob({
      id: 'task_poll_1',
      taskId: 'task_poll_1',
      protocol: 'market',
      state: 'queuing',
      resultUrls: [],
      modelId: 'nano-banana-pro',
      mediaType: 'image',
      inputMode: 'text',
      prompt: 'A studio banana',
      creditsBefore: 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pollAttempt: 0,
    });
    render(<KieJobsProvider><div /></KieJobsProvider>);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(getKieJobStatus).toHaveBeenCalledWith({
      apiKey: 'kie_test_key',
      taskId: 'task_poll_1',
      protocol: 'market',
    });
    expect(useKieJobsStore.getState().jobs[0]).toMatchObject({
      state: 'success',
      resultUrls: ['https://temp.kie.ai/result.png'],
      pollAttempt: 1,
    });

    await vi.waitFor(() => expect(useSpendStore.getState().entries).toHaveLength(1));
    expect(useSpendStore.getState().entries[0]).toMatchObject({ id: 'kie-task_poll_1', costUsd: 0.3 });
  });

  it('marks a task as failed after 15 minutes without another provider call', async () => {
    useKieJobsStore.getState().upsertJob({
      id: 'task_timeout_1',
      taskId: 'task_timeout_1',
      protocol: 'market',
      state: 'generating',
      resultUrls: [],
      modelId: 'nano-banana-pro',
      mediaType: 'image',
      inputMode: 'text',
      prompt: 'A studio banana',
      createdAt: Date.now() - 15 * 60 * 1_000,
      updatedAt: Date.now(),
      pollAttempt: 4,
    });
    render(<KieJobsProvider><div /></KieJobsProvider>);

    await act(async () => undefined);
    expect(useKieJobsStore.getState().jobs[0]).toMatchObject({ state: 'fail' });
    expect(getKieJobStatus).not.toHaveBeenCalled();
  });

  it('emits generation_result when polling reaches a content-filter failure', async () => {
    const plausible = vi.fn();
    Object.defineProperty(window, 'plausible', { configurable: true, writable: true, value: plausible });
    getKieJobStatus
      .mockResolvedValueOnce({ taskId: 'task_filter', state: 'generating', resultUrls: [] })
      .mockResolvedValueOnce({
        taskId: 'task_filter',
        state: 'fail',
        resultUrls: [],
        error: 'IMAGE_SAFETY',
      });
    useKieJobsStore.getState().upsertJob({
      id: 'task_filter',
      taskId: 'task_filter',
      protocol: 'market',
      state: 'queuing',
      resultUrls: [],
      modelId: 'flux-2-pro',
      mediaType: 'image',
      inputMode: 'text',
      prompt: 'A studio banana',
      controlValues: { moderation: 'relaxed' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pollAttempt: 0,
    });
    render(<KieJobsProvider><div /></KieJobsProvider>);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(plausible.mock.calls.map((call) => call[0])).not.toContain('generation_result');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(plausible.mock.calls.find((call) => call[0] === 'generation_result')?.[1].props).toMatchObject({
      engine: 'kie',
      route: 'flux-2-pro',
      model: 'FLUX.2 Pro',
      level: 'relaxed',
      outcome: 'policy',
      media: 'image',
    });
    delete (window as { plausible?: unknown }).plausible;
  });
});
