// tests/describe-source/workspace.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import { requestSourceDescription } from '@/lib/describe-source/browser';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';

import { DESCRIPTION } from './paragraph';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/describe-source/browser', () => ({
  requestSourceDescription: vi.fn(),
}));

function renderWorkspace(inputMode: 'text' | 'image' | 'edit' = 'image') {
  render(
    <ProviderVideoWorkspace
      provider="runware"
      label="Runware"
      inputMode={inputMode}
      onBack={() => undefined}
      onOpenConnections={() => undefined}
    />
  );
}

describe('Describe source', () => {
  beforeEach(() => {
    vi.mocked(requestSourceDescription).mockReset();
    useProviderJobsStore.getState().clearJobs();
    useDraftStore.setState({ prompt: '', references: [], controlValues: {} });
    useAppStore.setState({
      apiKey: 'gemini-key',
      runwareApiKey: 'test',
      runwareVideoModel: 'bytedance:seedance@2.5',
    });
  });

  it('stays quiet until a source is selected', () => {
    renderWorkspace('text');
    expect(screen.getByRole('button', { name: 'Describe source' })).toBeDisabled();
  });

  it('fills the Seedance prompt from the selected image and leaves it editable', async () => {
    const file = new File(['still'], 'still.png', { type: 'image/png' });
    useDraftStore.setState({
      prompt: '',
      references: [{ id: 'ref-1', file, previewUrl: 'blob:still' }],
      controlValues: {},
    });
    let resolveDescription: (prompt: string) => void = () => undefined;
    vi.mocked(requestSourceDescription).mockImplementation(
      () => new Promise((resolve) => { resolveDescription = resolve; })
    );
    renderWorkspace('image');

    fireEvent.click(screen.getByRole('button', { name: 'Describe source' }));
    expect(screen.getByRole('button', { name: 'Describing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gen Example' })).toBeDisabled();
    expect(requestSourceDescription).toHaveBeenCalledWith(
      [expect.objectContaining({ label: 'Image 1', file })],
      'gemini-key'
    );

    await act(async () => {
      resolveDescription(DESCRIPTION);
    });

    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    expect(prompt).toHaveValue(DESCRIPTION);
    fireEvent.change(prompt, { target: { value: 'Edited after the description.' } });
    expect(prompt).toHaveValue('Edited after the description.');
  });

  it('shows the failure and does not replace the prompt', async () => {
    const file = new File(['still'], 'still.png', { type: 'image/png' });
    useDraftStore.setState({
      prompt: 'Keep this',
      references: [{ id: 'ref-1', file, previewUrl: 'blob:still' }],
      controlValues: {},
    });
    vi.mocked(requestSourceDescription).mockRejectedValue(new Error(DESCRIBE_ERRORS.noKey));
    renderWorkspace('image');

    fireEvent.click(screen.getByRole('button', { name: 'Describe source' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(DESCRIBE_ERRORS.noKey);
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Keep this');
    expect(screen.getByRole('button', { name: 'Describe source' })).toBeEnabled();
  });
});
