// tests/video-workspace.test.tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VideoWorkspace from '../components/VideoWorkspace';
import { useAppStore } from '../store/useAppStore';
import { useDraftStore } from '../store/useDraftStore';
import { useFalJobsStore } from '../store/useFalJobsStore';

const { cancelFalJobMock, submitFalJobMock, uploadFalFilesMock } = vi.hoisted(() => ({
  cancelFalJobMock: vi.fn(),
  submitFalJobMock: vi.fn(),
  uploadFalFilesMock: vi.fn(),
}));

vi.mock('../lib/fal/browser', () => ({
  cancelFalJob: cancelFalJobMock,
  submitFalJob: submitFalJobMock,
  uploadFalFiles: uploadFalFilesMock,
}));

vi.mock('../components/KieGenerationWorkspace', () => ({
  default: ({
    inputMode,
    onBack,
    onOpenConnections,
  }: {
    inputMode: 'text' | 'image';
    onBack: () => void;
    onOpenConnections: () => void;
  }) => (
    <div data-testid="kie-workspace">
      Kie workspace: {inputMode}
      <button type="button" onClick={onBack}>Kie back</button>
      <button type="button" onClick={onOpenConnections}>Kie connections</button>
    </div>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('VideoWorkspace provider selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    uploadFalFilesMock.mockResolvedValue([]);
    submitFalJobMock.mockResolvedValue({ requestId: 'request_submit01' });
    cancelFalJobMock.mockResolvedValue(undefined);
    useAppStore.setState({
      falApiKey: '',
      videoEngine: 'kie',
      falVideoModel: 'veo-3-1-fast',
    });
    useDraftStore.getState().reset();
    useFalJobsStore.getState().clearJobs();
  });

  it('keeps first-and-last selected when moving to a provider that can run it', async () => {
    // The downgrade used to fire for "anything but fal", so choosing Runware —
    // whose LTX-2.5 Fast and Seedance 2.0 Mini both take two frame images —
    // silently dropped the user back to image-to-video.
    const onInputModeChange = vi.fn();
    useAppStore.setState({ videoEngine: 'fal' });
    render(
      <VideoWorkspace
        inputMode="frames"
        onInputModeChange={onInputModeChange}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    await userEvent.click(screen.getByRole('radio', { name: /Runware/i }));
    expect(onInputModeChange).not.toHaveBeenCalled();
    expect(useAppStore.getState().videoEngine).toBe('runware');
  });

  it('drops out of first-and-last for a provider that cannot run it', async () => {
    const onInputModeChange = vi.fn();
    useAppStore.setState({ videoEngine: 'fal' });
    render(
      <VideoWorkspace
        inputMode="frames"
        onInputModeChange={onInputModeChange}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    // Kie has no first-and-last model at all.
    await userEvent.click(screen.getByRole('radio', { name: /Kie\.ai/i }));
    expect(onInputModeChange).toHaveBeenCalledWith('image');
  });

  it('keeps Kie as the persisted default and lists every video provider', () => {
    render(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={() => undefined}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    const providers = screen.getByRole('radiogroup', { name: 'Video provider' });
    // Runware leads as the cheapest per second, then Kie and fal; Gemini is
    // the BYOK option in the fourth slot, then the remaining aggregators.
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent?.trim())).toEqual([
      'Runware',
      'Kie.ai',
      'fal.ai',
      'Gemini',
      'Atlas Cloud',
      'CometAPI',
      'PiAPI',
    ]);
    expect(screen.getByRole('radio', { name: /Kie\.ai/i })).toHaveAttribute('aria-checked', 'true');
    expect(providers.compareDocumentPosition(screen.getByTestId('kie-workspace'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('names the Gemini provider and workspace without Google', async () => {
    useAppStore.setState({ apiKey: '' });
    render(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={() => undefined}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    await userEvent.click(screen.getByRole('radio', { name: /^Gemini$/ }));

    expect(useAppStore.getState().videoEngine).toBe('gemini');
    expect(screen.getByRole('heading', { name: 'Gemini · Veo 3.1 Lite' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Add your Gemini key to start generating' })
    ).toBeInTheDocument();
  });

  it('supports arrow-key provider selection with a single roving tab stop', () => {
    render(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={() => undefined}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    const kie = screen.getByRole('radio', { name: /Kie\.ai/i });
    const fal = screen.getByRole('radio', { name: /fal\.ai/i });
    expect(kie).toHaveAttribute('tabindex', '0');
    expect(fal).toHaveAttribute('tabindex', '-1');
    kie.focus();
    fireEvent.keyDown(kie, { key: 'ArrowRight' });
    expect(fal).toHaveAttribute('aria-checked', 'true');
    expect(fal).toHaveFocus();
    expect(useAppStore.getState().videoEngine).toBe('fal');
  });

  it('persists provider changes and forwards navigation callbacks to the active workspace', () => {
    const onExit = vi.fn();
    const onOpenConnections = vi.fn();
    render(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={() => undefined}
        onExit={onExit}
        onOpenConnections={onOpenConnections}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: /fal\.ai/i }));
    expect(useAppStore.getState().videoEngine).toBe('fal');
    expect(screen.queryByText(/Kie\.ai video workspace/i)).toBeNull();
    // Level 2 pins this to the workspace heading: the mode card above renders
    // the same words as an h3.
    expect(screen.getByRole('heading', { level: 2, name: 'Text to video' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    // Unkeyed, the connect action lives in the shared not-connected callout
    // rather than the header, on fal exactly as on the aggregators.
    fireEvent.click(screen.getByRole('button', { name: 'Connect key' }));
    expect(onExit).toHaveBeenCalledOnce();
    expect(onOpenConnections).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('radio', { name: /Kie\.ai/i }));
    expect(useAppStore.getState().videoEngine).toBe('kie');
    fireEvent.click(screen.getByRole('button', { name: 'Kie back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kie connections' }));
    expect(onExit).toHaveBeenCalledTimes(2);
    expect(onOpenConnections).toHaveBeenCalledTimes(2);
  });

  it('cancels a stale billed fal submit exactly once when switching providers', async () => {
    const pending = deferred<{ requestId: string }>();
    submitFalJobMock.mockReturnValue(pending.promise);
    useAppStore.setState({
      falApiKey: 'fal-key-secret',
      videoEngine: 'fal',
      falVideoModel: 'veo-3-1-fast',
    });
    render(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={() => undefined}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));
    await waitFor(() => expect(submitFalJobMock).toHaveBeenCalledOnce());
    const signal = submitFalJobMock.mock.calls[0][1].signal as AbortSignal;

    fireEvent.click(screen.getByRole('radio', { name: /Kie\.ai/i }));
    expect(signal.aborted).toBe(false);
    expect(screen.getByTestId('kie-workspace')).toBeInTheDocument();
    await act(async () => {
      pending.resolve({ requestId: 'request_stale_provider' });
      await pending.promise;
    });

    expect(submitFalJobMock).toHaveBeenCalledOnce();
    expect(cancelFalJobMock).toHaveBeenCalledOnce();
    expect(cancelFalJobMock).toHaveBeenCalledWith({
      apiKey: 'fal-key-secret',
      modelId: 'veo-3-1-fast',
      mediaType: 'video',
      inputMode: 'text',
      requestId: 'request_stale_provider',
    });
    expect(useFalJobsStore.getState().jobs).toEqual([]);
  });

  it('preserves fal provider, model, and jobs while changing modes or providers', () => {
    useAppStore.setState({ videoEngine: 'fal', falVideoModel: 'hailuo-2-3-pro' });
    useFalJobsStore.getState().upsertJob({
      id: 'request_keep01',
      requestId: 'request_keep01',
      state: 'queued',
      logs: [],
      modelId: 'hailuo-2-3-pro',
      mediaType: 'video',
      inputMode: 'text',
      prompt: 'Keep running',
      createdAt: 1,
      updatedAt: 1,
      pollAttempt: 0,
    });
    const onInputModeChange = vi.fn();
    const view = render(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={onInputModeChange}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    // A mode card's accessible name is its badge, title, and blurb run together,
    // so these match on the title rather than pinning the whole card's copy.
    fireEvent.click(screen.getByRole('button', { name: /Image to video/ }));
    expect(onInputModeChange).toHaveBeenCalledWith('image');
    view.rerender(
      <VideoWorkspace
        inputMode="image"
        onInputModeChange={onInputModeChange}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: /Kie\.ai/i }));
    fireEvent.click(screen.getByRole('radio', { name: /fal\.ai/i }));

    expect(useAppStore.getState()).toMatchObject({ videoEngine: 'fal', falVideoModel: 'hailuo-2-3-pro' });
    expect(useFalJobsStore.getState().jobs).toHaveLength(1);
    expect(useFalJobsStore.getState().jobs[0].requestId).toBe('request_keep01');
  });

  it('offers first-and-last-frame only on fal, and leaves the mode on Kie', () => {
    const onInputModeChange = vi.fn();
    const view = render(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={onInputModeChange}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    expect(screen.queryByRole('button', { name: /First & last frame/ })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /fal\.ai/i }));
    fireEvent.click(screen.getByRole('button', { name: /First & last frame/ }));
    expect(onInputModeChange).toHaveBeenCalledWith('frames');

    // Kie has no frames models, so it falls back to image-to-video on the way out.
    view.rerender(
      <VideoWorkspace
        inputMode="frames"
        onInputModeChange={onInputModeChange}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: /Kie\.ai/i }));
    expect(onInputModeChange).toHaveBeenLastCalledWith('image');
    expect(screen.getByTestId('kie-workspace')).toHaveTextContent('Kie workspace: image');
  });
});
