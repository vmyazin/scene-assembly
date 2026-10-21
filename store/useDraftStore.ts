import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { DraftValue } from '@/lib/draft/carry-over';
import { measureImageUrl } from '@/lib/draft/reference-dimensions';

export interface DraftReference {
  /** Stable across provider switches, so React keys and removal survive a remount. */
  id: string;
  file: File;
  previewUrl: string;
  /** Present when the still was taken from a video rather than uploaded as-is. */
  sourceLabel?: string;
  /**
   * Natural pixel size, measured asynchronously after the reference is added.
   * Absent until the image decodes, and stays absent if it never does — the
   * size-matching effects treat that as "nothing to match against".
   */
  width?: number;
  height?: number;
}

export interface DraftReferenceInput {
  file: File;
  sourceLabel?: string;
}

/** Whether the prompt on screen is describing a still or a motion. */
export type PromptScope = 'image' | 'video';

interface DraftState {
  /**
   * What the user has typed and chosen, independent of which provider or mode
   * is on screen. Only the prompt fields are persisted, so a reload brings the
   * last prompt back; references and control values stay session-local because
   * File handles and object URLs do not survive serialization.
   */
  prompt: string;
  /**
   * Which kind of workspace the current prompt was written in.
   *
   * References are shared across every workspace on purpose - carrying a
   * reference image into the video tab as its first frame is the useful half of
   * this store. A prompt is not like that: "Keep the exact same attic, the same
   * camera angle" is a still-image instruction, and sitting unnoticed in a
   * motion field it silently degrades the clip.
   */
  promptScope: PromptScope | null;
  /**
   * What each side was last left holding. Switching tabs files the current
   * prompt away under its own scope and brings back whatever that side had, so
   * a round trip to the video page and back returns the image prompt intact.
   */
  promptByScope: Partial<Record<PromptScope, string>>;
  references: DraftReference[];
  /** Last value seen per control key, replayed onto whatever model comes next. */
  controlValues: Record<string, DraftValue>;
  setPrompt: (prompt: string) => void;
  /**
   * Claim the prompt field for one kind of workspace: file the outgoing prompt
   * under the scope that wrote it and restore this scope's own. A no-op within
   * a kind, so switching engine, input mode or feature costs nothing.
   */
  enterPromptScope: (scope: PromptScope) => void;
  /**
   * Appends up to `limit` total, dropping and revoking any that no longer fit -
   * unless a replacement slot is pending, in which case the first entry takes
   * that slot and the limit does not apply.
   */
  addReferences: (entries: DraftReferenceInput[], limit: number) => void;
  /**
   * The slot the next picked reference should take over, rather than being
   * appended.
   *
   * A store field rather than an argument threaded through the picker: the pick
   * happens four components away, inside whichever of the two library grids the
   * user is looking at, and both already call `addReferences`. Routing an index
   * through `LibraryOverlay`, `GalleryGrid`, `AccountLibrary` and
   * `CloudAssetGrid` would touch every one of them to say something only the
   * slot that opened the picker knows.
   */
  replaceTarget: number | null;
  setReplaceTarget: (index: number | null) => void;
  /**
   * Trims to a new model's ceiling, e.g. moving from a 3-image to a 1-image model.
   * Keeps the leading references: slot order carries meaning (the thumbnail
   * subject, @Image1, the first frame), and a model switch picks nothing new.
   */
  limitReferences: (limit: number) => void;
  /** Moves one reference to another slot; order is meaningful for first/last frames. */
  reorderReference: (from: number, to: number) => void;
  removeReference: (id: string) => void;
  clearReferences: () => void;
  rememberControlValues: (values: Record<string, DraftValue>) => void;
  reset: () => void;
}

let nextReferenceId = 0;

function createReference({ file, sourceLabel }: DraftReferenceInput): DraftReference {
  nextReferenceId += 1;
  return {
    id: `draft-reference-${nextReferenceId}`,
    file,
    sourceLabel,
    previewUrl: URL.createObjectURL(file),
  };
}

/** The store owns every object URL it hands out, so only it may revoke one. */
function release(references: DraftReference[]) {
  for (const reference of references) URL.revokeObjectURL(reference.previewUrl);
}

const STORAGE_KEY = 'scene-assembly-draft-prompt';

type PersistedPrompt = Pick<DraftState, 'prompt' | 'promptScope' | 'promptByScope'>;

/**
 * Lays the saved prompt under whatever this session has already done.
 *
 * Hydration is deferred, so a workspace may have claimed its scope - or a
 * gallery restore may have written a prompt - before the saved one arrives.
 * Something already in the field wins; an empty field takes the saved prompt
 * for the scope on screen, so last session's video prompt never lands in the
 * image workspace.
 */
export function mergeSavedPrompt(saved: PersistedPrompt | undefined, current: DraftState): DraftState {
  if (!saved) return current;
  if (current.promptScope === null && !current.prompt) return { ...current, ...saved };
  // A prompt saved before any workspace claimed it belongs to whichever opens.
  const savedScope = saved.promptScope ?? current.promptScope;
  const filed = { ...saved.promptByScope, ...(savedScope ? { [savedScope]: saved.prompt } : {}) };
  const promptByScope = { ...filed, ...current.promptByScope };
  if (current.prompt || current.promptScope === null) return { ...current, promptByScope };
  return { ...current, prompt: filed[current.promptScope] ?? '', promptByScope };
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      prompt: '',
      promptScope: null,
      promptByScope: {},
      references: [],
      replaceTarget: null,
      controlValues: {},

      setPrompt: (prompt) => set({ prompt }),

      setReplaceTarget: (index) => set({ replaceTarget: index }),

      enterPromptScope: (scope) =>
        set((state) => {
          if (state.promptScope === scope) return {};
          // Nothing has claimed the field yet, so whatever is in it was put there
          // for the workspace now opening — a gallery restore or a prompt inserted
          // from the library. Adopt it rather than file it under a scope that never
          // existed and hand the user an empty field.
          if (state.promptScope === null) return { promptScope: scope };
          return {
            promptScope: scope,
            promptByScope: { ...state.promptByScope, [state.promptScope]: state.prompt },
            prompt: state.promptByScope[scope] ?? '',
          };
        }),

      addReferences: (entries, limit) => {
        const created = entries.map(createReference);
        for (const reference of created) {
          void measureImageUrl(reference.previewUrl).then((dimensions) => {
            if (!dimensions) return;
            // The reference may have been dropped or trimmed while decoding.
            set((state) => ({
              references: state.references.map((candidate) =>
                candidate.id === reference.id ? { ...candidate, ...dimensions } : candidate
              ),
            }));
          });
        }
        // Swapping one slot, not adding to the set: the pending target takes the
        // first pick and the limit is irrelevant, since the count cannot change.
        // Cleared either way, so a cancelled pick cannot leak into the next add.
        const { replaceTarget } = get();
        if (replaceTarget !== null) {
          const next = [...get().references];
          if (created.length > 0 && replaceTarget >= 0 && replaceTarget < next.length) {
            release([next[replaceTarget]]);
            next[replaceTarget] = created[0];
            // Anything past the first has nowhere to go in a swap.
            release(created.slice(1));
            set({ references: next, replaceTarget: null });
            return;
          }
          set({ replaceTarget: null });
        }

        const combined = [...get().references, ...created];
        if (combined.length <= limit) {
          set({ references: combined });
          return;
        }
        // Keep the most recent, since the newest pick is the one just asked for.
        const kept = combined.slice(combined.length - limit);
        release(combined.filter((reference) => !kept.includes(reference)));
        set({ references: kept });
      },

      limitReferences: (limit) => {
        const { references } = get();
        if (references.length <= limit) return;
        const kept = references.slice(0, limit);
        release(references.filter((reference) => !kept.includes(reference)));
        set({ references: kept });
      },

      reorderReference: (from, to) => {
        const { references } = get();
        const isInRange = (index: number) => Number.isInteger(index) && index >= 0 && index < references.length;
        if (from === to || !isInRange(from) || !isInRange(to)) return;
        const next = [...references];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        set({ references: next });
      },

      removeReference: (id) => {
        const { references } = get();
        const removed = references.filter((reference) => reference.id === id);
        if (removed.length === 0) return;
        release(removed);
        set({ references: references.filter((reference) => reference.id !== id) });
      },

      clearReferences: () => {
        release(get().references);
        set({ references: [] });
      },

      rememberControlValues: (values) =>
        set((state) => ({ controlValues: { ...state.controlValues, ...values } })),

      reset: () => {
        release(get().references);
        set({
          prompt: '',
          promptScope: null,
          promptByScope: {},
          references: [],
          replaceTarget: null,
          controlValues: {},
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => ({
        getItem: (name) => localStorage.getItem(name),
        // Every set writes, and a workspace claims its scope on mount, which can
        // come before the header's rehydrate. Writing then would replace the
        // saved prompt with an empty one before it was ever read.
        setItem: (name, value) => {
          if (useDraftStore.persist.hasHydrated()) localStorage.setItem(name, value);
        },
        removeItem: (name) => localStorage.removeItem(name),
      })),
      partialize: (state): PersistedPrompt => ({
        prompt: state.prompt,
        promptScope: state.promptScope,
        promptByScope: state.promptByScope,
      }),
      merge: (saved, current) => mergeSavedPrompt(saved as PersistedPrompt | undefined, current),
      // Same deferred hydration as useAppStore: kicked from StudioHeader's mount
      // effect so the server and first client render agree.
      skipHydration: true,
    }
  )
);
