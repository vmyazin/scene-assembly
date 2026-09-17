import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderWorkspace(props: Partial<Parameters<typeof ProviderVideoWorkspace>[0]> = {}) {
  const onOpenConnections = vi.fn();
  render(
    <ProviderVideoWorkspace
      provider="runware"
      label="Runware"
      inputMode="text"
      onBack={() => undefined}
      onOpenConnections={onOpenConnections}
      {...props}
    />
  );
  return { onOpenConnections };
}

describe('ProviderVideoWorkspace', () => {
  beforeEach(() => {
    useProviderJobsStore.getState().clearJobs();
    useDraftStore.setState({ prompt: '', references: [], controlValues: {} });
    useAppStore.setState({ runwareApiKey: '', runwareVideoModel: 'lightricks:ltx@2.5-fast' });
  });

  it('carries the header, model, prompt and result panels the other workspaces have', () => {
    renderWorkspace();

    expect(screen.getByRole('button', { name: '← Back' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Text to video' })).toBeInTheDocument();
    // Unkeyed, the not-connected callout owns the single call to action; the
    // header carries only the connected-state status button.
    expect(screen.getByRole('button', { name: 'Connect key' })).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Model' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search compatible models')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gen Example/ })).toBeInTheDocument();
    expect(screen.getByText('Your generated video will appear here.')).toBeInTheDocument();
  });

  it('starts the prompt at two rows with the shared expansion cap', () => {
    renderWorkspace();
    const prompt = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;

    expect(prompt.rows).toBe(2);
    expect(prompt).toHaveClass('max-h-[16.25rem]', 'overflow-y-auto', 'resize-none');
  });

  it('places the prompt card in the result column immediately before result', () => {
    renderWorkspace();

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
    renderWorkspace({ inputMode: 'image' });

    expect(screen.getByRole('button', { name: 'From library' })).toBeInTheDocument();
  });

  it('offers only the controls the selected model publishes', () => {
    renderWorkspace();

    // LTX-2.5 Fast: eight lengths, and every tier in both orientations.
    expect([...screen.getByRole('combobox', { name: 'Duration' }).querySelectorAll('option')].map((o) => o.textContent))
      .toEqual(['6 seconds', '8 seconds', '10 seconds', '12 seconds', '14 seconds', '16 seconds', '18 seconds', '20 seconds']);
    // Every LTX tier is exactly the ratio it names, so the pixels appear and
    // nothing is marked — and the control says nothing it would have to explain.
    const size = screen.getByRole('combobox', { name: /Output size/ });
    expect([...size.querySelectorAll('option')].map((o) => o.textContent))
      .toEqual([
        '720p · 16:9 · 1280 × 720',
        '720p · 9:16 · 720 × 1280',
        '1080p · 16:9 · 1920 × 1080',
        '1080p · 9:16 · 1080 × 1920',
        '2K · 16:9 · 2560 × 1440',
        '2K · 9:16 · 1440 × 2560',
        '4K · 16:9 · 3840 × 2160',
        '4K · 9:16 · 2160 × 3840',
      ]);
    expect(size).toHaveAccessibleDescription('Only the combinations this model publishes.');
  });

  /**
   * Seedance publishes "480p · 9:16" as 496 × 864, which is 2% off 9:16. The
   * option has to say so. What it *submits* is still the bare label — the rate
   * table, `resolveSize` and the carry-over rule all key off it, and
   * `tests/account/execution.test.tsx` holds that end.
   */
  it('marks a size whose pixels only approximate the ratio it names', () => {
    useAppStore.setState({ runwareVideoModel: 'bytedance:seedance@2.0-mini' });
    renderWorkspace();

    const size = screen.getByRole('combobox', { name: /Output size/ });
    const options = [...size.querySelectorAll('option')].map((o) => o.textContent);

    expect(options).toContain('480p · ≈9:16 · 496 × 864');
    expect(options).toContain('720p · 9:16 · 720 × 1280');
    expect(options).toContain('720p · 21:9 · 1470 × 630');
    expect(size).toHaveAccessibleDescription(
      'Only the combinations this model publishes. “≈” marks a ratio the pixels come close to without being exactly it.'
    );
  });

  it('sends you to connections instead of spending a request without a key', () => {
    const { onOpenConnections } = renderWorkspace();
    useDraftStore.setState({ prompt: 'a drifting nebula' });

    fireEvent.click(screen.getByRole('button', { name: /Generate video/ }));

    expect(onOpenConnections).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Connect your Runware key');
  });

  describe('automatic retry after a transient failure', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    const videoCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.filter((call) => call[0] === '/api/providers/video').length;

    it('counts the failed submission down, sends it again, and can be called off', async () => {
      vi.useFakeTimers();
      // A fresh Response per call: a body can only be read once, and the retry
      // reads it again.
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ success: false, error: 'Runware is temporarily unavailable.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      useAppStore.setState({ runwareApiKey: 'rw_test_key' });
      renderWorkspace();
      fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'a drifting nebula' } });

      fireEvent.click(screen.getByRole('button', { name: /Generate video/ }));

      await vi.waitFor(() =>
        expect(screen.getByText(/Retrying in 10s · attempt 1 of 5/)).toBeInTheDocument()
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await vi.waitFor(() => expect(videoCalls(fetchMock)).toBe(2));

      await vi.waitFor(() => expect(screen.getByText(/attempt 2 of 5/)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Cancel automatic retry' }));
      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(videoCalls(fetchMock)).toBe(2);
      expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
    });

    it('never retries a failure that would fail the same way again', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ success: false, error: 'Your Runware key is invalid.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      useAppStore.setState({ runwareApiKey: 'rw_test_key' });
      renderWorkspace();
      fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'a drifting nebula' } });

      fireEvent.click(screen.getByRole('button', { name: /Generate video/ }));

      await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('key is invalid'));
      expect(screen.queryByText(/Retrying in/)).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(videoCalls(fetchMock)).toBe(1);
    });
  });

  it('shares the draft prompt with the other workspaces', () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'a slow push-in' } });

    expect(useDraftStore.getState().prompt).toBe('a slow push-in');
  });

  it('filters the model list from the search box', () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('Search compatible models'), { target: { value: 'pixverse' } });

    const options = within(screen.getByRole('listbox', { name: 'Model' })).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAccessibleName('PixVerse V5 Fast');
  });
});
