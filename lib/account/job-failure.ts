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
  'provider_rejected', 'provider_policy', 'provider_unreachable', 'provider_timeout', 'submit_unconfirmed', 'worker_interrupted',
] as const;
export type FailureReason = typeof FAILURE_REASONS[number];

/**
 * Reasons where trying the same job again could genuinely end differently.
 *
 * Deliberately short. Everything absent is deterministic for *this* job, so the
 * row stops offering Resume rather than inviting the loop. `result_location`
 * has a per-job exception when the Worker now accepts all stored URLs. `storage_full` is
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
  result_location: 'Generation finished, but automatic saving was blocked by the provider’s download address.',
  result_missing: 'The provider reported success but sent no file to save.',
  result_wrong_type: 'The provider returned a different kind of file than this job asked for.',
  result_too_large: 'The result is larger than the supported output size, so it could not be saved.',
  result_count: 'The provider returned more files than one job can hold.',
  result_empty: 'The provider’s file was empty.',
  staged_missing: 'The provider’s file is no longer in temporary storage.',
  transfer_failed: 'Saving the result was interrupted. The provider’s file may still be there.',
  storage_full: 'Your result is temporarily available. Download it before its deadline, or free library space and resume saving.',
  provider_rejected: 'The provider refused this job.',
  provider_policy: 'The provider blocked this under its content filter. Resuming runs the same request and will be blocked again.',
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

type FailingJob = Pick<CloudJobView, 'state' | 'errorCode' | 'failureReason' | 'failureDetail' | 'attempts' | 'canRetrySave'>;

/** A Worker deployed before this field existed sends nothing, which reads as
 *  zero resumes — the same thing it meant for every row that predates it. */
export const resumeAttempts = (job: Pick<CloudJobView, 'attempts'>) => job.attempts ?? 0;

export function describeFailure(job: FailingJob): JobFailure {
  const reason = isFailureReason(job.failureReason) ? job.failureReason : null;
  return {
    sentence: reason ? SENTENCES[reason] : legacySentence(job.errorCode),
    // Provider text is stored only for a refusal the Worker sanitized first.
    detail: reason === 'provider_rejected' || reason === 'provider_policy' ? job.failureDetail ?? null : null,
    resumable: isRecoverable(job.failureReason) || (job.failureReason === 'result_location' && job.canRetrySave === true),
  };
}

/** The exact condition `POST /jobs/:id/resume` enforces. Keep them together:
 *  a row that offers a button the Worker answers 409 to is worse than a row
 *  that offers nothing, because the reader has no way to tell them apart. */
export function canResumeJob(job: FailingJob): boolean {
  return job.state === 'needs_attention' && describeFailure(job).resumable && resumeAttempts(job) < MAX_RESUME_ATTEMPTS;
}

/** Guidance follows actual resume eligibility; terminal rows and exhausted jobs
 * must never invite a retry the Worker will refuse. */
export function failureNextStep(job: FailingJob): string {
  if (job.state === 'failed') {
    if (job.errorCode === 'tracking_stopped') return 'Check the provider’s history for the result before starting another paid generation.';
    if (job.errorCode === 'storage_expired') return 'Check the provider’s history for another copy; the temporary library download is no longer available.';
    return 'Review the recorded error below and check the provider’s history before starting a new generation.';
  }
  if (job.failureReason === 'result_location') return canResumeJob(job)
    ? 'This download address is now supported. Retry saving the existing result without generating again, or download it directly from the provider.'
    : 'Get the provider download below and save the file to your device before the link expires. If it fails, use the provider reference to ask for the existing result.';
  if (describeFailure(job).resumable && resumeAttempts(job) >= MAX_RESUME_ATTEMPTS)
    return 'No retries remain for this job. Check the provider’s history for the existing result and copy the issue details if you need help.';
  switch (job.failureReason) {
    case 'provider_rejected': return 'Use the provider’s message to check your model settings, credentials or credits before submitting again.';
    case 'provider_policy': return 'Review the prompt and source media against the provider’s content policy before submitting a revised request.';
    case 'result_link_expired': return 'Check the provider’s history for another download or ask it to recover the existing result. Generating again may incur another charge.';
    case 'result_missing': case 'result_empty': case 'result_wrong_type': case 'result_count': case 'result_too_large': case 'staged_missing':
      return 'Check the provider’s history for the original output. Copy the issue details if you need help recovering it; retrying this save cannot fix the file.';
    case 'storage_full': return 'Download the temporary result from your library, or free library space and resume this job.';
    case 'transfer_failed': return 'Resume to retry saving the existing result. This does not start a new generation.';
    case 'provider_unreachable': case 'provider_timeout': case 'worker_interrupted':
      return 'Resume to check the existing job and save any available result. This does not start a new generation.';
    case 'submit_unconfirmed': return 'Check the provider’s history before generating again; the original request may already have been charged.';
    default: return 'The original failure detail was not recorded. Check the provider’s history before deciding whether to resume this job.';
  }
}

/** The list is a scan surface. Full explanations and retry history belong in
 * Issue details; these two short lines identify the cause and the next move. */
const SCAN_COPY: Record<FailureReason, [string, string]> = {
  result_link_expired: ['Download link expired', 'Check the provider’s history for another copy.'],
  result_location: ['Generated · saving blocked', 'Download the existing file before its link expires.'],
  result_missing: ['Provider returned no file', 'Check the provider’s history for the output.'],
  result_wrong_type: ['Wrong file type returned', 'Recover the original file from the provider.'],
  result_too_large: ['Result too large to save', 'Recover the original file from the provider.'],
  result_count: ['Too many output files', 'Recover the original files from the provider.'],
  result_empty: ['Provider returned an empty file', 'Check the provider’s history for another copy.'],
  staged_missing: ['Temporary file unavailable', 'Check the provider’s history for another copy.'],
  transfer_failed: ['Saving interrupted', 'Retry saving without generating again.'],
  storage_full: ['Library full', 'Download now, or free space and resume.'],
  provider_rejected: ['Provider rejected the job', 'Review the provider’s message in Issue details.'],
  provider_policy: ['Blocked by provider content filter', 'Review the prompt and source media before retrying.'],
  provider_unreachable: ['Provider unreachable', 'Resume tracking the existing job.'],
  provider_timeout: ['Tracking timed out', 'Check whether the existing job has finished.'],
  submit_unconfirmed: ['Submission unconfirmed', 'Check provider history before spending again.'],
  worker_interrupted: ['Tracking interrupted', 'Resume tracking the existing job.'],
};
export function failureSummary(job: FailingJob): { title: string; nextStep: string } {
  if (job.errorCode === 'tracking_stopped') return { title: 'Tracking stopped', nextStep: 'Check provider history; the job may have been charged.' };
  if (job.errorCode === 'storage_expired') return { title: 'Temporary download expired', nextStep: 'Check the provider’s history for another copy.' };
  const [title, nextStep] = isFailureReason(job.failureReason) ? SCAN_COPY[job.failureReason]
    : job.errorCode === 'provider_failed' ? ['Provider reported a failure', 'Open Issue details for the recorded error.']
    : ['Job could not finish', 'Open Issue details before retrying.'];
  if (job.state === 'failed') return { title, nextStep: 'Review Issue details before generating again.' };
  if (job.failureReason === 'result_location') return { title, nextStep: canResumeJob(job) ? 'Saving is now supported. Retry without generating again.' : nextStep };
  if (describeFailure(job).resumable && resumeAttempts(job) >= MAX_RESUME_ATTEMPTS)
    return { title, nextStep: 'Retry limit reached. Check the provider’s history.' };
  return { title, nextStep };
}
