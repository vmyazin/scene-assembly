// tests/components/edit-reference-tray.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import EditReferenceTray from '@/components/EditReferenceTray';
import { emptyEditReferenceDraft } from '@/lib/providers/edit-references';

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
});
