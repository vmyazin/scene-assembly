// tests/generation-interface.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GenerationInterface from '../components/GenerationInterface';
import { cancelFalJob, runFalImage } from '../lib/fal/browser';
import { falPublishedCost } from '../lib/spend/rates';
import { DEFAULT_GEMINI_IMAGE_MODEL } from '../lib/engines/gemini-catalog';
import { useAppStore } from '../store/useAppStore';
import { useDraftStore } from '../store/useDraftStore';
import { FEATURES, type Feature } from '../types';

vi.mock('@/lib/fal/browser', () => ({
  cancelFalJob: vi.fn(),
  estimateFalJobCost: vi.fn().mockResolvedValue({ costUsd: null }),
  runFalImage: vi.fn(),
}));

// Filename derivation is covered by tests/micro-ai; these tests assert that
// generation and download touch no network beyond the media URL itself.
vi.mock('@/lib/micro-ai/browser', () => ({
  requestPromptSlug: vi.fn().mockResolvedValue(null),
  requestExamplePrompt: vi.fn().mockResolvedValue('An unused example prompt'),
}));

// Archiving a result is covered in tests/gallery; here it must not add network
// traffic to assertions about what generation itself fetches.
vi.mock('@/lib/gallery/capture', async (importOriginal) => ({
  // blobFromDataUrl is a pure local decoder with no network of its own, and the
  // download path depends on it, so it keeps its real implementation.
  blobFromDataUrl: (await importOriginal<typeof import('@/lib/gallery/capture')>()).blobFromDataUrl,
  resultBlob: vi.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' })),
}));

vi.mock('@/components/KieGenerationWorkspace', () => ({
  default: ({ engineSelector }: { engineSelector?: ReactNode }) => (
    <div data-testid="kie-workspace">
      <h2>Kie page title</h2>
      {engineSelector}
    </div>
  ),
}));

const textToImage = FEATURES.find((feature) => feature.id === 'text-to-image')!;
const searchGrounding = FEATURES.find((feature) => feature.id === 'search-grounding')!;
const multiImageCompose = FEATURES.find((feature) => feature.id === 'multi-image-compose')!;
const mockedRunFalImage = vi.mocked(runFalImage);
const mockedCancelFalJob = vi.mocked(cancelFalJob);

function renderInterface(
  feature: Feature = textToImage,
  options: {
    apiKey?: string;
    onBack?: () => void;
    onOpenConnections?: () => void;
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <GenerationInterface
        feature={feature}
        apiKey={options.apiKey ?? ''}
        onBack={options.onBack ?? (() => undefined)}
        onOpenConnections={options.onOpenConnections ?? (() => undefined)}
      />
    </QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const SOCIAL_THUMBNAIL_PROMPT = (prompt: string) => `Create a VIRAL YouTube/Social Media thumbnail with these elements:
- DRAMATIC, eye-catching scene with shocked/surprised facial expression
- BIG, BOLD text overlays with key phrases (use vibrant colors like yellow, red, white)
- Arrows, circles, or highlighting elements pointing to important parts
- High contrast and saturated colors for maximum impact
- Professional editing style that screams "CLICK ME!"
- Energy and urgency in the composition

User's custom requirements: ${prompt}

Style: Photorealistic, professional thumbnail editing, viral content aesthetics`;

const STYLE_TRANSFER_PROMPT = 'Apply the artistic style and aesthetic from the first image to the content and composition of the second image. Preserve the subject matter of the second image while adopting the color palette, brushstrokes, texture, and artistic techniques of the first image.';

describe('GenerationInterface engine selection', () => {
  beforeEach(() => {
    useDraftStore.getState().reset();
    useAppStore.setState({
      engine: 'kie',
      geminiImageModel: DEFAULT_GEMINI_IMAGE_MODEL,
      apiKey: 'gemini_test_key',
      cfAccountId: 'cf_account',
      cfToken: 'cf_token',
      kieApiKey: 'kie_test_key',
    });
  });

  it('keeps Gemini and Cloudflare selectable while the Kie workspace is active', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GenerationInterface
          feature={textToImage}
          apiKey="gemini_test_key"
          onBack={() => undefined}
          onOpenConnections={() => undefined}
        />
      </QueryClientProvider>
    );

    expect(screen.getByTestId('kie-workspace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Google Gemini' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cloudflare · FLUX/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Google Gemini' }));

    expect(useAppStore.getState().engine).toBe('gemini');
    expect(screen.queryByTestId('kie-workspace')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Generated Image' })).toBeTruthy();
  });

  it('uses the standalone Kie-style engine picker for every active engine', () => {
    useAppStore.setState({ engine: 'gemini' });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GenerationInterface
          feature={textToImage}
          apiKey="gemini_test_key"
          onBack={() => undefined}
          onOpenConnections={() => undefined}
        />
      </QueryClientProvider>
    );

    const picker = screen.getByRole('region', { name: 'Generation engine' });

    expect(picker.className).toContain('glass-card');
    expect(
      within(picker).getByRole('button', { name: 'Google Gemini' })
    ).toBeTruthy();
    expect(
      within(picker).getByRole('button', { name: /Cloudflare · FLUX/i })
    ).toBeTruthy();
    expect(within(picker).queryByRole('heading')).toBeNull();
  });

  it('places the engine picker below the Kie page title', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GenerationInterface
          feature={textToImage}
          apiKey="gemini_test_key"
          onBack={() => undefined}
          onOpenConnections={() => undefined}
        />
      </QueryClientProvider>
    );

    const title = screen.getByRole('heading', { name: 'Kie page title' });
    const picker = screen.getByRole('region', { name: 'Generation engine' });

    expect(title.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('places the engine picker below non-Kie page titles', () => {
    useAppStore.setState({ engine: 'gemini' });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GenerationInterface
          feature={textToImage}
          apiKey="gemini_test_key"
          onBack={() => undefined}
          onOpenConnections={() => undefined}
        />
      </QueryClientProvider>
    );

    const title = screen.getByRole('heading', { name: /Text to Image Generation/ });
    const picker = screen.getByRole('region', { name: 'Generation engine' });

    expect(title.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('offers the shared stored-image picker for image-reference features', () => {
    useAppStore.setState({ engine: 'gemini' });

    renderInterface(multiImageCompose);

    expect(screen.getByRole('button', { name: 'From library' })).toBeInTheDocument();
  });

  it('starts the image-generation prompt at two rows with the shared expansion cap', () => {
    useAppStore.setState({ engine: 'gemini' });
    renderInterface(textToImage);
    const prompt = screen.getByRole('textbox') as HTMLTextAreaElement;

    expect(prompt.rows).toBe(2);
    expect(prompt).toHaveClass('max-h-[16.25rem]', 'overflow-y-auto', 'resize-none');
  });

  it('offers all three Gemini models with their prices, and prices the press', () => {
    // One Google AI Studio key runs Pro, Nano Banana 2 and Lite at a fourfold
    // price spread, and the studio used to spend the most expensive of them
    // without asking. The rack is the same one every aggregator engine has.
    useAppStore.setState({ engine: 'gemini', geminiImageModel: 'gemini-3-pro-image-preview' });
    renderInterface(textToImage);

    const rack = screen.getByRole('listbox', { name: 'Model' });
    expect(within(rack).getAllByRole('option').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Gemini 3 Pro Image'),
      expect.stringContaining('Gemini 3.1 Flash Image'),
      expect.stringContaining('Gemini 3.1 Flash Lite Image'),
    ]);
    expect(within(rack).getByRole('option', { name: 'Gemini 3.1 Flash Lite Image' }).textContent).toContain('$0.034');
    expect(screen.getByText(/Est\. ≈ \$0\.134 \/ image · Gemini 3 Pro Image/)).toBeTruthy();

    fireEvent.click(within(rack).getByRole('option', { name: 'Gemini 3.1 Flash Image' }));

    expect(useAppStore.getState().geminiImageModel).toBe('gemini-3.1-flash-image');
    // Persisted, or the choice is lost the moment the workspace is left: the
    // store writes only the fields `partialize` names.
    expect(useAppStore.persist.getOptions().partialize?.(useAppStore.getState())).toMatchObject({
      geminiImageModel: 'gemini-3.1-flash-image',
    });
    expect(screen.getByText(/Est\. ≈ \$0\.067 \/ image · Gemini 3.1 Flash Image/)).toBeTruthy();
  });

  it('narrows the resolution control to what the chosen Gemini model publishes', () => {
    // Lite publishes 1K alone, so a 4K carried over from Pro has to land on 1K
    // rather than sit in the control as a setting the API would reject.
    useAppStore.setState({ engine: 'gemini', geminiImageModel: 'gemini-3-pro-image-preview' });
    renderInterface(textToImage);

    fireEvent.click(screen.getByRole('radio', { name: '4K' }));
    expect(screen.getByRole('radio', { name: '4K' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(within(screen.getByRole('listbox', { name: 'Model' })).getByRole('option', { name: 'Gemini 3.1 Flash Lite Image' }));

    const resolution = screen.getByRole('radiogroup', { name: 'Resolution' });
    expect(within(resolution).getAllByRole('radio').map((choice) => choice.textContent)).toEqual(['1K']);
    expect(screen.getByRole('radio', { name: '1K' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/Est\. ≈ \$0\.034 \/ image · Gemini 3.1 Flash Lite Image/)).toBeTruthy();
  });

  it('hides the Gemini models that cannot ground a search-grounded generation', () => {
    // Lite refuses the Google Search tool, and a mode whose whole point is
    // grounding must not list a model that would silently drop it.
    useAppStore.setState({ engine: 'gemini', geminiImageModel: 'gemini-3.1-flash-lite-image' });
    renderInterface(searchGrounding);

    const rack = screen.getByRole('listbox', { name: 'Model' });
    expect(within(rack).queryByRole('option', { name: 'Gemini 3.1 Flash Lite Image' })).toBeNull();
    expect(within(rack).getByRole('option', { name: 'Gemini 3 Pro Image' }).getAttribute('aria-selected')).toBe('true');
  });

  it('renders Gemini resolution choices as concise horizontal toggles', () => {
    useAppStore.setState({ engine: 'gemini' });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GenerationInterface
          feature={textToImage}
          apiKey="gemini_test_key"
          onBack={() => undefined}
          onOpenConnections={() => undefined}
        />
      </QueryClientProvider>
    );

    const resolution = screen.getByRole('radiogroup', { name: 'Resolution' });
    const choices = within(resolution).getAllByRole('radio');

    expect(resolution.className).toContain('flex');
    expect(choices.map((choice) => choice.textContent)).toEqual(['1K', '2K', '4K']);
    expect(screen.queryByText(/Fast Generation|Balanced Quality|Maximum Quality/)).toBeNull();
    expect(screen.getByRole('radio', { name: '1K' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: '2K' }));

    expect(screen.getByRole('radio', { name: '2K' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('GenerationInterface fal image generation', () => {
  beforeEach(() => {
    useDraftStore.getState().reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockedRunFalImage.mockReset();
    mockedCancelFalJob.mockReset();
    useAppStore.setState({
      engine: 'fal',
      geminiImageModel: DEFAULT_GEMINI_IMAGE_MODEL,
      apiKey: 'gemini_test_key',
      cfAccountId: 'cf_account',
      cfToken: 'cf_token',
      kieApiKey: 'kie_test_key',
      falApiKey: 'fal_id:fal_secret',
    });
  });

  it('offers the fal engine for every image feature', () => {
    for (const feature of FEATURES) {
      const view = renderInterface(feature);

      expect(
        screen.getByRole('button', { name: /^fal\.ai$/i })
      ).toBeTruthy();

      view.unmount();
    }
  });

  it.each(FEATURES)(
    'runs $id through fal with its feature prompt, references, and exact options',
    async (feature) => {
      const prompt = `Matrix prompt for ${feature.id}`;
      const referenceCount = feature.id === 'multi-image-compose' || feature.id === 'style-transfer'
        ? 2
        : feature.requiresImage
          ? 1
          : 0;
      const expectedPrompt = feature.id === 'social-media-thumbnail'
        ? SOCIAL_THUMBNAIL_PROMPT(prompt)
        : feature.id === 'style-transfer'
          ? STYLE_TRANSFER_PROMPT
          : prompt;
      useAppStore.setState({ engine: 'gemini' });
      mockedRunFalImage.mockResolvedValue({
        url: `https://v3.fal.media/files/${feature.id}.png`,
        mimeType: 'image/png',
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      renderInterface(feature);

      fireEvent.click(screen.getByRole('button', { name: /^fal\.ai$/i }));
      const files = Array.from({ length: referenceCount }, (_, index) =>
        new File([`${feature.id}-${index}`], `${feature.id}-${index}.png`, {
          type: 'image/png',
        })
      );
      if (files.length > 0) {
        fireEvent.change(document.querySelector('input[type="file"]')!, {
          target: { files },
        });
        await waitFor(() =>
          expect(screen.getByAltText(`Upload ${files.length}`)).toBeTruthy()
        );
      }
      if (feature.id !== 'style-transfer') {
        fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
      }
      fireEvent.change(screen.getByRole('combobox'), {
        target: { value: '3:4' },
      });
      fireEvent.click(screen.getByRole('radio', { name: '2K' }));
      if (feature.id === 'search-grounding') {
        fireEvent.click(screen.getByRole('checkbox'));
      }
      const expectedDataUrls = files.map((_, index) =>
        screen.getByAltText(`Upload ${index + 1}`).getAttribute('src')
      );

      fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

      await waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(1));
      expect(mockedRunFalImage).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'fal_id:fal_secret',
          prompt: expectedPrompt,
          dataUrls: expectedDataUrls,
          values: {
            aspect_ratio: '3:4',
            resolution: '2K',
            enable_web_search: feature.id === 'search-grounding',
          },
          signal: expect.any(AbortSignal),
        }),
        {}
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('routes text-only generation through fal with the exact mapped values', async () => {
    useAppStore.setState({ engine: 'gemini' });
    mockedRunFalImage.mockResolvedValue({
      url: 'https://v3.fal.media/files/editorial-still-life.webp',
      mimeType: 'image/webp',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderInterface(searchGrounding);

    fireEvent.click(screen.getByRole('button', { name: /^fal\.ai$/i }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'A bright editorial still life' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '2K' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(1));
    expect(mockedRunFalImage).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'fal_id:fal_secret',
        prompt: 'A bright editorial still life',
        dataUrls: [],
        values: {
          aspect_ratio: '1:1',
          resolution: '2K',
          enable_web_search: true,
        },
        signal: expect.any(AbortSignal),
      }),
      {}
    );
    expect(fetchMock).not.toHaveBeenCalledWith('/api/generate', expect.anything());
    expect(screen.getByAltText('Generated').getAttribute('src')).toBe(
      'https://v3.fal.media/files/editorial-still-life.webp'
    );
  });

  it('passes multiple uploaded reference data URLs unchanged', async () => {
    mockedRunFalImage.mockResolvedValue({
      url: 'https://v3.fal.media/files/composite.png',
      mimeType: 'image/png',
    });
    renderInterface(multiImageCompose);
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.webp', { type: 'image/webp' });

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [first, second] },
    });
    await waitFor(() => expect(screen.getByAltText('Upload 2')).toBeTruthy());
    const expectedDataUrls = [
      screen.getByAltText('Upload 1').getAttribute('src'),
      screen.getByAltText('Upload 2').getAttribute('src'),
    ];
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Blend both references naturally' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(1));
    expect(mockedRunFalImage.mock.calls[0][0].dataUrls).toEqual(expectedDataUrls);
    expect(expectedDataUrls).toEqual([
      'data:image/png;base64,Zmlyc3Q=',
      'data:image/webp;base64,c2Vjb25k',
    ]);
  });

  it('counts a transient image failure down and generates again, cancel and all', async () => {
    vi.useFakeTimers();
    try {
      mockedRunFalImage.mockRejectedValue(
        Object.assign(new Error('fal is temporarily unavailable.'), { status: 503 })
      );
      renderInterface();

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Glowing canyon' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

      await vi.waitFor(() =>
        expect(screen.getByText(/Retrying in 10s · attempt 1 of 5/)).toBeInTheDocument()
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await vi.waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(2));

      await vi.waitFor(() => expect(screen.getByText(/attempt 2 of 5/)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Cancel automatic retry' }));

      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mockedRunFalImage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never retries a generation the provider settled against', async () => {
    vi.useFakeTimers();
    try {
      mockedRunFalImage.mockRejectedValue(
        Object.assign(new Error('Your fal key is invalid.'), { status: 401 })
      );
      renderInterface();

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Glowing canyon' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

      await vi.waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mockedRunFalImage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an oversized fal reference before FileReader converts it to a data URL', async () => {
    const readAsDataUrl = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    renderInterface(multiImageCompose);
    const oversized = new File(
      [new Uint8Array(20 * 1024 * 1024 + 1)],
      'oversized.png',
      { type: 'image/png' }
    );

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [oversized] },
    });

    await waitFor(() =>
      expect(screen.getByText('Reference image 1 is larger than 20 MiB.')).toBeTruthy()
    );
    expect(readAsDataUrl).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Upload 1')).toBeNull();
    expect(mockedRunFalImage).not.toHaveBeenCalled();
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
  ])('downloads a remote %s result using a safe .%s filename', async (mimeType, extension) => {
    const resultUrl = `https://v3.fal.media/files/result-${extension}`;
    mockedRunFalImage.mockResolvedValue({ url: resultUrl, mimeType });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['image'], { type: mimeType }), {
        status: 200,
        headers: { 'Content-Type': mimeType },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:download-image');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Glowing canyon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    await waitFor(() => expect(screen.getByAltText('Generated')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Download Image' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const link = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(fetchMock).toHaveBeenCalledWith(resultUrl, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(link.href).toBe('blob:download-image');
    expect(link.download).toBe(`glowing-canyon-nano-banana-2.${extension}`);
    expect(link.download).not.toContain('fal_id:fal_secret');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download-image');
  });

  it('opens API connections instead of submitting when the fal key is missing', () => {
    useAppStore.setState({ falApiKey: '' });
    const onOpenConnections = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderInterface(textToImage, { onOpenConnections });

    expect(screen.getByText('Connect your fal API key to use this engine.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A paper city' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    expect(onOpenConnections).toHaveBeenCalledTimes(1);
    expect(mockedRunFalImage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText('Connect your fal API key first in API connections.')
    ).toBeTruthy();
  });

  it('renders a safe fal error without falling back or exposing the key', async () => {
    mockedRunFalImage.mockRejectedValue(
      new Error('Provider rejected fal_id:fal_secret at https://queue.fal.run?key=fal_id:fal_secret')
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A quiet harbor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() =>
      expect(screen.getByText('Unable to generate this image with fal. Please try again.')).toBeTruthy()
    );
    expect(mockedRunFalImage).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('fal_id:fal_secret');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('fal_id:fal_secret');
    expect(JSON.stringify(consoleLog.mock.calls)).not.toContain('fal_id:fal_secret');
  });

  it('keeps a fal content-policy refusal and offers Relaxed when the filter is on', async () => {
    process.env.NEXT_PUBLIC_RELAXED_FILTER = 'all';
    mockedRunFalImage.mockRejectedValue(new Error('IMAGE_SAFETY'));
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A red kite over a green field' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try with Relaxed' })).toBeTruthy()
    );
    expect(screen.getByText(/blocked this under its content filter/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('NSFW');
    expect(document.body.textContent).not.toContain('uncensored');
    delete process.env.NEXT_PUBLIC_RELAXED_FILTER;
  });

  it('still hides a policy message that contains the fal key', async () => {
    process.env.NEXT_PUBLIC_RELAXED_FILTER = 'all';
    mockedRunFalImage.mockRejectedValue(new Error('IMAGE_SAFETY fal_id:fal_secret'));
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A quiet harbor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() =>
      expect(screen.getByText('Unable to generate this image with fal. Please try again.')).toBeTruthy()
    );
    expect(screen.queryByRole('button', { name: 'Try with Relaxed' })).toBeNull();
    expect(document.body.textContent).not.toContain('fal_id:fal_secret');
    delete process.env.NEXT_PUBLIC_RELAXED_FILTER;
  });

  it.each(['resolve', 'reject'] as const)(
    'silently ignores a stale generation that %s after a newer run starts',
    async (staleOutcome) => {
      const firstRun = deferred<{ url: string; mimeType?: string }>();
      const secondRun = deferred<{ url: string; mimeType?: string }>();
      mockedRunFalImage
        .mockImplementationOnce(() => firstRun.promise)
        .mockImplementationOnce(() => secondRun.promise);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const toastError = vi.spyOn(toast, 'error');
      const toastSuccess = vi.spyOn(toast, 'success');
      renderInterface();

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Two queued scenes' } });
      const generateButton = screen.getByRole('button', { name: 'Generate Image' });
      act(() => {
        generateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        generateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(2));
      const firstSignal = mockedRunFalImage.mock.calls[0][0].signal!;
      const secondSignal = mockedRunFalImage.mock.calls[1][0].signal!;
      expect(firstSignal.aborted).toBe(true);
      expect(secondSignal.aborted).toBe(false);

      await act(async () => {
        if (staleOutcome === 'resolve') {
          firstRun.resolve({
            url: 'https://v3.fal.media/files/stale.png',
            mimeType: 'image/png',
          });
        } else {
          firstRun.reject(new Error('stale fal_id:fal_secret failure'));
        }
        await Promise.resolve();
      });

      expect(screen.queryByAltText('Generated')).toBeNull();
      expect(screen.queryByText('Unable to generate this image with fal. Please try again.')).toBeNull();
      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Generating Magic...' }).hasAttribute('disabled')).toBe(true);
      expect(mockedCancelFalJob).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockedRunFalImage).toHaveBeenCalledTimes(2);

      await act(async () => {
        secondRun.resolve({
          url: 'https://v3.fal.media/files/current.png',
          mimeType: 'image/png',
        });
      });

      await waitFor(() =>
        expect(screen.getByAltText('Generated').getAttribute('src')).toBe(
          'https://v3.fal.media/files/current.png'
        )
      );
      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).toHaveBeenCalledTimes(1);
      expect(mockedCancelFalJob).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['Google Gemini', 'gemini', 'resolve'],
    ['Google Gemini', 'gemini', 'reject'],
    ['Kie.ai', 'kie', 'resolve'],
    ['Kie.ai', 'kie', 'reject'],
  ] as const)(
    'aborts fal when switching to %s (%s) and ignores a late %s',
    async (engineLabel, engineId, lateOutcome) => {
      const run = deferred<{ url: string; mimeType?: string }>();
      mockedRunFalImage.mockImplementation(() => run.promise);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const toastError = vi.spyOn(toast, 'error');
      const toastSuccess = vi.spyOn(toast, 'success');
      renderInterface();

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Old fal scene' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
      await waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(1));
      const signal = mockedRunFalImage.mock.calls[0][0].signal!;

      fireEvent.click(screen.getByRole('button', { name: engineLabel }));

      expect(signal.aborted).toBe(true);
      expect(useAppStore.getState().engine).toBe(engineId);
      if (engineId === 'kie') expect(screen.getByTestId('kie-workspace')).toBeTruthy();

      await act(async () => {
        if (lateOutcome === 'resolve') {
          run.resolve({
            url: 'https://v3.fal.media/files/old-provider.png',
            mimeType: 'image/png',
          });
        } else {
          run.reject(new Error('old provider failure fal_id:fal_secret'));
        }
        await Promise.resolve();
      });

      expect(useAppStore.getState().engine).toBe(engineId);
      expect(screen.queryByAltText('Generated')).toBeNull();
      expect(screen.queryByText('Unable to generate this image with fal. Please try again.')).toBeNull();
      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(mockedCancelFalJob).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockedRunFalImage).toHaveBeenCalledTimes(1);
    }
  );

  it('allows the newly selected provider to generate after aborting stale fal work', async () => {
    const falRun = deferred<{ url: string; mimeType?: string }>();
    mockedRunFalImage.mockImplementation(() => falRun.promise);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        imageData: 'bmV3LXByb3ZpZGVy',
        mimeType: 'image/png',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const toastError = vi.spyOn(toast, 'error');
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Provider handoff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    await waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(1));
    const falSignal = mockedRunFalImage.mock.calls[0][0].signal!;
    fireEvent.click(screen.getByRole('button', { name: 'Google Gemini' }));
    expect(falSignal.aborted).toBe(true);

    await act(async () => {
      falRun.resolve({
        url: 'https://v3.fal.media/files/stale-handoff.png',
        mimeType: 'image/png',
      });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate Image' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    await waitFor(() =>
      expect(screen.getByAltText('Generated').getAttribute('src')).toBe(
        'data:image/png;base64,bmV3LXByb3ZpZGVy'
      )
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/generate', expect.anything());
    expect(toastError).not.toHaveBeenCalled();
    expect(mockedCancelFalJob).not.toHaveBeenCalled();
  });

  it.each([
    ['back navigation', 'resolve'],
    ['back navigation', 'reject'],
    ['component unmount', 'resolve'],
    ['component unmount', 'reject'],
  ] as const)(
    'silently ignores a fal run that completes after %s via %s',
    async (exitMode, lateOutcome) => {
      const run = deferred<{ url: string; mimeType?: string }>();
      mockedRunFalImage.mockImplementation(() => run.promise);
      const onBack = vi.fn();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const toastError = vi.spyOn(toast, 'error');
      const toastSuccess = vi.spyOn(toast, 'success');
      const view = renderInterface(textToImage, { onBack });

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A distant lighthouse' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
      await waitFor(() => expect(mockedRunFalImage).toHaveBeenCalledTimes(1));
      const signal = mockedRunFalImage.mock.calls[0][0].signal!;

      if (exitMode === 'back navigation') {
        fireEvent.click(screen.getByRole('button', { name: '← Back' }));
        expect(onBack).toHaveBeenCalledTimes(1);
      } else {
        view.unmount();
      }
      expect(signal.aborted).toBe(true);

      await act(async () => {
        if (lateOutcome === 'resolve') {
          run.resolve({
            url: 'https://v3.fal.media/files/stale.png',
            mimeType: 'image/png',
          });
        } else {
          run.reject(new Error('late fal_id:fal_secret failure'));
        }
        await Promise.resolve();
      });

      expect(screen.queryByAltText('Generated')).toBeNull();
      expect(screen.queryByText('Unable to generate this image with fal. Please try again.')).toBeNull();
      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(mockedCancelFalJob).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockedRunFalImage).toHaveBeenCalledTimes(1);
    }
  );

  it('prices the fal line from the published rate rather than a literal', () => {
    // This line used to read "fal usage rates apply", on the principle that the
    // app should not invent a figure. It no longer has to invent one: the rate
    // table it prices the finished run with is the same table read here, so the
    // expectation is derived from that source rather than typed in - which is
    // what the original test was protecting.
    const published = falPublishedCost('fal-ai/nano-banana-2', { resolution: '1K', webSearch: false });
    expect(published).not.toBeNull();

    renderInterface();

    expect(screen.getByText(`Est. ≈ $${published!.costUsd.toFixed(3)} / image · Nano Banana 2`)).toBeTruthy();
    expect(screen.queryByText(/usage rates apply/)).toBeNull();
  });

  it('rejects a remote image whose declared size exceeds 20 MiB', async () => {
    mockedRunFalImage.mockResolvedValue({
      url: 'https://v3.fal.media/files/declared-too-large.png',
      mimeType: 'image/png',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response('small body', {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(20 * 1024 * 1024 + 1),
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn();
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Large declared image' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    await waitFor(() => expect(screen.getByAltText('Generated')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Download Image' }));

    await waitFor(() =>
      expect(screen.getByText('Unable to download this image. Please try again.')).toBeTruthy()
    );
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(String(20 * 1024 * 1024 + 1));
    expect(document.body.textContent).not.toContain('declared-too-large');
  });

  it('cancels a streamed remote image when chunks exceed 20 MiB', async () => {
    mockedRunFalImage.mockResolvedValue({
      url: 'https://v3.fal.media/files/stream-too-large.png',
      mimeType: 'image/png',
    });
    const cancelStream = vi.fn();
    const chunks = [
      new Uint8Array(20 * 1024 * 1024),
      new Uint8Array([1]),
    ];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
      },
      cancel: cancelStream,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn();
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Large streamed image' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    await waitFor(() => expect(screen.getByAltText('Generated')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Download Image' }));

    await waitFor(() =>
      expect(screen.getByText('Unable to download this image. Please try again.')).toBeTruthy()
    );
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(cancelStream).toHaveBeenCalledTimes(1);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('stream-too-large');
  });

  it('uses the verified remote response MIME for the download extension', async () => {
    mockedRunFalImage.mockResolvedValue({
      url: 'https://v3.fal.media/files/mime-mismatch.jpg',
      mimeType: 'image/jpeg',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new Blob(['webp'], { type: 'image/webp' }), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      })
    ));
    const createObjectURL = vi.fn(() => 'blob:verified-mime');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Verified MIME' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    await waitFor(() => expect(screen.getByAltText('Generated')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Download Image' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const link = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(link.download).toBe('verified-mime-nano-banana-2.webp');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'silently discards an older remote download that %s after a newer download starts',
    async (staleOutcome) => {
      mockedRunFalImage.mockResolvedValue({
        url: 'https://v3.fal.media/files/download-race.png',
        mimeType: 'image/png',
      });
      const firstDownload = deferred<Response>();
      const secondDownload = deferred<Response>();
      const fetchMock = vi.fn()
        .mockImplementationOnce(() => firstDownload.promise)
        .mockImplementationOnce(() => secondDownload.promise);
      vi.stubGlobal('fetch', fetchMock);
      const createObjectURL = vi.fn(() => 'blob:current-download');
      const revokeObjectURL = vi.fn();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const toastError = vi.spyOn(toast, 'error');
      renderInterface();

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Download race' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
      await waitFor(() => expect(screen.getByAltText('Generated')).toBeTruthy());
      const downloadButton = screen.getByRole('button', { name: 'Download Image' });
      fireEvent.click(downloadButton);
      fireEvent.click(downloadButton);

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
      const secondSignal = fetchMock.mock.calls[1][1].signal as AbortSignal;
      expect(firstSignal.aborted).toBe(true);
      expect(secondSignal.aborted).toBe(false);

      await act(async () => {
        if (staleOutcome === 'resolve') {
          firstDownload.resolve(new Response(new Blob(['stale'], { type: 'image/png' }), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }));
        } else {
          firstDownload.reject(new Error('stale download fal_id:fal_secret failure'));
        }
        await Promise.resolve();
      });

      expect(createObjectURL).not.toHaveBeenCalled();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      expect(clickSpy).not.toHaveBeenCalled();
      expect(screen.queryByText('Unable to download this image. Please try again.')).toBeNull();
      expect(toastError).not.toHaveBeenCalled();

      await act(async () => {
        secondDownload.resolve(new Response(new Blob(['current'], { type: 'image/png' }), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }));
      });

      await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:current-download');
      expect(screen.queryByText('Unable to download this image. Please try again.')).toBeNull();
      expect(toastError).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['back navigation', 'resolve'],
    ['back navigation', 'reject'],
    ['component unmount', 'resolve'],
    ['component unmount', 'reject'],
  ] as const)(
    'silently discards a remote download that finishes after %s via %s',
    async (exitMode, lateOutcome) => {
      mockedRunFalImage.mockResolvedValue({
        url: 'https://v3.fal.media/files/late-download.png',
        mimeType: 'image/png',
      });
      const download = deferred<Response>();
      const fetchMock = vi.fn<
        (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      >().mockImplementation(() => download.promise);
      vi.stubGlobal('fetch', fetchMock);
      const createObjectURL = vi.fn(() => 'blob:late-download');
      const revokeObjectURL = vi.fn();
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      const toastError = vi.spyOn(toast, 'error');
      const onBack = vi.fn();
      const view = renderInterface(textToImage, { onBack });

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Late download' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
      await waitFor(() => expect(screen.getByAltText('Generated')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Download Image' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal;

      if (exitMode === 'back navigation') {
        fireEvent.click(screen.getByRole('button', { name: '← Back' }));
        expect(onBack).toHaveBeenCalledTimes(1);
      } else {
        view.unmount();
      }
      expect(signal.aborted).toBe(true);

      await act(async () => {
        if (lateOutcome === 'resolve') {
          download.resolve(new Response(new Blob(['late'], { type: 'image/png' }), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }));
        } else {
          download.reject(new Error('late download failure fal_id:fal_secret'));
        }
        await Promise.resolve();
      });

      expect(createObjectURL).not.toHaveBeenCalled();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      expect(clickSpy).not.toHaveBeenCalled();
      expect(screen.queryByText('Unable to download this image. Please try again.')).toBeNull();
      expect(toastError).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['HTTP failure', () => Promise.resolve(new Response('', { status: 503 }))],
    ['network failure', () => Promise.reject(new Error('network includes fal_id:fal_secret'))],
    [
      'invalid MIME',
      () => Promise.resolve(new Response('not an image', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })),
    ],
  ])('reports a stable safe download error for %s', async (_name, downloadResponse) => {
    mockedRunFalImage.mockResolvedValue({
      url: 'https://v3.fal.media/files/download.png',
      mimeType: 'image/png',
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(downloadResponse));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A clean poster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    await waitFor(() => expect(screen.getByAltText('Generated')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Download Image' }));

    await waitFor(() =>
      expect(screen.getByText('Unable to download this image. Please try again.')).toBeTruthy()
    );
    expect(clickSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('fal_id:fal_secret');
  });

  it('downloads a data-URL result without a second network round trip', async () => {
    // The result now goes through the format conversion, so the anchor gets a
    // locally-decoded blob rather than the data URL itself. What must not change
    // is that a data URL is never re-fetched over the network to save it.
    useAppStore.setState({ engine: 'gemini' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        imageData: 'cG5n',
        mimeType: 'image/png',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:data-url-download');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderInterface();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Existing provider image' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    await waitFor(() => expect(screen.getByAltText('Generated')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Download Image' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    const link = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(link.href).toBe('blob:data-url-download');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    // jsdom has no canvas encoder, so conversion falls back to the original PNG
    // — and the filename follows the bytes that were actually saved.
    expect(link.download).toBe('existing-provider-image-gemini-3-pro-image.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/generate', expect.anything());
  });
});

describe('GenerationInterface prompt validation', () => {
  beforeEach(() => {
    useDraftStore.getState().reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockedRunFalImage.mockReset();
    useAppStore.setState({
      engine: 'fal',
      geminiImageModel: DEFAULT_GEMINI_IMAGE_MODEL,
      apiKey: 'gemini_test_key',
      cfAccountId: 'cf_account',
      cfToken: 'cf_token',
      kieApiKey: 'kie_test_key',
      falApiKey: 'fal_id:fal_secret',
    });
  });

  it('marks the empty field, puts the cursor in it, and says so next to it', () => {
    renderInterface();
    const prompt = screen.getByLabelText('Prompt');

    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Please enter a prompt');
    expect(prompt.getAttribute('aria-invalid')).toBe('true');
    expect(prompt.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(prompt);
    // Named by the field, not stranded below the button.
    expect(prompt.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(mockedRunFalImage).not.toHaveBeenCalled();
  });

  it('clears the complaint as soon as the reader types', () => {
    renderInterface();
    const prompt = screen.getByLabelText('Prompt');

    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    expect(screen.getByRole('alert').textContent).toBe('Please enter a prompt');

    fireEvent.change(prompt, { target: { value: 'A' } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(prompt.getAttribute('aria-invalid')).toBeNull();
  });

  it('drops the complaint when the engine changes underneath it', () => {
    renderInterface();

    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    expect(screen.getByRole('alert').textContent).toBe('Please enter a prompt');

    fireEvent.click(screen.getByRole('button', { name: 'Google Gemini' }));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('GenerationInterface aspect ratio default', () => {
  beforeEach(() => {
    useDraftStore.getState().reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAppStore.setState({
      engine: 'gemini',
      geminiImageModel: DEFAULT_GEMINI_IMAGE_MODEL,
      apiKey: 'gemini_test_key',
      cfAccountId: 'cf_account',
      cfToken: 'cf_token',
      kieApiKey: 'kie_test_key',
    });
  });

  it('starts square rather than as a YouTube thumbnail', () => {
    renderInterface();

    // The thumbnail shape is the Viral Thumbnail Generator's job, not the
    // default for the most general mode in the app.
    expect(screen.getByLabelText(/aspect ratio/i)).toHaveValue('1:1');
  });

  it('keeps a shape the user already chose', () => {
    useDraftStore.getState().rememberControlValues({ aspect_ratio: '16:9', resolution: '1K' });

    renderInterface();

    expect(screen.getByLabelText(/aspect ratio/i)).toHaveValue('16:9');
  });
});

describe('GenerationInterface result stack', () => {
  /** Runs one generation that resolves to a distinct one-pixel data URL. */
  const generateOnce = async (body: string) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, imageData: body, mimeType: 'image/png' }),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));
    await waitFor(() =>
      expect(screen.getAllByAltText(/^Generated/).some((el) => el.getAttribute('src')?.endsWith(body))).toBe(true)
    );
  };

  beforeEach(() => {
    useAppStore.setState({ engine: 'gemini', geminiImageModel: DEFAULT_GEMINI_IMAGE_MODEL });
  });

  it('keeps earlier results on screen, newest first', async () => {
    renderInterface();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A quiet ocean' } });

    await generateOnce('Zmlyc3Q=');
    await generateOnce('c2Vjb25k');

    const shown = screen.getAllByAltText(/^Generated/).map((el) => el.getAttribute('src'));
    expect(shown).toHaveLength(2);
    // Newest on top — the second generation must not have replaced the first.
    expect(shown[0]).toBe('data:image/png;base64,c2Vjb25k');
    expect(shown[1]).toBe('data:image/png;base64,Zmlyc3Q=');
  });

  it('drops the oldest once a fifth result arrives', async () => {
    renderInterface();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A quiet ocean' } });

    for (const body of ['YQ==', 'Yg==', 'Yw==', 'ZA==', 'ZQ==']) {
      await generateOnce(body);
    }

    // The dropped card stays mounted through its exit animation, so settle first.
    await waitFor(() => expect(screen.getAllByAltText(/^Generated/)).toHaveLength(4));

    const shown = screen.getAllByAltText(/^Generated/).map((el) => el.getAttribute('src'));
    // Four on screen; the first is still in the library, which is what makes
    // discarding it here safe.
    expect(shown[0]).toBe('data:image/png;base64,ZQ==');
    expect(shown[3]).toBe('data:image/png;base64,Yg==');
    expect(shown).not.toContain('data:image/png;base64,YQ==');
  });

  it('downloads the card that was clicked, not the newest', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:older-card');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    renderInterface();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A quiet ocean' } });
    await generateOnce('Zmlyc3Q=');
    await generateOnce('c2Vjb25k');

    // Every download path here was written against a single ambient result, so
    // this is the regression that matters most.
    const downloads = screen.getAllByRole('button', { name: 'Download Image' });
    fireEvent.click(downloads[1]);

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    // The bytes handed to the anchor are the older card's, not the newest.
    const blob = createObjectURL.mock.calls[0][0];
    expect(await blob.text()).toBe('first');
  });

  it('shows the in-progress slot above existing results', async () => {
    renderInterface();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A quiet ocean' } });
    await generateOnce('Zmlyc3Q=');

    const pending = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Image' }));

    // The earlier result stays visible while the next one runs.
    await waitFor(() => expect(screen.getByText('Creating your masterpiece...')).toBeTruthy());
    expect(screen.getAllByAltText(/^Generated/)).toHaveLength(1);

    await act(async () => {
      pending.resolve({
        ok: true,
        json: async () => ({ success: true, imageData: 'c2Vjb25k', mimeType: 'image/png' }),
      });
    });
    await waitFor(() => expect(screen.getAllByAltText(/^Generated/)).toHaveLength(2));
  });
});

/**
 * The bug: "9:16 (Story/Reels)" was one label for four different results.
 * Runware renders it at 768 × 1344 and Pollinations at 720 × 1280, and only the
 * second is really 9:16 — so the control has to say which engine's answer it is
 * currently offering, per engine and per model.
 */
describe('what the image aspect control promises for the active engine', () => {
  const LEGEND = '“≈” marks a ratio the pixels come close to without being exactly it.';

  const optionsOf = () =>
    [...screen.getByRole('combobox', { name: 'Aspect Ratio' }).querySelectorAll('option')]
      .map((option) => option.textContent);

  beforeEach(() => {
    useDraftStore.getState().reset();
    useAppStore.setState({
      engine: 'gemini',
      geminiImageModel: DEFAULT_GEMINI_IMAGE_MODEL,
      apiKey: 'gemini_test_key',
      runwareApiKey: 'rw_test_key',
      atlasApiKey: 'at_test_key',
      cometApiKey: 'cm_test_key',
    });
  });

  it('names Runware’s pixels and marks the ratios they only round to', () => {
    useAppStore.setState({ engine: 'runware' });
    renderInterface();

    expect(optionsOf()).toContain('1:1 (Square - Instagram Post) · 1024 × 1024');
    expect(optionsOf()).toContain('≈9:16 (Story/Reels) · 768 × 1344');
    expect(optionsOf()).toContain('≈16:9 (YouTube Thumbnail) · 1344 × 768');
    expect(screen.getByRole('combobox', { name: 'Aspect Ratio' })).toHaveAccessibleDescription(LEGEND);
  });

  it('leaves Pollinations unmarked, because its table really is those ratios', () => {
    useAppStore.setState({ engine: 'pollinations' });
    renderInterface();

    expect(optionsOf()).toContain('9:16 (Story/Reels) · 720 × 1280');
    expect(optionsOf()).toContain('16:9 (YouTube Thumbnail) · 1280 × 720');
    expect(optionsOf()).toContain('3:2 (Classic Photo) · 1080 × 720');
    // 1280 × 548 is 0.1% off 21:9 — a rounding, and the only one it has.
    expect(optionsOf()).toContain('≈21:9 (Ultra Wide) · 1280 × 548');
  });

  it('says what Seedream substitutes rather than calling a 16:9 frame nearly 21:9', () => {
    useAppStore.setState({
      engine: 'atlas',
      atlasImageModel: 'bytedance/seedream-v5.0-pro/text-to-image',
    });
    renderInterface();

    expect(optionsOf()).toContain('21:9 (Ultra Wide) · delivers 16:9 · 2048 × 1152');
    expect(optionsOf()).toContain('3:2 (Classic Photo) · delivers ≈4:3 · 1776 × 1328');
    expect(optionsOf()).toContain('9:16 (Story/Reels) · 1152 × 2048');
    expect(optionsOf()).not.toContain('≈21:9 (Ultra Wide) · 2048 × 1152');
  });

  it('gives Atlas’s other models the table those models actually use', () => {
    useAppStore.setState({ engine: 'atlas', atlasImageModel: 'black-forest-labs/flux-schnell' });
    renderInterface();

    expect(optionsOf()).toContain('≈9:16 (Story/Reels) · 768 × 1344');
    expect(optionsOf()).not.toContain('9:16 (Story/Reels) · 1152 × 2048');
  });

  it('names Comet’s pixels, which are exact on 16:9 and a rounding on 4:3', () => {
    useAppStore.setState({ engine: 'comet' });
    renderInterface();

    expect(optionsOf()).toContain('16:9 (YouTube Thumbnail) · 1536 × 864');
    expect(optionsOf()).toContain('9:16 (Story/Reels) · 864 × 1536');
    expect(optionsOf()).toContain('≈4:3 (Standard) · 1152 × 896');
  });

  it('leaves an engine that picks its own dimensions exactly as it was', () => {
    renderInterface();

    expect(optionsOf()).toContain('9:16 (Story/Reels)');
    expect(optionsOf()).toContain('21:9 (Ultra Wide)');
    expect(screen.queryByText(LEGEND)).toBeNull();
  });
});
