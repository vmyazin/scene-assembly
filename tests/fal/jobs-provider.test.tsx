import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FalJobsProvider from '../../components/FalJobsProvider';
import { FAL_JOB_TIMEOUT_MS, nextFalPollDelay } from '../../lib/fal/queue';
import type { FalJob, FalTask } from '../../lib/fal/types';
import { useAppStore } from '../../store/useAppStore';
import { useFalJobsStore } from '../../store/useFalJobsStore';
import { useSpendStore } from '../../store/useSpendStore';

const { cancelFalJob, estimateFalJobCost, getFalJobStatus, submitFalJob } = vi.hoisted(() => ({
  cancelFalJob: vi.fn(),
  estimateFalJobCost: vi.fn().mockResolvedValue({ costUsd: 0.5, unit: 'second', quantity: 8 }),
  getFalJobStatus: vi.fn(),
  submitFalJob: vi.fn(),
}));

vi.mock('../../lib/fal/browser', () => ({ cancelFalJob, estimateFalJobCost, getFalJobStatus, submitFalJob }));

const NOW = new Date('2026-08-04T12:00:00.000Z').getTime();
const TIMEOUT_MESSAGE =
  'Polling stopped after 15 minutes. The fal job may still complete upstream.';

function makeJob(overrides: Partial<FalJob> = {}): FalJob {
  return {
    id: 'fal-job-0001',
    requestId: 'request_0001',
    state: 'queued',
    logs: ['Submitted'],
    modelId: 'fal-ai/veo3',
    mediaType: 'video',
    inputMode: 'text',
    prompt: 'A banana crossing the moon',
    createdAt: NOW,
    updatedAt: NOW,
    pollAttempt: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('FalJobsProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    cancelFalJob.mockReset();
    estimateFalJobCost.mockReset();
    estimateFalJobCost.mockResolvedValue({ costUsd: 0.5, unit: 'second', quantity: 8 });
    getFalJobStatus.mockReset();
    submitFalJob.mockReset();
    useAppStore.setState({ falApiKey: 'fal-key-secret' });
    useFalJobsStore.getState().clearJobs();
    useSpendStore.setState({ entries: [] });
    // jsdom's localStorage.setItem schedules a same-tick storage event via
    // setTimeout(…, 0) whenever the persisted value actually changes (it does
    // here once a prior test has filed a real entry). Flush it immediately so
    // it never shows up as a leftover timer in this file's exact-count checks.
    vi.advanceTimersByTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls queued to running to success and stores complete replacement snapshots', async () => {
    // A real catalog model id (unlike the fixture default), so captureFalJob's
    // resolveFalVariant lookup succeeds and files an estimated spend entry.
    const initial = makeJob({ modelId: 'veo-3-1-fast' });
    const running: FalTask = {
      requestId: initial.requestId,
      state: 'running',
      logs: ['Queued', 'Rendering frame 1'],
    };
    const success: FalTask = {
      requestId: initial.requestId,
      state: 'success',
      logs: ['Queued', 'Rendering frame 1', 'Complete'],
      resultUrl: 'https://v3.fal.media/files/tiger/result.mp4',
      mimeType: 'video/mp4',
    };
    getFalJobStatus.mockResolvedValueOnce(running).mockResolvedValueOnce(success);
    useFalJobsStore.getState().upsertJob(initial);

    render(<FalJobsProvider><div /></FalJobsProvider>);
    expect(getFalJobStatus).not.toHaveBeenCalled();

    await advance(nextFalPollDelay(0));

    expect(getFalJobStatus).toHaveBeenNthCalledWith(
      1,
      {
        apiKey: 'fal-key-secret',
        modelId: initial.modelId,
        mediaType: initial.mediaType,
        inputMode: initial.inputMode,
        requestId: initial.requestId,
      },
      { signal: expect.any(AbortSignal) }
    );
    expect(useFalJobsStore.getState().jobs[0]).toEqual({
      ...initial,
      ...running,
      resultUrl: undefined,
      mimeType: undefined,
      error: undefined,
      updatedAt: NOW + nextFalPollDelay(0),
      pollAttempt: 1,
    });

    await advance(nextFalPollDelay(1));

    expect(useFalJobsStore.getState().jobs[0]).toEqual({
      ...initial,
      ...success,
      error: undefined,
      updatedAt: NOW + nextFalPollDelay(0) + nextFalPollDelay(1),
      pollAttempt: 2,
    });
    expect(submitFalJob).not.toHaveBeenCalled();
    expect(cancelFalJob).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(useSpendStore.getState().entries).toHaveLength(1));
    expect(useSpendStore.getState().entries[0]).toMatchObject({ id: `fal-${initial.id}`, provider: 'fal', kind: 'video', costUsd: 0.5 });
  });

  it('emits generation_result only when the job finishes, using the submitted level', async () => {
    const plausible = vi.fn();
    Object.defineProperty(window, 'plausible', { configurable: true, writable: true, value: plausible });
    const initial = makeJob({
      modelId: 'veo-3-1-fast',
      controlValues: { moderation: 'relaxed' },
    });
    getFalJobStatus
      .mockResolvedValueOnce({ requestId: initial.requestId, state: 'running', logs: ['Rendering'] })
      .mockResolvedValueOnce({
        requestId: initial.requestId,
        state: 'fail',
        logs: [],
        error: 'IMAGE_SAFETY',
      });
    useFalJobsStore.getState().upsertJob(initial);
    render(<FalJobsProvider><div /></FalJobsProvider>);

    await advance(nextFalPollDelay(0));
    expect(plausible.mock.calls.map((call) => call[0])).not.toContain('generation_result');

    await advance(nextFalPollDelay(1));
    const result = plausible.mock.calls.find((call) => call[0] === 'generation_result');
    expect(result?.[1].props).toMatchObject({
      engine: 'fal',
      route: 'veo-3-1-fast',
      level: 'relaxed',
      outcome: 'policy',
      media: 'video',
    });
    expect(plausible.mock.calls.filter((call) => call[0] === 'generation_result')).toHaveLength(1);
    delete (window as { plausible?: unknown }).plausible;
  });

  it('files nothing in the spend ledger for a failed job', async () => {
    getFalJobStatus.mockResolvedValueOnce({ requestId: 'request_0001', state: 'fail', logs: [], error: 'nope' });
    useFalJobsStore.getState().upsertJob(makeJob());
    render(<FalJobsProvider><div /></FalJobsProvider>);
    await advance(nextFalPollDelay(0));
    expect(useFalJobsStore.getState().jobs[0].state).toBe('fail');
    expect(useSpendStore.getState().entries).toEqual([]);
  });

  it('keeps a job active after a safe transient rejection and later completes without resubmit', async () => {
    const initial = makeJob({ id: 'fal-job-retry', requestId: 'request_retry1' });
    getFalJobStatus
      .mockRejectedValueOnce(new Error('fal-key-secret provider body: quota internals'))
      .mockResolvedValueOnce({
        requestId: initial.requestId,
        state: 'success',
        logs: ['Complete after retry'],
        resultUrl: 'https://v3.fal.media/files/panda/retry.mp4',
        mimeType: 'video/mp4',
      });
    useFalJobsStore.getState().upsertJob(initial);
    render(<FalJobsProvider><div /></FalJobsProvider>);

    await advance(nextFalPollDelay(0));

    const afterRejection = useFalJobsStore.getState().jobs[0];
    expect(afterRejection).toMatchObject({ state: 'queued', pollAttempt: 1 });
    expect(afterRejection.updatedAt).toBe(NOW + nextFalPollDelay(0));
    expect(JSON.stringify(afterRejection)).not.toContain('fal-key-secret');
    expect(JSON.stringify(afterRejection)).not.toContain('quota internals');
    expect(vi.getTimerCount()).toBe(1);

    await advance(nextFalPollDelay(1));

    expect(useFalJobsStore.getState().jobs[0]).toMatchObject({
      state: 'success',
      pollAttempt: 2,
      resultUrl: 'https://v3.fal.media/files/panda/retry.mp4',
    });
    expect(getFalJobStatus).toHaveBeenCalledTimes(2);
    expect(submitFalJob).not.toHaveBeenCalled();
    expect(cancelFalJob).not.toHaveBeenCalled();
  });

  it('times out an already-expired job locally without a provider call or cancellation', async () => {
    const expired = makeJob({
      id: 'fal-job-timeout',
      requestId: 'request_timeout1',
      state: 'running',
      createdAt: NOW - FAL_JOB_TIMEOUT_MS,
      pollAttempt: 4,
    });
    useFalJobsStore.getState().upsertJob(expired);

    render(<FalJobsProvider><div /></FalJobsProvider>);
    await act(async () => undefined);

    expect(useFalJobsStore.getState().jobs[0]).toEqual({
      ...expired,
      state: 'timed_out',
      error: TIMEOUT_MESSAGE,
      updatedAt: NOW,
    });
    expect(getFalJobStatus).not.toHaveBeenCalled();
    expect(cancelFalJob).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['success', 'fail', 'timed_out', 'cancelled'] as const)(
    'never schedules or polls terminal %s jobs',
    async (state) => {
      useFalJobsStore.getState().upsertJob(
        makeJob({ id: `fal-terminal-${state}`, requestId: `request_${state}1`, state })
      );
      render(<FalJobsProvider><div /></FalJobsProvider>);
      await advance(FAL_JOB_TIMEOUT_MS + 1);

      expect(getFalJobStatus).not.toHaveBeenCalled();
      expect(cancelFalJob).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('waits for a missing key without polling and remains recoverable when the key returns', async () => {
    useAppStore.setState({ falApiKey: '   ' });
    const initial = makeJob({ id: 'fal-job-key', requestId: 'request_key0001' });
    useFalJobsStore.getState().upsertJob(initial);
    getFalJobStatus.mockResolvedValue({
      requestId: initial.requestId,
      state: 'running',
      logs: ['Recovered'],
    });
    render(<FalJobsProvider><div /></FalJobsProvider>);

    await advance(nextFalPollDelay(0) * 2);
    expect(getFalJobStatus).not.toHaveBeenCalled();
    expect(useFalJobsStore.getState().jobs[0]).toEqual(initial);

    act(() => useAppStore.setState({ falApiKey: 'restored-fal-key' }));
    await advance(nextFalPollDelay(0));

    expect(getFalJobStatus).toHaveBeenCalledTimes(1);
    expect(useFalJobsStore.getState().jobs[0]).toMatchObject({ state: 'running', pollAttempt: 1 });
  });

  it('still enforces the local deadline while the key is missing', async () => {
    useAppStore.setState({ falApiKey: '' });
    const initial = makeJob({
      id: 'fal-job-key-timeout',
      requestId: 'request_keytime1',
      createdAt: NOW - FAL_JOB_TIMEOUT_MS + 100,
    });
    useFalJobsStore.getState().upsertJob(initial);
    render(<FalJobsProvider><div /></FalJobsProvider>);

    await advance(100);

    expect(useFalJobsStore.getState().jobs[0]).toMatchObject({
      state: 'timed_out',
      error: TIMEOUT_MESSAGE,
      updatedAt: NOW + 100,
    });
    expect(getFalJobStatus).not.toHaveBeenCalled();
    expect(cancelFalJob).not.toHaveBeenCalled();
  });

  it('times out and aborts a status request that is still in flight at the local deadline', async () => {
    const pending = deferred<FalTask>();
    const initial = makeJob({ id: 'fal-job-hung', requestId: 'request_hung001' });
    getFalJobStatus.mockReturnValue(pending.promise);
    useFalJobsStore.getState().upsertJob(initial);
    render(<FalJobsProvider><div /></FalJobsProvider>);

    await advance(nextFalPollDelay(0));
    const signal = getFalJobStatus.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await advance(FAL_JOB_TIMEOUT_MS - nextFalPollDelay(0));

    expect(signal.aborted).toBe(true);
    expect(useFalJobsStore.getState().jobs[0]).toMatchObject({
      state: 'timed_out',
      error: TIMEOUT_MESSAGE,
      updatedAt: NOW + FAL_JOB_TIMEOUT_MS,
    });
    expect(getFalJobStatus).toHaveBeenCalledTimes(1);
    expect(cancelFalJob).not.toHaveBeenCalled();
  });

  it('polls multiple jobs independently when one status request fails', async () => {
    const failedPoll = makeJob({ id: 'fal-job-one', requestId: 'request_multi01' });
    const successfulPoll = makeJob({ id: 'fal-job-two', requestId: 'request_multi02' });
    getFalJobStatus.mockImplementation(({ requestId }: { requestId: string }) => {
      if (requestId === failedPoll.requestId) return Promise.reject(new Error('temporary'));
      return Promise.resolve({
        requestId,
        state: 'success',
        logs: ['Done'],
        resultUrl: 'https://v3.fal.media/files/fox/multi.mp4',
        mimeType: 'video/mp4',
      });
    });
    useFalJobsStore.getState().upsertJob(failedPoll);
    useFalJobsStore.getState().upsertJob(successfulPoll);
    render(<FalJobsProvider><div /></FalJobsProvider>);

    await advance(nextFalPollDelay(0));

    expect(getFalJobStatus).toHaveBeenCalledTimes(2);
    expect(useFalJobsStore.getState().jobs.find((job) => job.id === failedPoll.id)).toMatchObject({
      state: 'queued',
      pollAttempt: 1,
    });
    expect(
      useFalJobsStore.getState().jobs.find((job) => job.id === successfulPoll.id)
    ).toMatchObject({ state: 'success', pollAttempt: 1 });
  });

  it.each([
    {
      name: 'removal',
      mutate(job: FalJob) {
        useFalJobsStore.getState().removeJob(job.id);
      },
      expected: undefined,
    },
    {
      name: 'cancellation',
      mutate(job: FalJob) {
        useFalJobsStore.getState().upsertJob({ ...job, state: 'cancelled', updatedAt: NOW + 1 });
      },
      expected: { state: 'cancelled' },
    },
    {
      name: 'request ID change',
      mutate(job: FalJob) {
        useFalJobsStore.getState().upsertJob({ ...job, requestId: 'request_changed2' });
      },
      expected: { requestId: 'request_changed2', state: 'queued' },
    },
    {
      name: 'model change',
      mutate(job: FalJob) {
        useFalJobsStore.getState().upsertJob({ ...job, modelId: 'hailuo-2-3-standard' });
      },
      expected: { modelId: 'hailuo-2-3-standard', state: 'queued' },
    },
    {
      name: 'terminal transition',
      mutate(job: FalJob) {
        useFalJobsStore.getState().upsertJob({
          ...job,
          state: 'fail',
          error: 'Stopped elsewhere',
        });
      },
      expected: { state: 'fail', error: 'Stopped elsewhere' },
    },
  ])('ignores a late success after $name while polling', async ({ mutate, expected }) => {
    const pending = deferred<FalTask>();
    const initial = makeJob({ id: 'fal-job-stale', requestId: 'request_stale01' });
    getFalJobStatus.mockReturnValue(pending.promise);
    useFalJobsStore.getState().upsertJob(initial);
    render(<FalJobsProvider><div /></FalJobsProvider>);
    await advance(nextFalPollDelay(0));

    act(() => mutate(initial));
    await act(async () => {
      pending.resolve({
        requestId: initial.requestId,
        state: 'success',
        logs: ['Late'],
        resultUrl: 'https://v3.fal.media/files/stale/late.mp4',
        mimeType: 'video/mp4',
      });
      await pending.promise;
    });

    const current = useFalJobsStore.getState().jobs.find((job) => job.id === initial.id);
    if (expected === undefined) expect(current).toBeUndefined();
    else expect(current).toMatchObject(expected);
  });

  it('ignores a late rejection after an in-flight job is cancelled', async () => {
    const pending = deferred<FalTask>();
    const initial = makeJob({ id: 'fal-job-reject', requestId: 'request_reject1' });
    getFalJobStatus.mockReturnValue(pending.promise);
    useFalJobsStore.getState().upsertJob(initial);
    render(<FalJobsProvider><div /></FalJobsProvider>);
    await advance(nextFalPollDelay(0));

    act(() =>
      useFalJobsStore.getState().upsertJob({
        ...initial,
        state: 'cancelled',
        updatedAt: NOW + 1,
      })
    );
    await act(async () => {
      pending.reject(new Error('late secret provider response'));
      await pending.promise.catch(() => undefined);
    });

    expect(useFalJobsStore.getState().jobs[0]).toMatchObject({
      state: 'cancelled',
      pollAttempt: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('invalidates local timers and in-flight work on unmount', async () => {
    const pending = deferred<FalTask>();
    const initial = makeJob({ id: 'fal-job-unmount', requestId: 'request_unmount1' });
    getFalJobStatus.mockReturnValue(pending.promise);
    useFalJobsStore.getState().upsertJob(initial);
    const view = render(<FalJobsProvider><div /></FalJobsProvider>);
    await advance(nextFalPollDelay(0));
    const signal = getFalJobStatus.mock.calls[0][1].signal as AbortSignal;

    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve({
        requestId: initial.requestId,
        state: 'success',
        logs: ['Too late'],
        resultUrl: 'https://v3.fal.media/files/unmounted/late.mp4',
        mimeType: 'video/mp4',
      });
      await pending.promise;
    });

    expect(useFalJobsStore.getState().jobs[0]).toEqual(initial);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create duplicate simultaneous status calls in StrictMode or on rerender', async () => {
    const pending = deferred<FalTask>();
    const initial = makeJob({ id: 'fal-job-strict', requestId: 'request_strict01' });
    getFalJobStatus.mockReturnValue(pending.promise);
    useFalJobsStore.getState().upsertJob(initial);
    const view = render(
      <StrictMode>
        <FalJobsProvider><div /></FalJobsProvider>
      </StrictMode>
    );
    view.rerender(
      <StrictMode>
        <FalJobsProvider><span /></FalJobsProvider>
      </StrictMode>
    );

    await advance(nextFalPollDelay(0));
    await advance(nextFalPollDelay(1));

    expect(getFalJobStatus).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });
});
