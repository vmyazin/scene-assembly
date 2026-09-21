// tests/gemini-video-workspace.test.tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { RouteError } from '../lib/providers/route-error';

import GeminiVideoWorkspace from '../components/GeminiVideoWorkspace';
import VideoWorkspace from '../components/VideoWorkspace';
import { createMemoryGalleryStorage } from '../lib/gallery/memory-storage';
import { useAppStore } from '../store/useAppStore';
import { useDraftStore } from '../store/useDraftStore';
import { configureGalleryStorage, useGalleryStore } from '../store/useGalleryStore';
import { useSeedFrameStore } from '../store/useSeedFrameStore';
import { useSpendStore } from '../store/useSpendStore';

const VIDEO_URI = 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media';

const {
  geminiGenerateVideoMock,
  geminiPollVideoOperationMock,
  geminiDownloadVideoMock,
  geminiVideoWaitMock,
  requestPromptSlugMock,
} = vi.hoisted(() => ({
  geminiGenerateVideoMock: vi.fn(),
  geminiPollVideoOperationMock: vi.fn(),
  geminiDownloadVideoMock: vi.fn(),
  geminiVideoWaitMock: vi.fn(),
  requestPromptSlugMock: vi.fn(),
}));

vi.mock('../lib/engines/gemini', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/engines/gemini')>()),
  geminiGenerateVideo: geminiGenerateVideoMock,
  geminiPollVideoOperation: geminiPollVideoOperationMock,
  geminiDownloadVideo: geminiDownloadVideoMock,
  geminiVideoWait: geminiVideoWaitMock,
}));

vi.mock('../lib/micro-ai/browser', () => ({
  requestPromptSlug: requestPromptSlugMock,
  requestExamplePrompt: vi.fn(),
}));

describe('Gemini video workspace image-to-video', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    let urls = 0;
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => `blob:gemini-${++urls}`),
        revokeObjectURL: vi.fn(),
      })
    );
    configureGalleryStorage(createMemoryGalleryStorage());
    useGalleryStore.setState({ records: [], hydrated: true, storageError: null });
    useSpendStore.setState({ entries: [] });
    geminiGenerateVideoMock.mockResolvedValue({
      operation: 'operations/veo-1',
      done: true,
      videoUri: VIDEO_URI,
    });
    geminiDownloadVideoMock.mockResolvedValue(new Blob(['mp4-bytes'], { type: 'video/mp4' }));
    geminiVideoWaitMock.mockResolvedValue(undefined);
    requestPromptSlugMock.mockResolvedValue('the-cat-leaps-forward');
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

  it('does not show the stub coming-soon callout once Generate is wired', () => {
    renderTextWorkspace();
    expect(screen.queryByText(/coming in the next update/i)).toBeNull();
    expect(screen.queryByText(/use other providers for video generation/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Generate video/ })).toHaveTextContent(/~\$0\.40/);
  });

  it('renders duration and resolution through the shared fal-style controls', () => {
    renderTextWorkspace();

    const resolution = screen.getByRole('radiogroup', { name: 'Resolution' });
    expect(resolution.className).toContain('flex');
    expect(within(resolution).getAllByRole('radio').map((choice) => choice.textContent)).toEqual([
      '720p',
      '1080p',
    ]);
    expect(screen.queryByRole('combobox', { name: 'Resolution' })).toBeNull();
    expect(screen.getByRole('radio', { name: '720p' })).toHaveAttribute('aria-checked', 'true');

    const duration = screen.getByRole('combobox', { name: 'Duration' });
    expect([...duration.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      '4',
      '6',
      '8',
    ]);
    expect(duration).toHaveDisplayValue('8');
    expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveDisplayValue('16:9');

    fireEvent.click(screen.getByRole('radio', { name: '1080p' }));

    expect(screen.getByRole('radio', { name: '1080p' })).toHaveAttribute('aria-checked', 'true');
    expect(
      [...screen.getByRole('combobox', { name: 'Duration' }).querySelectorAll('option')].map(
        (option) => option.textContent
      )
    ).toEqual(['8']);
    expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveDisplayValue('8');
  });

  it('submits a catalog duration chosen from the compact select', async () => {
    renderTextWorkspace();

    const duration = screen.getByRole('combobox', { name: 'Duration' }) as HTMLSelectElement;
    const fourSeconds = within(duration).getAllByRole('option') as HTMLOptionElement[];
    fireEvent.change(duration, { target: { value: fourSeconds[0].value } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(geminiGenerateVideoMock).toHaveBeenCalledOnce());
    expect(geminiGenerateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ resolution: '720p', durationSeconds: 4, aspectRatio: '16:9' }),
      })
    );
  });

  it('forces 8s when generating at 1080p', async () => {
    renderTextWorkspace();

    const duration = screen.getByRole('combobox', { name: 'Duration' }) as HTMLSelectElement;
    fireEvent.change(duration, {
      target: { value: (within(duration).getAllByRole('option') as HTMLOptionElement[])[0].value },
    });
    fireEvent.click(screen.getByRole('radio', { name: '1080p' }));
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(geminiGenerateVideoMock).toHaveBeenCalledOnce());
    expect(geminiGenerateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ resolution: '1080p', durationSeconds: 8 }),
      })
    );
  });

  it('attaches an uploaded still and requires it before generating in image-to-video', async () => {
    const toastSuccess = vi.spyOn(toast, 'success');
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
        imageMimeType: 'image/png',
        model: 'veo-3.1-lite-generate-preview',
        singleAttempt: true,
      })
    );
    const image = geminiGenerateVideoMock.mock.calls[0][0].image as string;
    expect(image.length).toBeGreaterThan(0);
    expect(image.startsWith('data:')).toBe(false);
    await waitFor(() => expect(geminiDownloadVideoMock).toHaveBeenCalledOnce());
    expect(geminiPollVideoOperationMock).not.toHaveBeenCalled();
    expect(await screen.findByLabelText('Generated video')).toBeInTheDocument();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Video generated'));
    await waitFor(() => expect(useSpendStore.getState().entries).toHaveLength(1));
    expect(useSpendStore.getState().entries[0]).toMatchObject({
      provider: 'gemini',
      kind: 'video',
      modelId: 'veo-3.1-lite-generate-preview',
      galleryRecordId: useGalleryStore.getState().records[0].id,
    });
  });

  it('does not require an image in text-to-video and polls until the operation is done', async () => {
    geminiGenerateVideoMock.mockResolvedValue({
      operation: 'operations/veo-text',
      done: false,
    });
    geminiPollVideoOperationMock
      .mockResolvedValueOnce({ operation: 'operations/veo-text', done: false })
      .mockResolvedValueOnce({ operation: 'operations/veo-text', done: true, videoUri: VIDEO_URI });

    renderTextWorkspace();

    expect(screen.queryByRole('heading', { name: 'Reference image' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    await waitFor(() => expect(geminiGenerateVideoMock).toHaveBeenCalledOnce());
    expect(geminiGenerateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'A moonlit ocean',
        image: undefined,
        singleAttempt: true,
        config: expect.objectContaining({ resolution: '720p', durationSeconds: 8, aspectRatio: '16:9' }),
      })
    );
    await waitFor(() => expect(geminiPollVideoOperationMock).toHaveBeenCalledTimes(2));
    expect(geminiVideoWaitMock).toHaveBeenCalled();
    await waitFor(() => expect(geminiDownloadVideoMock).toHaveBeenCalledWith(
      'gemini-test-key',
      VIDEO_URI,
      expect.objectContaining({ singleAttempt: true })
    ));
    expect(await screen.findByLabelText('Generated video')).toBeInTheDocument();
  });

  it.each([new RouteError('Lost response', 503), new TypeError('Lost response')])(
    'does not automatically resubmit an ambiguous start failure: %s',
    async (failure) => {
      geminiGenerateVideoMock.mockRejectedValue(failure);
      renderTextWorkspace();
      fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
      fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Lost response');
      expect(screen.queryByRole('button', { name: 'Cancel automatic retry' })).toBeNull();
      expect(useSpendStore.getState().entries).toHaveLength(0);
    }
  );

  it('still offers a cancellable retry for an explicit quota rejection', async () => {
    geminiGenerateVideoMock.mockRejectedValue(new RouteError('Quota exceeded', 429));
    renderTextWorkspace();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));
    expect(await screen.findByRole('button', { name: 'Cancel automatic retry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel automatic retry' }));
  });

  it('records completed generation spend once when downloading fails', async () => {
    geminiDownloadVideoMock.mockRejectedValue(new Error('Download failed'));
    renderTextWorkspace();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Download failed');
    expect(useSpendStore.getState().entries).toHaveLength(1);
    expect(useSpendStore.getState().entries[0]).toMatchObject({
      provider: 'gemini', kind: 'video', modelId: 'veo-3.1-lite-generate-preview',
    });
    expect(useGalleryStore.getState().records).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Cancel automatic retry' })).toBeNull();
  });

  it('records spend once and keeps the result when library persistence fails', async () => {
    const record = vi.spyOn(useGalleryStore.getState(), 'record').mockRejectedValueOnce(new Error('Storage full'));
    try {
      renderTextWorkspace();
      fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
      fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));
      expect(await screen.findByLabelText('Generated video')).toBeInTheDocument();
      await waitFor(() => expect(useSpendStore.getState().entries).toHaveLength(1));
      expect(useSpendStore.getState().entries[0].galleryRecordId).toBeUndefined();
    } finally {
      record.mockRestore();
    }
  });

  it('does not record spend for a failed operation', async () => {
    geminiGenerateVideoMock.mockResolvedValue({
      operation: 'operations/blocked', done: true, error: 'Video blocked',
    });
    renderTextWorkspace();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Video blocked');
    expect(useSpendStore.getState().entries).toHaveLength(0);
    expect(geminiDownloadVideoMock).not.toHaveBeenCalled();
  });

  it('shows an honest error when start fails and does not toast the old stub copy', async () => {
    geminiGenerateVideoMock.mockRejectedValue(new Error('Gemini could not start video generation.'));
    const toastError = vi.spyOn(toast, 'error');
    const toastInfo = vi.spyOn(toast, 'info');
    renderTextWorkspace();

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A moonlit ocean' } });
    fireEvent.click(screen.getByRole('button', { name: /^Generate video/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Gemini could not start video generation.');
    expect(toastError).toHaveBeenCalledWith('Gemini could not start video generation.');
    expect(toastInfo).not.toHaveBeenCalled();
    expect(geminiDownloadVideoMock).not.toHaveBeenCalled();
  });
});
