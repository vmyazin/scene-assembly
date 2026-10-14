// tests/providers/follow-video.test.ts
import { describe, expect, it } from 'vitest';
import { followProviderVideo, type FollowVideoPatch } from '@/lib/providers/follow-video';
import type { ProviderTask } from '@/lib/providers/types';

const running: ProviderTask = { taskId: 't', state: 'running', urls: [] };

describe('followProviderVideo', () => {
  it('marks the job failed when polling times out', async () => {
    const patches: FollowVideoPatch[] = [];
    const result = await followProviderVideo({
      maxAttempts: 2,
      delayMs: () => 0,
      timeoutMessage: 'still working',
      poll: async () => running,
      onUpdate: (patch) => patches.push(patch),
      onSuccess: () => { throw new Error('should not succeed'); },
    });
    expect(result).toEqual({ outcome: 'timeout', error: 'still working' });
    expect(patches.at(-1)).toMatchObject({ state: 'error', error: 'still working' });
  });

  it('marks the job failed when the status call throws', async () => {
    const patches: FollowVideoPatch[] = [];
    await expect(followProviderVideo({
      maxAttempts: 2,
      delayMs: () => 0,
      timeoutMessage: 'still working',
      poll: async () => { throw new Error('status down'); },
      onUpdate: (patch) => patches.push(patch),
      onSuccess: () => {},
    })).rejects.toThrow('status down');
    expect(patches.at(-1)).toMatchObject({ state: 'error', error: 'status down' });
  });

  it('keeps a successful video when filing it fails once and then succeeds', async () => {
    const patches: FollowVideoPatch[] = [];
    let filings = 0;
    const result = await followProviderVideo({
      delayMs: () => 0,
      timeoutMessage: 'still working',
      poll: async () => ({ taskId: 't', state: 'success', urls: ['https://example.test/v.mp4'] }),
      onUpdate: (patch) => patches.push(patch),
      onSuccess: () => {
        filings += 1;
        if (filings === 1) throw new Error('ledger down');
      },
    });
    expect(result.outcome).toBe('success');
    expect(filings).toBe(2);
    expect(patches.some((patch) => patch.state === 'error')).toBe(false);
    expect(patches.some((patch) => patch.state === 'success' && patch.urls?.[0] === 'https://example.test/v.mp4')).toBe(true);
  });
});
