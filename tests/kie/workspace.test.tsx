import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import KieGenerationWorkspace from '../../components/KieGenerationWorkspace';
import { useAppStore } from '../../store/useAppStore';
import { useKieJobsStore } from '../../store/useKieJobsStore';
import { useSeedFrameStore } from '../../store/useSeedFrameStore';
import { useDraftStore } from '../../store/useDraftStore';

const { submitKieJobMock, uploadKieFilesMock, fetchKieCreditsMock } = vi.hoisted(() => ({
  submitKieJobMock: vi.fn(),
  uploadKieFilesMock: vi.fn(),
  fetchKieCreditsMock: vi.fn(),
}));

vi.mock('../../lib/kie/browser', () => ({
  submitKieJob: submitKieJobMock,
  uploadKieFiles: uploadKieFilesMock,
  fetchKieCredits: fetchKieCreditsMock,
}));

describe('Kie generation workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadKieFilesMock.mockResolvedValue([]);
    submitKieJobMock.mockResolvedValue({ taskId: 'task_test', protocol: 'market' });
    fetchKieCreditsMock.mockResolvedValue(1000);
    useAppStore.setState({
      apiKey: 'gemini_test_key',
      kieApiKey: 'kie_test_key',
      kieImageModel: 'nano-banana-pro',
      kieVideoModel: 'veo-3-1',
    });
    useKieJobsStore.getState().clearJobs();
    useSeedFrameStore.getState().clearSeedFrame();
    useDraftStore.getState().reset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders the compatible video model and its documented dynamic controls', () => {
    render(
      <KieGenerationWorkspace
        mediaType="video"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    expect(screen.getByRole('heading', { name: 'Text to video' })).toBeTruthy();
    expect(within(screen.getByRole('listbox', { name: 'Model' })).getByRole('option', { selected: true })).toHaveAccessibleName('Veo 3.1');
    expect((screen.getByLabelText('Generation mode') as HTMLSelectElement).selectedOptions[0].textContent).toBe('TEXT 2 VIDEO');
    expect(screen.getByText(/Results are temporary/i)).toBeTruthy();
    const searchInput = screen.getByLabelText('Search compatible models');
    expect(searchInput.className).toContain('flex-1');
    expect(searchInput.parentElement?.className).toContain('flex');
    expect(screen.getByText(/including first and last frame/i).className).not.toContain('border');
  });

  it('starts the prompt at two rows with the shared expansion cap', () => {
    render(
      <KieGenerationWorkspace
        mediaType="video"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );
    const prompt = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;

    expect(prompt.rows).toBe(2);
    expect(prompt).toHaveClass('max-h-[16.25rem]', 'overflow-y-auto', 'resize-none');
  });

  it('places the prompt card in the result column immediately before result', () => {
    render(
      <KieGenerationWorkspace
        mediaType="video"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    const promptSection = screen.getByRole('textbox', { name: 'Prompt' }).closest('section');
    const resultSection = screen.getByRole('heading', { name: 'Result' }).closest('section');

    expect(promptSection).not.toBeNull();
    expect(resultSection).not.toBeNull();
    // Same column, not the same parent: the prompt and its Generate button now
    // sit inside the sticky scrim that results scroll under, so the column is
    // the result section's parent and the prompt lives one level inside it.
    expect(resultSection!.parentElement!.contains(promptSection!)).toBe(true);
    expect(
      promptSection!.compareDocumentPosition(resultSection!)
      & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('offers the shared stored-image picker in image-input modes', () => {
    render(
      <KieGenerationWorkspace
        mediaType="video"
        inputMode="image"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: 'From library' })).toBeInTheDocument();
  });

  it('renders a completed video in the in-house player with an immediate download action', () => {
    useKieJobsStore.getState().upsertJob({
      id: 'video_task_1',
      taskId: 'video_task_1',
      protocol: 'veo',
      state: 'success',
      resultUrls: ['https://temp.kie.ai/video.mp4'],
      modelId: 'veo-3-1',
      mediaType: 'video',
      inputMode: 'text',
      prompt: 'A quiet ocean',
      createdAt: 1,
      updatedAt: 2,
      pollAttempt: 1,
    });
    const { container } = render(
      <KieGenerationWorkspace
        mediaType="video"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    // `#t=0.1` is the player's opening-frame seek; the download anchor below
    // still carries the bare URL, which is the one a viewer receives.
    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      'https://temp.kie.ai/video.mp4#t=0.1'
    );
    expect((container.querySelector('a[download]') as HTMLAnchorElement).href).toBe('https://temp.kie.ai/video.mp4');
  });

  it('derives a semantic download slug for a submitted task from the connected Gemini key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ slug: 'quiet-ocean-at-dusk' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <KieGenerationWorkspace
        mediaType="image"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: '  A quiet ocean at dusk  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate image/i }));

    await waitFor(() =>
      expect(useKieJobsStore.getState().jobs[0]?.slug).toBe('quiet-ocean-at-dusk')
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/slug', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      prompt: 'A quiet ocean at dusk',
      apiKey: 'gemini_test_key',
    });
  });

  describe('automatic retry after a transient failure', () => {
    const transient = () => Object.assign(new Error('Kie is temporarily unavailable. Please try again.'), { status: 503 });

    const startGeneration = () => {
      render(
        <KieGenerationWorkspace
          mediaType="image"
          inputMode="text"
          onBack={() => undefined}
          onOpenConnections={() => undefined}
        />
      );
      fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A glass forest' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));
    };

    const tick = async (seconds: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(seconds * 1_000);
      });
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('counts the failed submission down and sends it again', async () => {
      submitKieJobMock.mockRejectedValueOnce(transient());
      startGeneration();

      await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('temporarily unavailable'));
      expect(screen.getByText(/Retrying in 10s · attempt 1 of 5/)).toBeInTheDocument();

      await tick(10);
      await vi.waitFor(() => expect(submitKieJobMock).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(useKieJobsStore.getState().jobs[0]?.id).toBe('task_test'));
      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();
    });

    it('stops when the tiny cancel control is used', async () => {
      submitKieJobMock.mockRejectedValue(transient());
      startGeneration();

      await vi.waitFor(() => expect(screen.getByText(/Retrying in 10s/)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Cancel automatic retry' }));

      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();
      await tick(60);
      expect(submitKieJobMock).toHaveBeenCalledOnce();
      // The failure itself stays on screen — only the countdown was cancelled.
      expect(screen.getByRole('alert').textContent).toContain('temporarily unavailable');
    });

    it('gives up after five attempts', async () => {
      submitKieJobMock.mockRejectedValue(transient());
      startGeneration();

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await vi.waitFor(() =>
          expect(screen.getByText(new RegExp(`attempt ${attempt} of 5`))).toBeInTheDocument()
        );
        await tick(10);
      }

      await vi.waitFor(() => expect(submitKieJobMock).toHaveBeenCalledTimes(6));
      await tick(60);
      expect(submitKieJobMock).toHaveBeenCalledTimes(6);
      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();
    });

    it('never retries a failure that would fail the same way again', async () => {
      submitKieJobMock.mockRejectedValue(
        Object.assign(new Error('Your Kie account has insufficient credits.'), { status: 402 })
      );
      startGeneration();

      await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('insufficient credits'));
      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();
      await tick(60);
      expect(submitKieJobMock).toHaveBeenCalledOnce();
    });
  });

  it('opens a Kie image full screen and closes it again', async () => {
    useKieJobsStore.getState().upsertJob({
      id: 'image_task_light',
      taskId: 'image_task_light',
      protocol: 'market',
      state: 'success',
      resultUrls: ['https://temp.kie.ai/result.png'],
      modelId: 'nano-banana-pro',
      mediaType: 'image',
      inputMode: 'text',
      prompt: 'A quiet ocean at dusk',
      createdAt: 1,
      updatedAt: 2,
      pollAttempt: 1,
    });

    render(
      <KieGenerationWorkspace
        mediaType="image"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    // Both image panels share ResultStack's lightbox now, and with it one label.
    expect(screen.queryByAltText('Generated image, full size')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /View full screen/i }));

    const full = await screen.findByAltText('Generated image, full size');
    expect(full).toHaveAttribute('src', 'https://temp.kie.ai/result.png');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByAltText('Generated image, full size')).toBeNull());
  });

  it('downloads a completed Kie result as a blob named after its slug', async () => {
    useKieJobsStore.getState().upsertJob({
      id: 'image_task_1',
      taskId: 'image_task_1',
      protocol: 'market',
      state: 'success',
      resultUrls: ['https://temp.kie.ai/result.png'],
      modelId: 'nano-banana-pro',
      mediaType: 'image',
      inputMode: 'text',
      prompt: 'A quiet ocean at dusk',
      slug: 'quiet-ocean-at-dusk',
      createdAt: 1,
      updatedAt: 2,
      pollAttempt: 1,
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['image'], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    );
    const createObjectURL = vi.fn(() => 'blob:kie-image');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(
      <KieGenerationWorkspace
        mediaType="image"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Download image/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('https://temp.kie.ai/result.png', { signal: undefined });
    const downloadLink = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(downloadLink.href).toBe('blob:kie-image');
    expect(downloadLink.download).toBe('quiet-ocean-at-dusk-nano-banana-pro.png');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:kie-image');
  });

  it('uses the saved Gemini key to generate an example prompt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ prompt: 'A luminous glass city above the clouds' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <KieGenerationWorkspace
        mediaType="image"
        inputMode="text"
        exampleFeatureId="text-to-image"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Gen Example' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe(
        'A luminous glass city above the clouds'
      );
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/example', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      featureId: 'text-to-image',
      apiKey: 'gemini_test_key',
    });
  });

  it('claims a handed-over last frame as the reference for the next clip', async () => {
    const file = new File(['frame'], 'quiet-ocean-at-dusk-last-frame.png', { type: 'image/png' });
    useSeedFrameStore.getState().setSeedFrame({ file, sourceLabel: 'quiet-ocean-at-dusk' });

    render(
      <KieGenerationWorkspace
        mediaType="video"
        inputMode="image"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    expect(await screen.findByAltText('Reference 1')).toBeTruthy();
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe(
      'Continue the scene from quiet ocean at dusk.'
    );
    expect(useSeedFrameStore.getState().seed).toBeNull();
  });

  it('keeps reference file selection outside shared model controls', () => {
    const { container } = render(
      <KieGenerationWorkspace
        mediaType="image"
        inputMode="image"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    const fileInputs = container.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(1);
    expect(fileInputs[0].className).toContain('hidden');
    expect(screen.getByRole('button', { name: /drop, upload, or paste an image or video/i })).toBeTruthy();
  });

  it('submits shared control values with their declared types', async () => {
    useAppStore.setState({ kieImageModel: 'flux-2-pro' });

    render(
      <KieGenerationWorkspace
        mediaType="image"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A glass forest' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Seed' }), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('radio', { name: '2K' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

    await waitFor(() => expect(submitKieJobMock).toHaveBeenCalledOnce());
    expect(submitKieJobMock).toHaveBeenCalledWith(expect.objectContaining({
      values: expect.objectContaining({ seed: 42, resolution: '2K' }),
    }));
    expect(uploadKieFilesMock).toHaveBeenCalledWith('kie_test_key', []);
  });

  it('reads the Kie balance before submitting and pins it to the job', async () => {
    render(
      <KieGenerationWorkspace
        mediaType="image"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A glass forest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }));

    await waitFor(() => expect(submitKieJobMock).toHaveBeenCalledOnce());
    expect(fetchKieCreditsMock).toHaveBeenCalledWith('kie_test_key');
    await waitFor(() =>
      expect(useKieJobsStore.getState().jobs[0]).toMatchObject({ id: 'task_test', creditsBefore: 1000 })
    );
  });

  it.each([
    {
      mediaType: 'image' as const,
      modelState: { kieImageModel: 'nano-banana-pro' },
      choices: ['1K', '2K', '4K'],
      selected: '1K',
      next: '2K',
    },
    {
      mediaType: 'video' as const,
      modelState: { kieVideoModel: 'kling-3-0' },
      choices: ['480p', '720p', '1080p'],
      selected: '720p',
      next: '1080p',
    },
  ])('renders $mediaType resolution as horizontal toggles', ({ mediaType, modelState, choices, selected, next }) => {
    useAppStore.setState(modelState);

    render(
      <KieGenerationWorkspace
        mediaType={mediaType}
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    );

    const resolution = screen.getByRole('radiogroup', { name: 'Resolution' });

    expect(resolution.className).toContain('flex');
    expect(within(resolution).getAllByRole('radio').map((choice) => choice.textContent)).toEqual(choices);
    expect(screen.queryByRole('combobox', { name: 'Resolution' })).toBeNull();
    expect(screen.getByRole('radio', { name: selected }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: next }));

    expect(screen.getByRole('radio', { name: next }).getAttribute('aria-checked')).toBe('true');
  });
});
