import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useReferenceIntake } from '@/hooks/useReferenceIntake';
import { useDraftStore } from '@/store/useDraftStore';

vi.mock('@/lib/draft/ingest', () => ({ prepareReferences: vi.fn(async (entries: unknown) => entries) }));
vi.mock('@/lib/gallery/keep-upload', () => ({ keepUploadedImages: vi.fn(async () => undefined) }));

const png = (name: string) => new File(['x'], name, { type: 'image/png' });
const text = (name: string) => new File(['x'], name, { type: 'text/plain' });

function setup(overrides: Partial<Parameters<typeof useReferenceIntake>[0]> = {}) {
  const onError = vi.fn();
  const hook = renderHook(() =>
    useReferenceIntake({
      referenceCount: 0,
      maxImages: 2,
      accept: (file) => file.type.startsWith('image/'),
      unusableMessage: 'Not an image',
      tooManyMessage: 'Too many',
      pasteEnabled: true,
      onError,
      ...overrides,
    })
  );
  return { ...hook, onError };
}

describe('useReferenceIntake', () => {
  let add: ReturnType<typeof vi.fn<(entries: unknown[], limit: number) => void>>;
  beforeEach(() => {
    add = vi.fn<(entries: unknown[], limit: number) => void>();
    useDraftStore.setState({ addReferences: add });
  });

  it('adds usable images to the draft', async () => {
    const { result, onError } = setup();
    await act(() => result.current.addFiles([png('a.png')]));
    expect(onError).toHaveBeenLastCalledWith(null);
    expect(add).toHaveBeenCalledWith([{ file: expect.any(File), sourceLabel: undefined }], 2);
  });

  it('skips unusable files unless asked to refuse the whole batch', async () => {
    const lenient = setup();
    await act(() => lenient.result.current.addFiles([png('a.png'), text('b.txt')]));
    expect(add).toHaveBeenCalledTimes(1);

    const strict = setup({ rejectAnyUnusable: true });
    await act(() => strict.result.current.addFiles([png('a.png'), text('b.txt')]));
    expect(strict.onError).toHaveBeenCalledWith('Not an image');
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('refuses more references than the model takes', async () => {
    const { result, onError } = setup({ referenceCount: 1 });
    await act(() => result.current.addFiles([png('a.png'), png('b.png')]));
    expect(onError).toHaveBeenCalledWith('Too many');
  });

  it('takes pasted images only while paste is enabled', async () => {
    const paste = () => {
      const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { files: [png('p.png')] } });
      document.dispatchEvent(event);
    };

    const { unmount } = setup({ pasteEnabled: false });
    await act(async () => paste());
    expect(add).not.toHaveBeenCalled();
    unmount();

    setup({ pasteEnabled: true });
    await act(async () => paste());
    expect(add).toHaveBeenCalledTimes(1);
  });
});
