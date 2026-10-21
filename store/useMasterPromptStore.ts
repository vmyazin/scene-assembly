import { create } from 'zustand';

import { defaultMasterPrompt, type MasterPrompt } from '@/lib/image/feature-prompt';

/**
 * Master prompt edits, per image mode. Deliberately not persisted: an edit is
 * an experiment for this session, and a reload returns every mode to its
 * built-in instruction rather than quietly rewriting later runs.
 */
interface MasterPromptState {
  overrides: Partial<Record<string, Partial<MasterPrompt>>>;
  setOverride: (featureId: string, field: keyof MasterPrompt, value: string) => void;
  resetOverride: (featureId: string) => void;
}

export const useMasterPromptStore = create<MasterPromptState>((set) => ({
  overrides: {},
  setOverride: (featureId, field, value) =>
    set((state) => ({
      overrides: {
        ...state.overrides,
        [featureId]: { ...state.overrides[featureId], [field]: value },
      },
    })),
  resetOverride: (featureId) =>
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[featureId];
      return { overrides };
    }),
}));

/** The built-in master prompt with this session's edits laid over it. */
export function resolveMasterPrompt(
  featureId: string,
  imageCount: number,
  override: Partial<MasterPrompt> | undefined,
): MasterPrompt {
  return { ...defaultMasterPrompt(featureId, imageCount), ...override };
}
