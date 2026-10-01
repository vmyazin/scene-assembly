// tests/analytics/queued-result.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';

const { submitProviderVideo, getProviderVideoStatus } = vi.hoisted(() => ({
  submitProviderVideo: vi.fn(),
  getProviderVideoStatus: vi.fn(),
}));

vi.mock('@/lib/providers/browser', () => ({
  submitProviderVideo,
  getProviderVideoStatus,
  pollDelayMs: () => 0,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('provider video results', () => {
  beforeEach(() => {
    submitProviderVideo.mockReset();
    getProviderVideoStatus.mockReset();
    submitProviderVideo.mockResolvedValue('task-1');
    getProviderVideoStatus.mockResolvedValue({
      taskId: 'task-1',
      state: 'error',
      urls: [],
      error: 'IMAGE_SAFETY',
    });
    useProviderJobsStore.getState().clearJobs();
    useDraftStore.getState().reset();
    useAppStore.setState({
      runwareApiKey: 'rw-test',
      runwareVideoModel: 'lightricks:ltx@2.5-fast',
    });
    delete (window as { plausible?: unknown }).plausible;
  });

  it('counts a content-filter stop during polling as the result, not the queue acceptance', async () => {
    const plausible = vi.fn();
    Object.defineProperty(window, 'plausible', { configurable: true, writable: true, value: plausible });
    render(
      <ProviderVideoWorkspace
        provider="runware"
        label="Runware"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A red kite over a green field' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(getProviderVideoStatus).toHaveBeenCalled());
    const names = plausible.mock.calls.map((call) => call[0]);
    expect(names).toContain('generation_submitted');
    expect(names.filter((name) => name === 'generation_result')).toEqual(['generation_result']);
    const submittedAt = names.indexOf('generation_submitted');
    const resultAt = names.indexOf('generation_result');
    expect(submittedAt).toBeGreaterThanOrEqual(0);
    expect(resultAt).toBeGreaterThan(submittedAt);
    expect(plausible.mock.calls[resultAt][1].props).toMatchObject({
      engine: 'runware',
      outcome: 'policy',
      level: 'standard',
      media: 'video',
    });
    expect(plausible.mock.calls.find((call) => call[0] === 'generation_submitted')?.[1].props.outcome).toBeUndefined();
  });
});
