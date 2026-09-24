import { create } from 'zustand';
import type { ResultStackItem } from '@/components/ResultStack';

interface ImageResultsState {
  /**
   * Images finished in this tab by the panels that hold their own results
   * (Gemini, fal, Cloudflare, Pollinations and the aggregators), newest first.
   *
   * A store rather than component state because the result feed belongs to
   * the session, not to an engine: switching engine swaps `GenerationInterface`
   * for `KieGenerationWorkspace`, and switching feature remounts it, and either
   * used to take every earlier result off screen. Kie's results stay in
   * `useKieJobsStore`, which already outlives the panel; `useImageResultFeed`
   * merges the two. Memory only, like Kie's jobs — the library is the durable
   * copy of every image.
   */
  items: ResultStackItem[];
  add: (item: Omit<ResultStackItem, 'id'>) => void;
}

/** Monotonic across mounts, so a remounted panel never reissues a React key. */
let nextId = 0;

export const useImageResultsStore = create<ImageResultsState>((set) => ({
  items: [],
  add: (item) => {
    nextId += 1;
    // Stamped on arrival unless the caller knows better: adding is the moment
    // the result finished, and the feed orders by it.
    const now = Date.now();
    set((state) => ({
      items: [{ createdAt: now, finishedAt: now, ...item, id: `result-${nextId}` }, ...state.items],
    }));
  },
}));
