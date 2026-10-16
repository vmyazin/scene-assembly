import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ResultActions from '@/components/ResultActions';
import { useDraftStore } from '@/store/useDraftStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';

vi.mock('@/lib/draft/ingest', () => ({ prepareReferences: vi.fn(async (entries) => entries) }));
vi.mock('@/lib/video-frame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/video-frame')>();
  return { ...actual, extractLastFrame: vi.fn(async () => new Blob(['frame'], { type: 'image/png' })) };
});

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) } }));

/**
 * The behaviour issue 03 is about: a finished result is no longer a dead end.
 * Before this row, reusing one meant generate -> open Library -> pick the
 * source tab -> find the item -> Use image, once per handoff.
 */
describe('ResultActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDraftStore.getState().reset();
    useSeedFrameStore.getState().clearSeedFrame();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fixture') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }),
    })));
  });

  it('puts a finished image into the draft without opening the Library', async () => {
    render(<ResultActions kind="image" src="https://fixture.test/a.png" filenameBase="rooftop" />);

    fireEvent.click(screen.getByRole('button', { name: 'Use as reference' }));

    await waitFor(() => expect(useDraftStore.getState().references).toHaveLength(1));
    expect(useDraftStore.getState().references[0].sourceLabel).toBe('From rooftop');
  });

  it('seeds the frame tray and moves the user to where it is claimed', async () => {
    const onUseAsFirstFrame = vi.fn();
    render(
      <ResultActions kind="image" src="https://fixture.test/a.png" filenameBase="rooftop"
        onUseAsFirstFrame={onUseAsFirstFrame} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use as first frame' }));

    await waitFor(() => expect(onUseAsFirstFrame).toHaveBeenCalled());
    expect(useSeedFrameStore.getState().seed?.file.name).toBe('rooftop.png');
  });

  it('turns the reference action into an edit handoff where no reference slot is shown', async () => {
    // Text-to-image has no tray: "Added as a reference" there confirmed
    // something the user could not see. The handoff opens editing instead,
    // with the result as the one source, displacing a stale leftover.
    useDraftStore.getState().addReferences([{ file: new File(['old'], 'old.png', { type: 'image/png' }), sourceLabel: 'Old' }], 8);
    const onEditImage = vi.fn();
    render(<ResultActions kind="image" src="https://fixture.test/a.png" filenameBase="rooftop" onEditImage={onEditImage} />);

    expect(screen.queryByRole('button', { name: 'Use as reference' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit this image' }));

    await waitFor(() => expect(onEditImage).toHaveBeenCalled());
    const references = useDraftStore.getState().references;
    expect(references).toHaveLength(1);
    expect(references[0].sourceLabel).toBe('From rooftop');
  });

  it('withdraws an action whose destination the host cannot reach', () => {
    // Not a disabled button: a panel with nowhere to send a first frame should
    // not advertise the action at all.
    render(<ResultActions kind="image" src="https://fixture.test/a.png" filenameBase="rooftop" />);

    expect(screen.queryByRole('button', { name: 'Use as first frame' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to timeline' })).toBeNull();
  });

  it('offers a cut only for a clip, never for a still', () => {
    const onAddToTimeline = vi.fn();
    const { rerender } = render(
      <ResultActions kind="video" src="https://fixture.test/c.mp4" filenameBase="clip"
        onAddToTimeline={onAddToTimeline} />
    );
    expect(screen.getByRole('button', { name: 'Add to timeline' })).toBeInTheDocument();

    rerender(
      <ResultActions kind="image" src="https://fixture.test/a.png" filenameBase="still"
        onAddToTimeline={onAddToTimeline} />
    );
    expect(screen.queryByRole('button', { name: 'Add to timeline' })).toBeNull();
  });

  it('resolves the bytes once across two actions on the same result', async () => {
    const onUseAsFirstFrame = vi.fn();
    render(
      <ResultActions kind="image" src="https://fixture.test/a.png" filenameBase="rooftop"
        onUseAsFirstFrame={onUseAsFirstFrame} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use as reference' }));
    await waitFor(() => expect(useDraftStore.getState().references).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Use as first frame' }));
    await waitFor(() => expect(onUseAsFirstFrame).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a failure in a toast and leaves the draft untouched', async () => {
    // An inline alert above a scrolled panel is invisible when it is written,
    // which reads as a button that does nothing.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, blob: async () => new Blob() })));
    render(<ResultActions kind="image" src="https://fixture.test/a.png" filenameBase="rooftop" />);

    fireEvent.click(screen.getByRole('button', { name: 'Use as reference' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('This result is no longer available.'));
    expect(useDraftStore.getState().references).toHaveLength(0);
  });
});
