// tests/components/edit-reference-tray.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EditReferenceTray from '@/components/EditReferenceTray';
import { emptyEditReferenceDraft, type EditReferenceDraft } from '@/lib/providers/edit-references';
import type { EditReferenceSpec } from '@/lib/providers/types';

afterEach(cleanup);

describe('EditReferenceTray', () => {
  it('shows only the reference kinds the model publishes', () => {
    const { rerender } = render(
      <EditReferenceTray spec={{ images: { max: 4, wire: 'image_urls' }, elements: { minAngles: 1, maxAngles: 3, combinedMax: 4 } }} draft={emptyEditReferenceDraft()} onChange={() => undefined} fileCap={16} />
    );
    expect(screen.getByRole('heading', { name: 'Elements' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Guidance frames' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'People' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Lighting sphere' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Driving audio' })).toBeNull();

    rerender(<EditReferenceTray spec={{ keyframes: { max: 64, startImage: true } }} draft={emptyEditReferenceDraft()} onChange={() => undefined} fileCap={16} />);
    expect(screen.getByRole('heading', { name: 'Guidance frames' })).toBeInTheDocument();
    expect(screen.getByLabelText('Start frame')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elements' })).toBeNull();

    rerender(<EditReferenceTray spec={{ persons: { min: 1, max: 4 }, prompt: 'optional' }} draft={emptyEditReferenceDraft()} onChange={() => undefined} fileCap={4} />);
    expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument();

    rerender(<EditReferenceTray spec={{ litSphere: true, prompt: 'absent' }} draft={emptyEditReferenceDraft()} onChange={() => undefined} fileCap={1} />);
    expect(screen.getByRole('heading', { name: 'Lighting sphere' })).toBeInTheDocument();

    rerender(<EditReferenceTray spec={{ images: { max: 3, wire: 'images' }, audio: true }} draft={emptyEditReferenceDraft()} onChange={() => undefined} fileCap={3} />);
    expect(screen.getByRole('heading', { name: 'Driving audio' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elements' })).toBeNull();
  });

  it('refuses driving audio that is not an MP3 or WAV under 15 MB', () => {
    const spec: EditReferenceSpec = {
      images: { max: 3, wire: 'images' },
      audio: true,
      audioLimit: {
        max: 1, minSeconds: 2, maxSeconds: 30, maxTotalSeconds: 30, maxBytes: 15_000_000,
        accept: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav'],
        formatsLabel: 'MP3 or WAV', token: 'Audio',
      },
    };
    render(<EditReferenceTray spec={spec} draft={emptyEditReferenceDraft()} onChange={() => undefined} fileCap={3} />);
    expect(screen.getByText(/MP3 or WAV, 2–30 seconds, up to 15 MB/)).toBeInTheDocument();
    const input = screen.getByLabelText('Add audio');
    fireEvent.change(input, { target: { files: [new File(['x'], 'clip.ogg', { type: 'audio/ogg' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/MP3 or WAV/);
  });

  it('pins each image from the catalog timestamp bounds', () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:coat', revokeObjectURL: () => undefined });
    const spec: EditReferenceSpec = { images: { max: 5, wire: 'images' } };
    const draft: EditReferenceDraft = {
      ...emptyEditReferenceDraft(),
      images: [{ id: 'coat', file: new File(['png'], 'coat.png', { type: 'image/png' }), previewUrl: 'blob:coat' }],
    };
    const onAnchorChange = vi.fn();
    render(
      <EditReferenceTray
        spec={spec}
        draft={draft}
        onChange={() => undefined}
        fileCap={5}
        promptSyntax="image-index"
        frameAnchorLimits={{ min: 0, max: 30, step: 0.01 }}
        anchors={{ coat: { choice: 'timestamp', timestamp: '1.25' } }}
        onAnchorChange={onAnchorChange}
      />,
    );
    expect(screen.getByText(/Pin each image/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Anchor for image 1' }), { target: { value: 'first' } });
    expect(onAnchorChange).toHaveBeenCalledWith('coat', { choice: 'first', timestamp: '1.25' });
    expect(screen.getByRole('spinbutton', { name: 'Timestamp for image 1' })).toHaveAttribute('max', '30');
    expect(screen.getByRole('spinbutton', { name: 'Timestamp for image 1' })).toHaveAttribute('step', '0.01');
    vi.unstubAllGlobals();
  });
});
