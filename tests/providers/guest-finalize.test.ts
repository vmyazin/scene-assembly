// tests/providers/guest-finalize.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuestFinalize } from '@/lib/providers/guest-finalize';
import { finalizeProviderDraft, getProviderVideoStatus } from '@/lib/providers/browser';
import { recordFinishedJob } from '@/lib/gallery/record-job';
import { captureProviderJob } from '@/lib/spend/capture';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';

vi.mock('@/lib/providers/browser', () => ({
  finalizeProviderDraft: vi.fn().mockResolvedValue('task-1'),
  getProviderVideoStatus: vi.fn(),
  pollDelayMs: () => 0,
}));
vi.mock('@/lib/gallery/record-job', () => ({ recordFinishedJob: vi.fn() }));
vi.mock('@/lib/spend/capture', () => ({ captureProviderJob: vi.fn() }));
vi.mock('@/lib/notify/chime', () => ({ playGenerationChime: vi.fn() }));

const args = {
  apiKey: 'key', modelId: 'bytedance:seedance@2.5', prompt: 'A lighthouse', inputMode: 'text' as const,
  draftId: 'draft-1', durationSeconds: 5,
};

beforeEach(() => {
  useProviderJobsStore.getState().clearJobs();
  vi.clearAllMocks();
  vi.mocked(recordFinishedJob).mockImplementation(() => undefined);
});

describe('runGuestFinalize', () => {
  it('files the gallery and the ledger when the finalize finishes', async () => {
    vi.mocked(getProviderVideoStatus).mockResolvedValue({ taskId: 'task-1', state: 'success', urls: ['https://example.test/final.mp4'], cost: 3.07 });
    await runGuestFinalize(args);
    expect(finalizeProviderDraft).toHaveBeenCalledOnce();
    expect(recordFinishedJob).toHaveBeenCalledOnce();
    expect(captureProviderJob).toHaveBeenCalledOnce();
    expect(useProviderJobsStore.getState().jobs[0]).toMatchObject({ state: 'success', urls: ['https://example.test/final.mp4'] });
  });

  it('marks the job failed when polling times out or the status call throws', async () => {
    vi.mocked(getProviderVideoStatus).mockResolvedValue({ taskId: 'task-1', state: 'running', urls: [] });
    await expect(runGuestFinalize(args)).rejects.toThrow(/still working/);
    expect(useProviderJobsStore.getState().jobs[0]?.state).toBe('error');
    expect(recordFinishedJob).not.toHaveBeenCalled();

    useProviderJobsStore.getState().clearJobs();
    vi.mocked(getProviderVideoStatus).mockRejectedValue(new Error('status down'));
    await expect(runGuestFinalize(args)).rejects.toThrow('status down');
    expect(useProviderJobsStore.getState().jobs[0]?.state).toBe('error');
  });

  it('does not put a finished video back to error when filing throws', async () => {
    vi.mocked(getProviderVideoStatus).mockResolvedValue({ taskId: 'task-1', state: 'success', urls: ['https://example.test/final.mp4'] });
    vi.mocked(recordFinishedJob).mockImplementation(() => { throw new Error('gallery down'); });
    await expect(runGuestFinalize(args)).rejects.toThrow('gallery down');
    expect(useProviderJobsStore.getState().jobs[0]).toMatchObject({ state: 'success', urls: ['https://example.test/final.mp4'] });
  });
});
