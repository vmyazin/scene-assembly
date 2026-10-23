import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GalleryGrid from '../../components/GalleryGrid';
import { createMemoryGalleryStorage } from '../../lib/gallery/memory-storage';
import type { GalleryRecord } from '../../lib/gallery/storage';
import { useDraftStore } from '../../store/useDraftStore';
import { configureGalleryStorage, useGalleryStore } from '../../store/useGalleryStore';

const { fetchResultBlobMock, extractLastFrameFromBlobMock } = vi.hoisted(() => ({
  fetchResultBlobMock: vi.fn(),
  extractLastFrameFromBlobMock: vi.fn(),
}));

vi.mock('../../lib/gallery/capture', () => ({ fetchResultBlob: fetchResultBlobMock }));
vi.mock('../../lib/video-frame', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/video-frame')>()),
  extractLastFrameFromBlob: extractLastFrameFromBlobMock,
}));

function record(overrides: Partial<GalleryRecord> = {}): GalleryRecord {
  return {
    id: 'record-1',
    kind: 'image',
    createdAt: 1,
    prompt: 'A brass diving bell descending through kelp',
    slug: 'brass-diving-bell',
    provider: 'gemini',
    controlValues: { aspect_ratio: '9:16', resolution: '2K' },
    mimeType: 'image/png',
    blob: new Blob(['png'], { type: 'image/png' }),
    bytes: 3,
    ...overrides,
  };
}

describe('GalleryGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let created = 0;
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:preview-${++created}`),
      revokeObjectURL: vi.fn(),
    }));
    configureGalleryStorage(createMemoryGalleryStorage());
    useGalleryStore.setState({ records: [], hydrated: true, storageError: null });
    useDraftStore.getState().reset();
  });

  it('says so plainly when nothing has been generated yet', () => {
    render(<GalleryGrid />);
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });

  it('sends a kept image into the draft as a reference', async () => {
    useGalleryStore.setState({ records: [record()] });
    render(<GalleryGrid />);

    fireEvent.click(screen.getByRole('button', { name: /Use as reference/ }));

    await waitFor(() => expect(useDraftStore.getState().references).toHaveLength(1));
    const [reference] = useDraftStore.getState().references;
    expect(reference.file.name).toBe('brass-diving-bell.png');
    expect(reference.sourceLabel).toBe('From brass diving bell');
  });

  it('shows only durable images in image-picker mode', () => {
    useGalleryStore.setState({
      records: [
        record(),
        record({
          id: 'video-1',
          kind: 'video',
          slug: 'kelp-dive',
          blob: new Blob(['video'], { type: 'video/mp4' }),
          posterBlob: new Blob(['poster'], { type: 'image/png' }),
        }),
        record({
          id: 'linked-image',
          slug: 'expired-image',
          blob: undefined,
          bytes: 0,
          sourceUrl: 'https://example.com/expired.png',
        }),
      ],
    });

    render(<GalleryGrid mode="pick-image" referenceLimit={2} />);

    expect(screen.getByText('brass diving bell')).toBeInTheDocument();
    expect(screen.queryByText('kelp dive')).toBeNull();
    expect(screen.queryByText('expired image')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Use image' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Pin result' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('has an image-specific empty state when nothing durable can be picked', () => {
    useGalleryStore.setState({
      records: [
        record({
          kind: 'video',
          blob: new Blob(['video'], { type: 'video/mp4' }),
          posterBlob: new Blob(['poster'], { type: 'image/png' }),
        }),
      ],
    });

    render(<GalleryGrid mode="pick-image" referenceLimit={2} />);

    expect(screen.getByText('No stored images yet.')).toBeInTheDocument();
  });

  it('uses the contextual reference limit before closing the image picker', async () => {
    useDraftStore.getState().addReferences(
      [{ file: new File(['old'], 'old-frame.png', { type: 'image/png' }) }],
      14
    );
    useGalleryStore.setState({ records: [record()] });
    const onUsedReference = vi.fn();
    render(
      <GalleryGrid
        mode="pick-image"
        referenceLimit={1}
        onUsedReference={onUsedReference}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use image' }));

    await waitFor(() => expect(onUsedReference).toHaveBeenCalledOnce());
    expect(useDraftStore.getState().references).toHaveLength(1);
    expect(useDraftStore.getState().references[0].file.name).toBe('brass-diving-bell.png');
  });

  it('restores the prompt and controls of a past run', () => {
    useGalleryStore.setState({ records: [record()] });
    render(<GalleryGrid />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reuse settings' }));

    const draft = useDraftStore.getState();
    expect(draft.prompt).toBe('A brass diving bell descending through kelp');
    // Replayed as remembered values, so the carry-over guard still filters them
    // against whatever model is selected next.
    expect(draft.controlValues).toEqual({ aspect_ratio: '9:16', resolution: '2K' });
  });

  it('refuses to use a clip that has no frame yet', async () => {
    useGalleryStore.setState({
      records: [record({ kind: 'video', blob: undefined, bytes: 0, sourceUrl: 'https://v3.fal.media/x.mp4' })],
    });
    render(<GalleryGrid />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use as reference' }));

    await waitFor(() => expect(useDraftStore.getState().references).toHaveLength(0));
  });

  it('keeps one action on the face of a kept clip and the rest in the menu', () => {
    useGalleryStore.setState({
      records: [record({ kind: 'video', mimeType: 'video/mp4', blob: new Blob(['video'], { type: 'video/mp4' }) })],
    });
    render(<GalleryGrid />);

    expect(screen.getByRole('button', { name: /Add to timeline/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use as reference/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Use as reference', 'Reuse settings', 'Download video', 'Remove',
    ]);
  });

  it('removes a record from the menu', async () => {
    useGalleryStore.setState({ records: [record()] });
    render(<GalleryGrid />);

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    await waitFor(() => expect(useGalleryStore.getState().records).toHaveLength(0));
  });

  it('keeps a linked clip with one download, deriving the poster from it', async () => {
    const bytes = new Blob(['video'], { type: 'video/mp4' });
    const poster = new Blob(['frame'], { type: 'image/png' });
    fetchResultBlobMock.mockResolvedValue(bytes);
    extractLastFrameFromBlobMock.mockResolvedValue(poster);
    useGalleryStore.setState({
      records: [record({ kind: 'video', blob: undefined, bytes: 0, sourceUrl: 'https://v3.fal.media/x.mp4' })],
    });
    render(<GalleryGrid />);

    fireEvent.click(screen.getByRole('button', { name: /Keep/ }));

    await waitFor(() => expect(useGalleryStore.getState().records[0].blob).toBe(bytes));
    expect(fetchResultBlobMock).toHaveBeenCalledOnce();
    expect(extractLastFrameFromBlobMock).toHaveBeenCalledWith(bytes);
    expect(useGalleryStore.getState().records[0].posterBlob).toBe(poster);
    expect(useGalleryStore.getState().records[0].pinned).toBe(true);
  });

  it('offers no Keep action once the bytes are already held', () => {
    useGalleryStore.setState({ records: [record()] });
    render(<GalleryGrid />);
    expect(screen.queryByRole('button', { name: /^Keep/ })).toBeNull();
  });

  it('marks a record whose link died and was never kept', () => {
    useGalleryStore.setState({
      records: [record({ kind: 'image', blob: undefined, bytes: 0, sourceUrl: undefined })],
    });
    render(<GalleryGrid />);

    expect(screen.getByText(/provider link has expired/)).toBeInTheDocument();
  });

  it('pins and unpins a record', async () => {
    useGalleryStore.setState({ records: [record()] });
    render(<GalleryGrid />);

    fireEvent.click(screen.getByRole('button', { name: 'Pin result' }));

    await waitFor(() => expect(useGalleryStore.getState().records[0].pinned).toBe(true));
  });
});
