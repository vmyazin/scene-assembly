import { describe, expect, it } from 'vitest';
import { forgetStagedSource, stageSource, stagedSourceId } from '@/lib/account/staged-sources';

describe('staged sources', () => {
  const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
  it('belongs to its owner, and lapses five minutes before expiry', () => {
    stageSource(file, { uploadId: 'u1', owner: 'owner', expiresAt: 1_000_000 });
    expect(stagedSourceId(file, 'owner', 1_000_000 - 300_001)).toBe('u1');
    expect(stagedSourceId(file, 'owner', 1_000_000 - 299_999)).toBeUndefined();
    expect(stagedSourceId(file, 'other', 0)).toBeUndefined();
    expect(stagedSourceId(new File(['x'], 'clip.mp4'), 'owner', 0)).toBeUndefined();
    forgetStagedSource(file);
    expect(stagedSourceId(file, 'owner', 0)).toBeUndefined();
  });
});
