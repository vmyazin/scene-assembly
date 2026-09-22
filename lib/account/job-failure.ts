import type { CloudJobView } from './contracts';

/**
 * Why a job stopped, and what a reader can do about it.
 *
 * Shared rather than duplicated per surface, for the same reason
 * `job-status.ts` is: the account page, the queue overlay and the Worker all
 * describe the same stopped job at the same moment, and the Worker is the one
 * that enforces what this copy promises. If the row offers Resume for a reason
 * `POST /resume` refuses, the button is a lie — so the list of recoverable
 * reasons lives here once and `cloud/src/failure.ts` imports it.
 *
 * `errorCode` is not this. It names the arm of the runner that gave up, so one
 * `save_failed` covered an expired provider link, an oversized clip, a wrong
 * MIME type and a transient blip alike — which is how the account page ended up
 * saying "Tracking or saving needs another attempt" to everybody and offering a
 * Resume that repeated the same 404 until the reader gave up instead.
 */
export const FAILURE_REASONS = [
  'result_link_expired', 'result_location', 'result_missing', 'result_wrong_type', 'result_too_large',
  'result_count', 'result_empty', 'staged_missing', 'transfer_failed', 'storage_full',
  'provider_rejected', 'provider_unreachable', 'provider_timeout', 'submit_unconfirmed', 'worker_interrupted',
] as const;
export type FailureReason = typeof FAILURE_REASONS[number];

/**
 * Reasons where trying the same job again could genuinely end differently.
 *
 * Deliberately short. Everything absent is deterministic for *this* job, so the
 * row stops offering Resume rather than inviting the loop. `storage_full` is
 * here because freeing space is what changes the outcome, and the person
 * reading the row is the one who frees it.
 */
const RECOVERABLE = new Set<FailureReason>(['transfer_failed', 'provider_unreachable', 'provider_timeout', 'storage_full', 'worker_interrupted']);

/** Three identical outcomes retire the guess that the next attempt differs.
 *  Without a cap, "recoverable" and "unrecoverable" look the same to someone
 *  clicking the button. Enforced by the Worker; mirrored here so the row can
 *  stop offering what the Worker would refuse. */
export const MAX_RESUME_ATTEMPTS = 3;

export function isFailureReason(value: string | null | undefined): value is FailureReason {
  return !!value && (FAILURE_REASONS as readonly string[]).includes(value);
}
/** Unknown reasons — a job that stopped before the Worker recorded them — are
 *  treated as recoverable, so an older row keeps the behaviour it was made
 *  under rather than losing a button that may still have worked for it. */
export function isRecoverable(reason: string | null | undefined): boolean {
  return !isFailureReason(reason) || RECOVERABLE.has(reason);
}

/** What the row says, and whether Resume appears on it. */
export interface JobFailure { sentence: string; detail: string | null; resumable: boolean }

const SENTENCES: Record<FailureReason, string> = {
  result_link_expired: 'The provider’s download link for this result expired before it could be saved. Trying again cannot bring it back.',
  result_location: 'The provider delivered the result from an address this app does not accept.',
  result_missing: 'The provider reported success but sent no file to save.',
  result_wrong_type: 'The provider returned a different kind of file than this job asked for.',
  result_too_large: 'The result is larger than the supported output size, so it could not be saved.',
  result_count: 'The provider returned more files than one job can hold.',
  result_empty: 'The provider’s file was empty.',
  staged_missing: 'The provider’s file is no longer in temporary storage.',
  transfer_failed: 'Saving the result was interrupted. The provider’s file may still be there.',
  storage_full: 'Your result is temporarily available. Download it before its deadline, or free library space and resume saving.',
  provider_rejected: 'The provider refused this job.',
  provider_unreachable: 'The provider could not be reached to confirm this job.',
  provider_timeout: 'The provider was still working when tracking gave up.',
  submit_unconfirmed: 'The provider may have accepted this job. Check its history before starting another paid generation.',
  worker_interrupted: 'Tracking was interrupted before the result was saved.',
};

/**
 * Falls back to the old per-`errorCode` copy for rows that stopped before the
 * reason was recorded. Those cannot be reconstructed — the detail was thrown
 * away at the time — so they keep the generic sentence rather than gaining a
 * more specific one that might be wrong.
 */
function legacySentence(errorCode: string | null): string {
  if (errorCode === 'storage_full') return SENTENCES.storage_full;
  if (errorCode === 'submission_ambiguous') return SENTENCES.submit_unconfirmed;
  if (errorCode === 'tracking_stopped') return 'The provider may have charged for this — check its history.';
  if (errorCode === 'storage_expired') return 'The temporary download expired before library space became available.';
  if (errorCode === 'provider_failed') return 'The provider reported a failure.';
  return 'Tracking or saving needs another attempt. Resume this job without generating again.';
}

type FailingJob = Pick<CloudJobView, 'state' | 'errorCode' | 'failureReason' | 'failureDetail' | 'attempts'>;

/** A Worker deployed before this field existed sends nothing, which reads as
 *  zero resumes — the same thing it meant for every row that predates it. */
export const resumeAttempts = (job: Pick<CloudJobView, 'attempts'>) => job.attempts ?? 0;

export function describeFailure(job: FailingJob): JobFailure {
  const reason = isFailureReason(job.failureReason) ? job.failureReason : null;
  return {
    sentence: reason ? SENTENCES[reason] : legacySentence(job.errorCode),
    // Only `provider_rejected` carries one, and the Worker sanitized it before
    // it was stored. Rendered as the provider's words, never as our own.
    detail: reason === 'provider_rejected' ? job.failureDetail ?? null : null,
    resumable: isRecoverable(job.failureReason),
  };
}

/** The exact condition `POST /jobs/:id/resume` enforces. Keep them together:
 *  a row that offers a button the Worker answers 409 to is worse than a row
 *  that offers nothing, because the reader has no way to tell them apart. */
export function canResumeJob(job: FailingJob): boolean {
  return job.state === 'needs_attention' && isRecoverable(job.failureReason) && resumeAttempts(job) < MAX_RESUME_ATTEMPTS;
}
