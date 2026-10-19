// tests/store/gemini-video-model-migration.test.ts
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_GEMINI_VIDEO_MODEL, RETIRED_GEMINI_VIDEO_MODEL_ID } from '../../lib/engines/gemini-video-catalog';
import { useAppStore } from '../../store/useAppStore';

const STORAGE_KEY = 'scene-assembly-store';

/**
 * Veo 3.1 Lite shuts down on 2026-10-22. A blob written before Omni was the
 * catalog default still names that preview id, and zustand would keep sending
 * it. The version bump rewrites any stored id the catalog no longer lists.
 */
describe('a stored Gemini video model migrates to Omni', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it('maps the shut-down preview id onto Omni', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { geminiVideoModel: RETIRED_GEMINI_VIDEO_MODEL_ID, apiKey: 'k' }, version: 2 })
    );

    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().geminiVideoModel).toBe(DEFAULT_GEMINI_VIDEO_MODEL);
    expect(useAppStore.getState().apiKey).toBe('k');
  });

  it('leaves a stored Omni id alone', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { geminiVideoModel: DEFAULT_GEMINI_VIDEO_MODEL }, version: 2 })
    );

    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().geminiVideoModel).toBe(DEFAULT_GEMINI_VIDEO_MODEL);
  });
});
