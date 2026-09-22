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
/** Unresolved: it will not resolve itself, so the overlay keeps showing it
 *  until dismissed rather than letting it scroll away with the finished work.
 *  Deliberately wider than `awaitingDecision` — a stopped job is still a row
 *  someone has to clear, so it stays on the list it can be cleared from. */
export function needsAttention(job: Pick<CloudJobView,'state'>) { return job.state === 'needs_attention' || job.state === 'failed'; }
/**
 * Waiting on a person, where the decision still changes something.
 *
 * What the alarm counts, as opposed to what the list shows. A job that already
 * failed or was stopped is a record to clear, not a decision to make, and
 * counting those together is how an account with five real decisions grew a
 * standing "11 jobs need attention" badge that followed the reader across every
 * page — an alarm that is mostly corpses is an alarm people learn to ignore.
 */
export function awaitingDecision(job: Pick<CloudJobView,'state'>) { return job.state === 'needs_attention'; }
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
/**
 * Clearable in one confirmed action from the list.
 *
 * Wider than `isRemovableJob` because stopping tracking and removing the row
 * are no longer two decisions: the Worker releases the reservation and hides
 * the row in one batch. A row still awaiting a decision therefore belongs in a
 * bulk clear — with the charge warning in the dialog, which is the part that
 * is not reversible. The single X stays on `isRemovableJob` alone, since an
 * unconfirmed click must never be able to stop tracking a live job.
 */
export function isClearableJob(job: Pick<CloudJobView,'state'>) { return isRemovableJob(job) || job.state === 'needs_attention'; }
/** Worth a row of its own. A saved job's output is already a card in the
 *  library or the result panel, so its row only repeated the prompt with a
 *  "Saved" tag; everything still running, waiting on a person, or stopped is
 *  telling the reader something the assets cannot. */
export function isListedJob(job: Pick<CloudJobView,'state'>) { return job.state !== 'saved'; }
