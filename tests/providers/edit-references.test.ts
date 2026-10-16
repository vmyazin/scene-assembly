// tests/providers/edit-references.test.ts
import { describe, expect, it } from 'vitest';
import {
  editReferenceError,
  materializeEditReferences,
  packEditReferences,
  parseEditReferencePlan,
  type EditReferenceDraft,
} from '@/lib/providers/edit-references';
import type { EditReferenceSpec } from '@/lib/providers/types';

const kling: EditReferenceSpec = {
  images: { max: 4, wire: 'image_urls' },
  elements: { minAngles: 1, maxAngles: 3, combinedMax: 4 },
  shotTypeCustomize: true,
};

function still(name: string): EditReferenceDraft['images'][number] {
  return { id: name, file: new File(['x'], name, { type: 'image/png' }), previewUrl: `blob:${name}` };
}

describe('edit references', () => {
  it('refuses images and elements past the combined cap, and an element without angles', () => {
    const urls = ['a', 'b', 'c', 'd', 'e'];
    expect(editReferenceError(kling, materializeEditReferences(kling, urls, {
      images: [0, 1, 2, 3],
      elements: [{ frontal: 4, angles: [0] }],
    }))).toMatch(/at most 4/);
    expect(editReferenceError(kling, { elements: [{ frontal: 'front', angles: [] }] })).toMatch(/front view/);
  });

  it('keeps keyframes exclusive with a start frame and unique indexes', () => {
    const spec: EditReferenceSpec = { keyframes: { max: 64, startImage: true } };
    expect(editReferenceError(spec, { startImage: 'start', keyframes: [{ url: 'a', index: 1 }] })).toMatch(/cannot be sent together/);
    expect(editReferenceError(spec, { keyframes: [{ url: 'a', index: 2 }, { url: 'b', index: 2 }] })).toMatch(/unique/);
    expect(editReferenceError(spec, { keyframes: [{ url: 'a', index: 0 }, { url: 'b', index: 8 }] })).toBeNull();
  });

  it('requires one lighting sphere and one to four person photos', () => {
    expect(editReferenceError({ litSphere: true, prompt: 'absent' }, {})).toMatch(/lighting sphere/);
    expect(editReferenceError({ litSphere: true }, { litSphere: 'sphere' })).toBeNull();
    expect(editReferenceError({ persons: { min: 1, max: 4 }, prompt: 'optional' }, { persons: [] })).toMatch(/one per person/);
    expect(editReferenceError({ persons: { min: 1, max: 4 } }, { persons: ['a', 'b', 'c', 'd', 'e'] })).toMatch(/one per person/);
    expect(editReferenceError({ persons: { min: 1, max: 4 } }, { persons: ['a'] })).toBeNull();
  });

  it('requires every reference index exactly once', () => {
    expect(() => parseEditReferencePlan({ images: [0], elements: [{ frontal: 0, angles: [1] }] }, 2)).toThrow(/exactly one/);
    expect(parseEditReferencePlan({ images: [1], elements: [{ frontal: 0, angles: [2] }] }, 3)).toEqual({
      images: [1],
      elements: [{ frontal: 0, angles: [2] }],
    });
  });

  it('packs a frontal image and its angles into reference order', () => {
    const draft: EditReferenceDraft = {
      ...{ images: [still('ref.png')], elements: [], guide: 'start' as const, startImage: null, keyframes: [], persons: [], litSphere: null, audio: null },
      elements: [{ id: 'el', frontal: still('front.png'), angles: [still('side.png')] }],
    };
    const packed = packEditReferences(draft, kling);
    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    expect(packed.packed.files.map((file) => file.name)).toEqual(['ref.png', 'front.png', 'side.png']);
    expect(packed.packed.plan).toEqual({ images: [0], elements: [{ frontal: 1, angles: [2] }] });
  });
});
