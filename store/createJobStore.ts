import { create } from 'zustand';

/** Replaces the job with the same id, or files it first when it is new. */
export function upsertById<J extends { id: string }>(jobs: J[], job: J): J[] {
  const index = jobs.findIndex((current) => current.id === job.id);
  if (index === -1) return [job, ...jobs];
  const next = [...jobs];
  next[index] = job;
  return next;
}

export interface JobStoreState<J extends { id: string }> {
  /**
   * Intentionally tab-local, never persisted: provider jobs and their media
   * URLs are temporary, and the gallery is what makes a result durable.
   */
  jobs: J[];
  upsertJob: (job: J) => void;
  removeJob: (id: string) => void;
  clearJobs: () => void;
}

/** The in-memory list a queued provider (fal, Kie) polls from. */
export function createJobStore<J extends { id: string }>() {
  return create<JobStoreState<J>>((set) => ({
    jobs: [],
    upsertJob: (job) => set((state) => ({ jobs: upsertById(state.jobs, job) })),
    removeJob: (id) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
    clearJobs: () => set({ jobs: [] }),
  }));
}
