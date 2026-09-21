// tests/gemini-video-workspace.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

import GeminiVideoWorkspace from '../components/GeminiVideoWorkspace';
import VideoWorkspace from '../components/VideoWorkspace';
import { useAppStore } from '../store/useAppStore';
import { useDraftStore } from '../store/useDraftStore';
import { useSeedFrameStore } from '../store/useSeedFrameStore';

const { geminiGenerateVideoMock } = vi.hoisted(() => ({
  geminiGenerateVideoMock: vi.fn(),
}));

vi.mock('../lib/engines/gemini', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/engines/gemini')>()),
  geminiGenerateVideo: geminiGenerateVideoMock,
}));

describe('Gemini video workspace image-to-video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:gemini-reference'),
        revokeObjectURL: vi.fn(),
      })
    );
    geminiGenerateVideoMock.mockRejectedValue(
      new Error(
        'Gemini Veo 3.1 Lite image-to-video is not wired yet (still frame received). Use other providers for now.'
      )
    );
    useAppStore.setState({
      apiKey: 'gemini-test-key',
      videoEngine: 'gemini',
      geminiVideoModel: 'veo-3.1-lite-generate-preview',
    });
    useDraftStore.getState().reset();
    useSeedFrameStore.getState().clearSeedFrame();
  });

  function renderImageWorkspace() {
    return render(
      <GeminiVideoWorkspace
        inputMode="image"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
  }

  function renderTextWorkspace() {
    return render(
      <GeminiVideoWorkspace
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
  }

  it('exposes the shared reference picker in image-to-video and hides it for text-to-video', async () => {
    const view = render(
      <VideoWorkspace
        inputMode="image"
        onInputModeChange={() => undefined}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    await userEvent.click(screen.getByRole('radio', { name: /^Gemini$/ }));

    expect(screen.getByRole('heading', { name: 'Reference image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'From library' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reference image file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Drop, upload, or paste an image or video/ })).toBeInTheDocument();

    view.rerender(
      <VideoWorkspace
        inputMode="text"
        onInputModeChange={() => undefined}
        onExit={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    expect(screen.queryByRole('heading', { name: 'Reference image' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'From library' })).toBeNull();
    expect(screen.queryByLabelText('Reference image file')).toBeNull();
  });

  it('attaches an uploaded still and requires it before generating in image-to-video', async () => {
    const toastInfo = vi.spyOn(toast, 'info');
    const { container } = renderImageWorkspace();
    const still = new File(['frame'], 'opening.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'The cat leaps forward' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    expect(screen.getByRole('alert')).toHaveTextContent('Add the image this clip should start from.');
    expect(geminiGenerateVideoMock).not.toHaveBeenCalled();

    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [still] } });

    expect(await screen.findByAltText('Reference 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(geminiGenerateVideoMock).toHaveBeenCalledOnce());
    expect(geminiGenerateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'The cat leaps forward',
        image: expect.any(String),
        model: 'veo-3.1-lite-generate-preview',
      })
    );
    const image = geminiGenerateVideoMock.mock.calls[0][0].image as string;
    expect(image.length).toBeGreaterThan(0);
    expect(image.startsWith('data:')).toBe(false);
    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith(
        'Gemini Veo 3.1 Lite image-to-video is not wired yet (still frame received). Use other providers for now.'
      )
    );
  });

  it('does not require an image in text-to-video', async () => {
    geminiGenerateVideoMock.mockRejectedValue(
      new Error('Gemini Veo 3.1 Lite text-to-video is not wired yet. Use other providers for now.')
    );
    const toastInfo = vi.spyOn(toast, 'info');
    renderTextWorkspace();

    expect(screen.queryByRole('heading', { name: 'Reference image' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(geminiGenerateVideoMock).toHaveBeenCalledOnce());
    expect(geminiGenerateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'A moonlit ocean',
        image: undefined,
      })
    );
    await waitFor(() =>
      expect(toastInfo).toHaveBeenCalledWith(
        'Gemini Veo 3.1 Lite text-to-video is not wired yet. Use other providers for now.'
      )
    );
  });
});
