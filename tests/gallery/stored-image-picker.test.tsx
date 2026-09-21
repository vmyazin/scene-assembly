import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StoredImagePicker from '../../components/StoredImagePicker';
import type { GalleryRecord } from '../../lib/gallery/storage';
import { useDraftStore } from '../../store/useDraftStore';
import { useGalleryStore } from '../../store/useGalleryStore';

const storedImage: GalleryRecord = {
  id: 'stored-image-1',
  kind: 'image',
  createdAt: 1,
  prompt: 'A stored library image',
  slug: 'stored-library-image',
  provider: 'gemini',
  controlValues: {},
  mimeType: 'image/png',
  blob: new Blob(['image'], { type: 'image/png' }),
  bytes: 5,
};

describe('StoredImagePicker', () => {
  beforeEach(() => {
    useDraftStore.getState().reset();
    useGalleryStore.setState({ records: [storedImage], hydrated: true, storageError: null });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:stored-image'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('owns the contextual Library and fills a draft reference before closing', async () => {
    render(<StoredImagePicker referenceLimit={2} />);

    fireEvent.click(screen.getByRole('button', { name: 'From library' }));
    expect(screen.getByRole('dialog', { name: 'Choose an image' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use image' }));

    await waitFor(() => {
      expect(useDraftStore.getState().references).toHaveLength(1);
      expect(screen.queryByRole('dialog', { name: 'Choose an image' })).toBeNull();
    });
    expect(useDraftStore.getState().references[0]?.file.name).toBe('stored-library-image.png');
  });

  it('opens the library overlay on document.body rather than inside the picker', () => {
    const { container } = render(<StoredImagePicker referenceLimit={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'From library' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose an image' });
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });
});
