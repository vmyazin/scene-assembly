import type { CloudJobState, CloudJobView } from './contracts';
/** One source for how a job state is named and coloured. The account list and the
 *  queue overlay show the same jobs at the same moment, so a second copy of these
 *  maps would let the two surfaces call one state different things. */
export const JOB_STATE_LABELS: Record<CloudJobState,string> = {queued:'Queued',submitting:'Starting',running:'Generating',saving:'Saving',saved:'Saved',needs_attention:'Needs attention',failed:'Failed',cancelled:'Cancelled'};
export const JOB_STATE_TONES: Record<CloudJobState,string> = {queued:'text-sky-300',submitting:'text-sky-300',running:'text-violet-300',saving:'text-cyan-300',saved:'text-emerald-300',needs_attention:'text-amber-300',failed:'text-red-300',cancelled:'text-[var(--foreground-muted)]'};
/** In flight: the provider or our Worker still owes an answer, so the row is
 *  telling the truth when it says something is happening. */
const ACTIVE: CloudJobState[] = ['queued','submitting','running','saving'];
export function isActiveJob(job: Pick<CloudJobView,'state'>) { return ACTIVE.includes(job.state); }
/** Needs a person: it will not resolve itself, so the overlay keeps showing it
 *  until dismissed rather than letting it scroll away with the finished work. */
export function needsAttention(job: Pick<CloudJobView,'state'>) { return job.state === 'needs_attention' || job.state === 'failed'; }
/** Finished, saved, and owed nothing further. Separate from `isListedJob`
 *  below on purpose: the account page and the workspace rails sit beside the
 *  result card itself, so a "Saved" row there repeats what is already on
 *  screen, while the queue overlay is watched during a run and needs the
 *  finished rows to say "one done, three running" rather than "three left". */
export function isSucceededJob(job: Pick<CloudJobView,'state'>) { return job.state === 'saved'; }
/** Finished and owed nothing further, so the row is only a record: removing it
 *  takes away no saved asset and no spend entry, both of which outlive the job.
 *  Terminal states only, mirroring the Worker's own guard — anything earlier
 *  still holds a storage reservation that cancelling or dismissing must release
 *  first, and the Worker answers 409 rather than hiding it. */
export function isRemovableJob(job: Pick<CloudJobView,'state'>) { return job.state === 'failed' || job.state === 'cancelled'; }
/** Worth a row of its own. A saved job's output is already a card in the
 *  library or the result panel, so its row only repeated the prompt with a
 *  "Saved" tag; everything still running, waiting on a person, or stopped is
 *  telling the reader something the assets cannot. */
export function isListedJob(job: Pick<CloudJobView,'state'>) { return job.state !== 'saved'; }
