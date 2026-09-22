import { jobInputIds } from '../../lib/account/contracts';
import { isEditVideoMime } from '../../lib/providers/video-edit';
import type { CloudJobRequest, CloudJobState, CloudJobView } from '../../lib/account/contracts';
import { hash, isLocal, type Env } from './security';
import type { Provider } from './vault';
import { MAX_INLINE_INPUT_BYTES } from './limits';
export const FREE_BYTES = 1_000_000_000;
export const MAX_ACTIVE_JOBS = 10;
export const MAX_GLOBAL_ACTIVE_JOBS = 100;
export const IMAGE_RESERVATION = 64_000_000;
/**
 * Room booked per job before its output exists, so concurrent jobs cannot
 * collectively promise more than the quota holds.
 *
 * The video figure is derived from `MAX_ACTIVE_JOBS`, not from a file size:
 * ten jobs must fit inside `FREE_BYTES`, and 10 x 96 MB is 960 MB. It was
 * 256 MB, which capped video at three concurrent jobs however high the job
 * count went — the storage gate rejected the fourth while naming storage,
 * so raising the count alone would have changed nothing for video.
 *
 * Still generous against what these models produce: durations on offer are
 * 4, 6 and 8 seconds, and a 4k eight-second clip lands well under 60 MB. An
 * output that does exceed its reservation is not lost — `AVAILABLE_CAPACITY`
 * weighs the *actual* size with this job's own reservation excluded, so it
 * saves whenever the real file fits, and otherwise becomes a 24-hour
 * temporary result asking for space.
 */
export const VIDEO_RESERVATION = 96_000_000;
/** Whole megabytes: these figures are quota arithmetic, not file sizes. */
const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
// Stopping tracking releases a job slot, but its temporary bytes still occupy
// overflow storage until retained-file cleanup succeeds.
const GLOBAL_OCCUPIED_SLOTS = `(SELECT COALESCE(SUM(active_jobs),0) FROM account_storage) +
  (SELECT COUNT(DISTINCT j.id) FROM account_jobs j JOIN account_assets a ON a.job_id=j.id
   JOIN account_asset_retention r ON r.asset_id=a.id WHERE j.reservation_accounted=0)`;
const OWNER_OVERFLOW = `SELECT 1 FROM account_assets a JOIN account_asset_retention r ON r.asset_id=a.id WHERE a.user_id=? AND a.deleted=0`;
/**
 * Jobs that occupy a slot: the provider or our Worker still owes an answer.
 *
 * Counted live from job state rather than read off `account_storage.active_jobs`,
 * because that counter is one accounting unit with `reserved_bytes` — both are
 * released together on a terminal transition — so it also counts a job stuck in
 * `needs_attention`, waiting on a person who may never come back. Those held a
 * slot indefinitely while nothing was running.
 *
 * The counter is deliberately left alone: it still guards the reservation, which
 * a stuck job genuinely needs, since its result may yet have to be saved.
 *
 * The four states mirror `isActiveJob` in `lib/account/job-status.ts`, which is
 * what the account UI calls active. A slot the UI shows as in flight and a slot
 * the intake counts must be the same slot.
 */
const RUNNING_JOB_COUNT = `SELECT COUNT(*) FROM account_jobs
  WHERE user_id = ? AND deleted = 0 AND state IN ('queued','submitting','running','saving')`;
export interface JobRow {
  id: string; user_id: string; provider: CloudJobRequest['provider']; request_json: string; state: CloudJobState;
  connection_id: string | null; connection_revision: number | null; provider_task: string | null;
  result_json: string | null; error_code: string | null; failure_reason: string | null; failure_detail: string | null;
  reservation_bytes: number; reservation_accounted: number;
  request_digest: string; workflow_attempt: number; dispatched: number; deleted: number; created_at: number; updated_at: number;
}
export class AccountError extends Error { constructor(message: string, public status: number, public code: string) { super(message); } }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function jobView(row: JobRow): CloudJobView {
  return {
    id: row.id, provider: row.provider, state: row.state, errorCode: row.error_code,
    // `attempts` is the resume count, not a retry count: the row uses it to say
    // "attempt 2" and to stop offering a button the Worker would now refuse.
    failureReason: row.failure_reason ?? null, failureDetail: row.failure_detail ?? null, attempts: row.workflow_attempt,
    request: JSON.parse(row.request_json), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export async function getJob(env: Env, id: string, owner?: string) {
  return env.DB.prepare(`SELECT * FROM account_jobs WHERE id = ? AND deleted = 0${owner ? ' AND user_id = ?' : ''}`).bind(...(owner ? [id, owner] : [id])).first<JobRow>();
}
export async function acceptJob(env: Env, owner: string, token: string, request: CloudJobRequest): Promise<JobRow> {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(token)) throw new AccountError('Invalid submission token.', 400, 'invalid_token');
  const inputIds=jobInputIds(request);
  if(new Set(inputIds).size!==inputIds.length)throw new AccountError('Duplicate references are not supported.',400,'invalid_references');
  const references=JSON.stringify(inputIds);
  const digest = await hash(canonical(request));
  const existing = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?').bind(owner, token).first<JobRow>();
  if (existing) { if (existing.request_digest !== digest || existing.deleted) throw new AccountError('Submission token already used.', 409, 'token_conflict'); return existing; }
  const uploads=await env.DB.prepare('SELECT id,mime_type FROM account_uploads WHERE user_id=? AND id IN (SELECT value FROM json_each(?))').bind(owner,references).all<{id:string;mime_type:string}>();
  for(const upload of uploads.results){
    const source=upload.id===request.sourceVideoId;
    if(source ? request.inputMode!=='edit'||!isEditVideoMime(upload.mime_type) : !upload.mime_type.startsWith('image/'))throw new AccountError('Source video and reference images must match their input roles.',400,'invalid_references');
  }
  const localEdit = isLocal(env) && env.DEV_FAKE_GENERATION !== '1' && request.provider === 'runware' && request.inputMode === 'edit';
  if (request.provider === 'gemini' || request.provider === 'comet' || localEdit) {
    const inputs = await env.DB.prepare('SELECT COALESCE(SUM(expected_bytes),0) AS bytes FROM account_uploads WHERE user_id=? AND id IN (SELECT value FROM json_each(?))').bind(owner,references).first<{bytes:number}>();
    if ((inputs?.bytes ?? 0) > MAX_INLINE_INPUT_BYTES) throw new AccountError(localEdit ? 'Local background edits accept up to 12 MB of source video and images. Use a smaller clip or switch to in-browser.' : 'This provider accepts up to 12 MB of reference images per background job. Use smaller images.',400,'inline_input_size');
  }
  const connection = request.provider === 'local-test' ? null : await env.DB.prepare('SELECT id, revision FROM account_connections WHERE user_id = ? AND provider = ?').bind(owner, request.provider as Provider).first<{ id: string; revision: number }>();
  if (!connection && request.provider !== 'local-test') throw new AccountError('Save this provider connection in your account first.', 409, 'connection_required');
  const id = crypto.randomUUID(), now = Date.now();
  const reservation = request.mediaType === 'video' ? VIDEO_RESERVATION : IMAGE_RESERVATION;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO account_storage (user_id) VALUES (?)').bind(owner),
    env.DB.prepare(`INSERT OR IGNORE INTO account_jobs (id,user_id,request_token,request_digest,connection_id,connection_revision,provider,request_json,reservation_bytes,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? FROM account_storage WHERE user_id = ? AND used_bytes + reserved_bytes + ? <= limit_bytes AND (${RUNNING_JOB_COUNT}) < ? AND (${GLOBAL_OCCUPIED_SLOTS}) < ${MAX_GLOBAL_ACTIVE_JOBS} AND NOT EXISTS (${OWNER_OVERFLOW}) AND (SELECT COUNT(*) FROM account_uploads WHERE user_id=? AND state='ready' AND expires_at>? AND id IN (SELECT value FROM json_each(?)))=?`)
      .bind(id, owner, token, digest, connection?.id ?? null, connection?.revision ?? null, request.provider, JSON.stringify(request), reservation, now, now, owner, reservation, owner, MAX_ACTIVE_JOBS, owner, owner, now, references, inputIds.length),
    env.DB.prepare('UPDATE account_storage SET reserved_bytes = reserved_bytes + ?, active_jobs = active_jobs + 1 WHERE user_id = ? AND EXISTS (SELECT 1 FROM account_jobs WHERE id = ? AND reservation_accounted = 0)').bind(reservation, owner, id),
    env.DB.prepare('UPDATE account_jobs SET reservation_accounted = 1 WHERE id = ?').bind(id),
    env.DB.prepare('INSERT OR IGNORE INTO account_job_inputs (job_id,upload_id) SELECT ?,id FROM account_uploads WHERE user_id=? AND id IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM account_jobs WHERE id=?)').bind(id,owner,references,id),
  ]);
  const row = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?').bind(owner, token).first<JobRow>();
  if (!row) {
    if(await env.DB.prepare(OWNER_OVERFLOW).bind(owner).first())throw new AccountError('Resolve your temporary results before starting another cloud job. Download and delete them, wait for their displayed expiry, or free space and resume jobs still awaiting saving.',409,'temporary_results');
    const global=await env.DB.prepare(`SELECT ${GLOBAL_OCCUPIED_SLOTS} AS active`).first<{active:number}>();
    if((global?.active??0)>=MAX_GLOBAL_ACTIVE_JOBS)throw new AccountError('Background generation is busy. Try again shortly or explicitly choose browser-only generation.',503,'service_capacity');
    // One sentence used to cover everything below, and named storage first —
    // which is the only figure the account page shows prominently, and rarely
    // the one that actually stopped the job. A reader with an almost empty
    // library was being sent to delete files that were never the problem.
    if (inputIds.length) {
      const ready = await env.DB.prepare(`SELECT COUNT(*) AS ready FROM account_uploads
        WHERE user_id=? AND state='ready' AND expires_at>? AND id IN (SELECT value FROM json_each(?))`)
        .bind(owner, now, references).first<{ ready: number }>();
      if ((ready?.ready ?? 0) !== inputIds.length) {
        throw new AccountError('A reference image is no longer available. Attach it again and start the job.', 409, 'reference_unavailable');
      }
    }
    const account = await env.DB.prepare('SELECT used_bytes, reserved_bytes, active_jobs, limit_bytes FROM account_storage WHERE user_id = ?')
      .bind(owner).first<{ used_bytes: number; reserved_bytes: number; active_jobs: number; limit_bytes: number }>();
    const used = account?.used_bytes ?? 0, held = account?.reserved_bytes ?? 0, limit = account?.limit_bytes ?? 0;
    // The same live count the guard used, not `account.active_jobs`: that
    // column includes jobs stuck awaiting a decision, which no longer occupy a
    // slot, so reading it here would name a limit the intake did not apply.
    const running = await env.DB.prepare(`SELECT (${RUNNING_JOB_COUNT}) AS running`).bind(owner).first<{ running: number }>();
    if ((running?.running ?? 0) >= MAX_ACTIVE_JOBS) {
      // No longer suggests dismissing: a dismissed job was already not counted,
      // so that advice would send someone to do something that changes nothing.
      throw new AccountError(`This account already has ${MAX_ACTIVE_JOBS} jobs running. Wait for one to finish, or cancel one on your account page.`, 409, 'active_jobs');
    }
    // What the intake actually weighed: every job in flight holds its whole
    // possible output, so an account can be out of room with nothing saved.
    if (used + held + reservation > limit) {
      throw used + reservation <= limit
        ? new AccountError(`Jobs in progress are holding ${megabytes(held)} of this account's ${megabytes(limit)}. Wait for them to finish, or dismiss them on your account page.`, 409, 'reserved_capacity')
        : new AccountError(`This account has ${megabytes(used)} saved of ${megabytes(limit)}, with no room for this job. Delete saved results to make space.`, 409, 'capacity');
    }
    // Nothing above accounts for it, so say that rather than name a limit that
    // was not the one in the way.
    throw new AccountError('This job could not be started. Try again shortly.', 409, 'capacity');
  }
  if (row.request_digest !== digest) throw new AccountError('Submission token already used.', 409, 'token_conflict');
  return row;
}
/**
 * Records the specific cause, separately from the coarse state transition.
 *
 * Called from inside the failing step rather than after it, because that is the
 * last place the `AccountError` prototype is intact — past the `step.do`
 * boundary the code is gone and only a flattened message survives. Writing it
 * here is also what lets the step return instead of burning five backed-off
 * retries on a cause no retry can change.
 */
export async function recordFailure(env: Env, id: string, reason: string, detail: string | null = null) {
  await env.DB.prepare("UPDATE account_jobs SET failure_reason = ?, failure_detail = ? WHERE id = ? AND deleted = 0 AND state NOT IN ('saved','cancelled')").bind(reason, detail, id).run();
}
/**
 * `COALESCE` on the reason columns, deliberately.
 *
 * The coarse transition always runs after the specific one — the runner's outer
 * catch sets `needs_attention`/`save_failed` once the step that already knew it
 * was a dead link has given up — so a plain assignment here would erase the
 * only useful thing the row had. Overwriting is `recordFailure`'s job, and
 * clearing is the resume route's.
 */
export async function setJobState(env: Env, id: string, state: CloudJobState, errorCode: string | null = null, failure?: { reason: string; detail?: string | null }) {
  await env.DB.prepare("UPDATE account_jobs SET state = ?, error_code = ?, failure_reason = COALESCE(?, failure_reason), failure_detail = COALESCE(?, failure_detail), updated_at = ? WHERE id = ? AND deleted = 0 AND state NOT IN ('saved','failed','cancelled')")
    .bind(state, errorCode, failure?.reason ?? null, failure?.detail ?? null, Date.now(), id).run();
}
/** Release once, under the same transaction as the terminal status. */
export async function finishJob(env: Env, id: string, state: 'saved' | 'failed' | 'cancelled', errorCode: string | null = null, failure?: { reason: string; detail?: string | null }) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE account_storage SET reserved_bytes = reserved_bytes - (SELECT reservation_bytes FROM account_jobs WHERE id = ?), active_jobs = active_jobs - 1
      WHERE user_id = (SELECT user_id FROM account_jobs WHERE id = ? AND reservation_accounted = 1 AND deleted=0 AND state NOT IN ('saved','failed','cancelled'))`).bind(id, id),
    env.DB.prepare("UPDATE account_jobs SET state = ?, error_code = ?, failure_reason = COALESCE(?, failure_reason), failure_detail = COALESCE(?, failure_detail), reservation_accounted = 0, updated_at = ? WHERE id = ? AND deleted = 0 AND state NOT IN ('saved','failed','cancelled')")
      .bind(state, errorCode, failure?.reason ?? null, failure?.detail ?? null, Date.now(), id),
  ]);
}
/** Cancel only before provider submission, releasing the reservation atomically. */
export async function cancelQueuedJob(env: Env, id: string, owner: string): Promise<JobRow | null> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE account_storage SET reserved_bytes = reserved_bytes - (SELECT reservation_bytes FROM account_jobs WHERE id = ?), active_jobs = active_jobs - 1
      WHERE user_id = (SELECT user_id FROM account_jobs WHERE id = ? AND user_id = ? AND reservation_accounted = 1 AND deleted = 0 AND state = 'queued' AND provider_task IS NULL AND result_json IS NULL)`).bind(id, id, owner),
    env.DB.prepare("UPDATE account_jobs SET state = 'cancelled', error_code = NULL, reservation_accounted = 0, updated_at = ? WHERE id = ? AND user_id = ? AND deleted = 0 AND state = 'queued' AND provider_task IS NULL AND result_json IS NULL").bind(now, id, owner),
  ]);
  const job = await getJob(env, id, owner);
  if (!job) return null;
  if (job.state === 'cancelled') return job;
  throw new AccountError('This generation has already started and remains tracked.', 409, 'generation_started');
}
/**
 * Stop tracking only while a job is waiting for an explicit account decision.
 *
 * `remove` folds what used to be a mandatory second click into this batch. The
 * two steps were not two decisions: the destructive one — the provider may
 * still finish and charge — is taken at the confirm dialog, and what followed
 * was a row saying "Tracking stopped" next to an X, which people reasonably
 * read as the button having done nothing. Three of them sat on one account for
 * five days. The release and the removal have to land together for the same
 * reason they did before: a row that is gone from the list is the only row that
 * cannot be used to release its own reservation later.
 *
 * Soft delete, never a real DELETE, matching `removeFinishedJob`:
 * `cleanupTerminalJobObjects` finds staged provider objects by joining this row
 * during its 24-hour grace, and dropping it would strand them unmetered.
 */
export async function dismissAttentionJob(env: Env, id: string, owner: string, remove = false): Promise<JobRow | null> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE account_storage SET reserved_bytes = reserved_bytes - (SELECT reservation_bytes FROM account_jobs WHERE id = ?), active_jobs = active_jobs - 1
      WHERE user_id = (SELECT user_id FROM account_jobs WHERE id = ? AND user_id = ? AND reservation_accounted = 1 AND deleted = 0 AND state = 'needs_attention')`).bind(id, id, owner),
    env.DB.prepare(`UPDATE account_jobs SET state = 'failed', error_code = 'tracking_stopped', reservation_accounted = 0, deleted = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted = 0 AND state = 'needs_attention'`).bind(remove ? 1 : 0, now, id, owner),
  ]);
  // Read past the `deleted = 0` filter `getJob` applies: with `remove` the row
  // this call just wrote is exactly the one that filter now hides, and reading
  // through it would report a successful removal as a missing job.
  const job = await env.DB.prepare('SELECT * FROM account_jobs WHERE id = ? AND user_id = ?').bind(id, owner).first<JobRow>();
  if (!job) return null;
  if (job.state === 'failed' && job.error_code === 'tracking_stopped') return job;
  throw new AccountError('This generation is no longer waiting for a tracking decision.', 409, 'tracking_state_changed');
}
/**
 * Removes a finished job from the account's list.
 *
 * Terminal states only. A job that has not finished still holds a storage
 * reservation that only `cancelQueuedJob` or `dismissAttentionJob` releases, so
 * removing one here would leak reserved bytes and an active-job slot with no
 * row left on screen to release them from.
 *
 * Soft delete rather than a real DELETE, because `cleanupTerminalJobObjects`
 * finds staged provider objects by joining this row and its journal cascades
 * with it: dropping the row would strand any object the provider writes during
 * the 24-hour recovery grace, unreachable and unmetered. Every list query
 * already filters `deleted = 0`, so the job is gone from the UI either way.
 *
 * `updated_at` is deliberately left alone. The object cleanup schedules its
 * grace from that column, and bumping it here would push the sweep 24 hours
 * past the removal instead of past the generation it belongs to.
 */
export async function removeFinishedJob(env: Env, id: string, owner: string): Promise<void> {
  const removed = await env.DB.prepare("UPDATE account_jobs SET deleted = 1 WHERE id = ? AND user_id = ? AND deleted = 0 AND state IN ('failed','cancelled')").bind(id, owner).run();
  if (!removed.meta.changes) throw new AccountError('Only a stopped or cancelled generation can be removed from your list.', 409, 'job_not_finished');
}
export async function dispatchJob(env: Env, job: JobRow) {
  if (!env.GENERATION) throw new Error('Workflow binding is unavailable');
  const instanceId = `${job.id}-${job.workflow_attempt}`;
  try { await env.GENERATION.create({ id: instanceId, params: { jobId: job.id } }); }
  catch {
    // Creation can succeed remotely before its response is lost. Confirm existence.
    const instance = await env.GENERATION.get(instanceId);
    await instance.status();
  }
  await env.DB.prepare('UPDATE account_jobs SET dispatched = 1 WHERE id = ? AND workflow_attempt = ?').bind(job.id, job.workflow_attempt).run();
}
