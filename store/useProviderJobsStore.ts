// store/useProviderJobsStore.ts
import { create } from 'zustand';

import type { ProviderId, ProviderMode, TaskState } from '@/lib/providers/types';

export interface ProviderJob {
  /** Local id, so a job is addressable before the provider answers. */
  id: string;
  provider: ProviderId;
  taskId?: string;
  modelId: string;
  prompt: string;
  /** Which shape of input produced it: prompt, one image, or first-and-last. */
  inputMode: ProviderMode;
  sourceVideoId?: string;
  state: TaskState;
  progress?: number;
  urls: string[];
  cost?: number;
  /** Seedance preview id, present once the draft render succeeds. */
  draftId?: string;
  error?: string;
  /** LLM-derived filename slug for downloads; absent until the model answers. */
  slug?: string;
  /** Controls this ran with, snapshotted so a past run can be read back. */
  controlValues?: Record<string, string | number | boolean>;
  createdAt: number;
  updatedAt: number;
  pollAttempt: number;
}

/** What a caller supplies; the store stamps the rest. */
export type NewProviderJob = Omit<ProviderJob, 'id' | 'createdAt' | 'updatedAt' | 'pollAttempt'>;

interface ProviderJobsState {
  /**
   * Not persisted, matching the fal and Kie stores: provider URLs expire within
   * days, so a job restored from localStorage would mostly be a dead link. The
   * gallery is what makes a result durable.
   */
  jobs: ProviderJob[];
  /**
   * Files a new job and returns its id. Ids and timestamps are minted here
   * rather than in the component: `Date.now()` in a render-phase function is
   * exactly the impurity the React compiler refuses to optimize around.
   */
  startJob: (job: NewProviderJob) => string;
  upsertJob: (job: ProviderJob) => void;
  patchJob: (id: string, patch: Partial<ProviderJob>) => void;
  removeJob: (id: string) => void;
  clearJobs: () => void;
}

/** Monotonic within a session; ids only have to be unique among live jobs. */
let jobSequence = 0;

export const useProviderJobsStore = create<ProviderJobsState>((set) => ({
  jobs: [],
  startJob: (job) => {
    jobSequence += 1;
    const stamped: ProviderJob = {
      ...job,
      id: `${job.provider}-${jobSequence}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pollAttempt: 0,
    };
    set((state) => ({ jobs: [stamped, ...state.jobs] }));
    return stamped.id;
  },
  upsertJob: (job) =>
    set((state) => {
      const index = state.jobs.findIndex((current) => current.id === job.id);
      if (index === -1) return { jobs: [job, ...state.jobs] };
      const jobs = [...state.jobs];
      jobs[index] = job;
      return { jobs };
    }),
  patchJob: (id, patch) =>
    set((state) => ({
      jobs: state.jobs.map((job) =>
        job.id === id ? { ...job, ...patch, updatedAt: Date.now() } : job
      ),
    })),
  removeJob: (id) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
  clearJobs: () => set({ jobs: [] }),
}));
