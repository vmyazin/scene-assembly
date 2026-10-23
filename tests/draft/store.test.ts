import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeSavedPrompt, useDraftStore } from '../../store/useDraftStore';

const revokeObjectURL = vi.fn();
let created = 0;

function reference(name: string) {
  return { file: new File(['x'], name, { type: 'image/png' }) };
}

describe('useDraftStore', () => {
  beforeEach(() => {
    created = 0;
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:draft-${++created}`),
      revokeObjectURL,
    }));
    // promptScope and promptByScope belong here too: without them a test that
    // ends inside one scope leaks into the next one's first enterPromptScope.
    useDraftStore.setState({
      prompt: '',
      promptScope: null,
      promptByScope: {},
      references: [],
      replaceTarget: null,
      controlValues: {},
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('carries the prompt independent of any workspace', () => {
    useDraftStore.getState().setPrompt('A neon tiger in the rain');
    expect(useDraftStore.getState().prompt).toBe('A neon tiger in the rain');
  });

  it('gives every reference a stable id and its own preview', () => {
    useDraftStore.getState().addReferences([reference('a.png'), reference('b.png')], 4);

    const { references } = useDraftStore.getState();
    expect(references.map((r) => r.file.name)).toEqual(['a.png', 'b.png']);
    expect(new Set(references.map((r) => r.id)).size).toBe(2);
    expect(references.map((r) => r.previewUrl)).toEqual(['blob:draft-1', 'blob:draft-2']);
  });

  it('keeps the newest when a model accepts fewer than were added', () => {
    useDraftStore.getState().addReferences(
      [reference('a.png'), reference('b.png'), reference('c.png')],
      1
    );

    expect(useDraftStore.getState().references.map((r) => r.file.name)).toEqual(['c.png']);
    // The two that no longer fit must not leak their object URLs.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:draft-1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:draft-2');
  });

  it('trims to a stricter ceiling when switching to a single-image model', () => {
    useDraftStore.getState().addReferences([reference('a.png'), reference('b.png')], 4);
    revokeObjectURL.mockClear();

    useDraftStore.getState().limitReferences(1);

    expect(useDraftStore.getState().references.map((r) => r.file.name)).toEqual(['a.png']);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:draft-2');
  });

  it('keeps the leading references, so image 1 stays the subject', () => {
    useDraftStore.getState().addReferences(
      ['subject.png', 'logo.png', 'product.png', 'style.png'].map(reference),
      4
    );

    useDraftStore.getState().limitReferences(3);

    expect(useDraftStore.getState().references.map((r) => r.file.name)).toEqual([
      'subject.png',
      'logo.png',
      'product.png',
    ]);
  });

  it('leaves references alone when the new ceiling is roomier', () => {
    useDraftStore.getState().addReferences([reference('a.png')], 4);
    revokeObjectURL.mockClear();

    useDraftStore.getState().limitReferences(8);

    expect(useDraftStore.getState().references).toHaveLength(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes exactly the removed preview', () => {
    useDraftStore.getState().addReferences([reference('a.png'), reference('b.png')], 4);
    const [first] = useDraftStore.getState().references;
    revokeObjectURL.mockClear();

    useDraftStore.getState().removeReference(first.id);

    expect(useDraftStore.getState().references.map((r) => r.file.name)).toEqual(['b.png']);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:draft-1');
  });

  it('ignores removal of an id it does not hold', () => {
    useDraftStore.getState().addReferences([reference('a.png')], 4);
    revokeObjectURL.mockClear();

    useDraftStore.getState().removeReference('draft-reference-does-not-exist');

    expect(useDraftStore.getState().references).toHaveLength(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('accumulates control values across models rather than replacing them', () => {
    useDraftStore.getState().rememberControlValues({ aspect_ratio: '16:9', seed: 7 });
    useDraftStore.getState().rememberControlValues({ duration: '10' });

    expect(useDraftStore.getState().controlValues).toEqual({
      aspect_ratio: '16:9',
      seed: 7,
      duration: '10',
    });
  });

  describe('prompt scope', () => {
    it('files a prompt away under its own scope rather than losing it', () => {
      useDraftStore.getState().enterPromptScope('image');
      useDraftStore.getState().setPrompt('Keep the exact same attic');

      useDraftStore.getState().enterPromptScope('video');

      // A still-image instruction must not sit in a motion field...
      expect(useDraftStore.getState().prompt).toBe('');
      expect(useDraftStore.getState().promptScope).toBe('video');
    });

    it('restores each side on the round trip', () => {
      useDraftStore.getState().enterPromptScope('image');
      useDraftStore.getState().setPrompt('Keep the exact same attic');
      useDraftStore.getState().enterPromptScope('video');
      useDraftStore.getState().setPrompt('Slow dolly through the attic');

      useDraftStore.getState().enterPromptScope('image');
      expect(useDraftStore.getState().prompt).toBe('Keep the exact same attic');

      useDraftStore.getState().enterPromptScope('video');
      expect(useDraftStore.getState().prompt).toBe('Slow dolly through the attic');
    });

    it('keeps the latest edit on each side, not the first', () => {
      useDraftStore.getState().enterPromptScope('image');
      useDraftStore.getState().setPrompt('First draft');
      useDraftStore.getState().enterPromptScope('video');
      useDraftStore.getState().enterPromptScope('image');
      useDraftStore.getState().setPrompt('Second draft');
      useDraftStore.getState().enterPromptScope('video');

      useDraftStore.getState().enterPromptScope('image');
      expect(useDraftStore.getState().prompt).toBe('Second draft');
    });

    it('is a no-op within one kind, whatever remounts in between', () => {
      // Switching engine, input mode or feature all remount a workspace. None
      // of those cross the boundary, so none may cost the user what they typed.
      useDraftStore.getState().enterPromptScope('video');
      useDraftStore.getState().setPrompt('Slow dolly through the attic');

      useDraftStore.getState().enterPromptScope('video');

      expect(useDraftStore.getState().prompt).toBe('Slow dolly through the attic');
    });

    it('adopts a prompt put there before any workspace claimed the field', () => {
      // "Reuse settings" and the prompt library both write while the picker
      // is open. Filing that under a scope that never existed would hand the
      // workspace it was meant for an empty field.
      useDraftStore.getState().setPrompt('Restored from the library');

      useDraftStore.getState().enterPromptScope('image');

      expect(useDraftStore.getState().prompt).toBe('Restored from the library');
    });

    it('leaves references alone, since carrying a frame across is the useful half', () => {
      useDraftStore.getState().enterPromptScope('image');
      useDraftStore.getState().addReferences([reference('attic.png')], 4);
      useDraftStore.getState().setPrompt('Keep the exact same attic');

      useDraftStore.getState().enterPromptScope('video');

      expect(useDraftStore.getState().references).toHaveLength(1);
      expect(useDraftStore.getState().prompt).toBe('');
    });

    it('forgets both sides on reset', () => {
      useDraftStore.getState().enterPromptScope('image');
      useDraftStore.getState().setPrompt('Keep the exact same attic');
      useDraftStore.getState().enterPromptScope('video');

      useDraftStore.getState().reset();
      useDraftStore.getState().enterPromptScope('image');

      expect(useDraftStore.getState().prompt).toBe('');
      expect(useDraftStore.getState().promptByScope).toEqual({});
    });
  });

  describe('replacing one slot', () => {
    it('swaps the targeted slot in place, leaving the others and the order alone', () => {
      useDraftStore.getState().addReferences([reference('a.png'), reference('b.png')], 2);
      const [first, second] = useDraftStore.getState().references;

      useDraftStore.getState().setReplaceTarget(0);
      useDraftStore.getState().addReferences([reference('c.png')], 2);

      const after = useDraftStore.getState().references;
      expect(after).toHaveLength(2);
      expect(after[0].file.name).toBe('c.png');
      expect(after[1].id).toBe(second.id);
      // The slot's old preview is the store's to release, and only the store's.
      expect(revokeObjectURL).toHaveBeenCalledWith(first.previewUrl);
    });

    it('ignores the limit, since a swap cannot change the count', () => {
      useDraftStore.getState().addReferences([reference('a.png')], 1);

      useDraftStore.getState().setReplaceTarget(0);
      useDraftStore.getState().addReferences([reference('b.png')], 1);

      expect(useDraftStore.getState().references).toHaveLength(1);
      expect(useDraftStore.getState().references[0].file.name).toBe('b.png');
    });

    it('clears the target, so the next ordinary add appends', () => {
      useDraftStore.getState().addReferences([reference('a.png')], 4);
      useDraftStore.getState().setReplaceTarget(0);
      useDraftStore.getState().addReferences([reference('b.png')], 4);

      useDraftStore.getState().addReferences([reference('c.png')], 4);

      expect(useDraftStore.getState().references.map((r) => r.file.name)).toEqual(['b.png', 'c.png']);
    });

    it('appends as usual when the target no longer exists', () => {
      // The slot can be removed while the picker is open.
      useDraftStore.getState().addReferences([reference('a.png')], 4);
      useDraftStore.getState().setReplaceTarget(5);

      useDraftStore.getState().addReferences([reference('b.png')], 4);

      expect(useDraftStore.getState().references.map((r) => r.file.name)).toEqual(['a.png', 'b.png']);
      expect(useDraftStore.getState().replaceTarget).toBeNull();
    });

    it('is forgotten on reset', () => {
      useDraftStore.getState().setReplaceTarget(1);
      useDraftStore.getState().reset();
      expect(useDraftStore.getState().replaceTarget).toBeNull();
    });
  });

  describe('remembering the last prompt', () => {
    const saved = { prompt: 'A neon tiger in the rain', promptScope: 'image' as const, promptByScope: { video: 'Slow push in' } };

    it('brings the saved prompt back on a fresh load', () => {
      const merged = mergeSavedPrompt(saved, useDraftStore.getState());
      expect(merged).toMatchObject(saved);
    });

    it('gives a workspace that claimed its scope first the prompt saved for that scope', () => {
      useDraftStore.getState().enterPromptScope('video');
      const merged = mergeSavedPrompt(saved, useDraftStore.getState());
      expect(merged.prompt).toBe('Slow push in');
      // The image prompt is filed away, ready for the trip back.
      expect(merged.promptByScope.image).toBe('A neon tiger in the rain');
    });

    it('never replaces a prompt written before the saved one arrived', () => {
      useDraftStore.getState().enterPromptScope('image');
      useDraftStore.getState().setPrompt('Restored from the gallery');
      expect(mergeSavedPrompt(saved, useDraftStore.getState()).prompt).toBe('Restored from the gallery');
    });

    it('reads the saved prompt on rehydrate and saves each edit after it', async () => {
      const key = 'scene-assembly-draft-prompt';
      localStorage.setItem(key, JSON.stringify({ state: saved, version: 0 }));

      await useDraftStore.persist.rehydrate();
      expect(useDraftStore.getState().prompt).toBe('A neon tiger in the rain');

      useDraftStore.getState().setPrompt('A neon tiger at dawn');
      expect(JSON.parse(localStorage.getItem(key) ?? '{}').state.prompt).toBe('A neon tiger at dawn');
    });
  });
});
