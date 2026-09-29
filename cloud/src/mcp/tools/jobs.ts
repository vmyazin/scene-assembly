import * as z from 'zod';
import { jobInputIds, type CloudJobRequest, type CloudJobState } from '../../../../lib/account/contracts';
import { estimateCloudJob } from '../../../../lib/spend/estimate';
import { jobAssets } from '../../assets';
import { acceptJob, AccountError, cancelQueuedJob, dismissAttentionJob, dispatchJob, getJob, jobView, type JobRow } from '../../jobs';
import { resumeJob } from '../../job-routes';
import { mediaAccess } from '../../media';
import { hash, randomToken } from '../../security';
import { discardUploads } from '../../uploads';
import { attachCharge, budgetStatus, dropCharge, reserveCharge } from '../budget';
import { ToolError } from '../errors';
import { defineTool, type ToolContext } from '../tool';
import { resolveReferences } from './references';
import { budgetRefusal, prepareRequest, requestShape } from './request';

const TERMINAL: CloudJobState[] = ['saved', 'failed', 'cancelled'];
const POLL_MS = 2000;

/** Scoped to the agent, so two agents choosing the same key never collide. */
export async function agentJobToken(agentId: string, idempotencyKey?: string) {
  return idempotencyKey ? hash(`agent:${agentId}:${idempotencyKey}`) : randomToken();
}

/** A retry with the same key is the same run if everything but the freshly copied reference ids matches. */
function sameRun(saved: CloudJobRequest, next: CloudJobRequest) {
  const shape = (request: CloudJobRequest) => JSON.stringify([request.provider, request.modelId, request.mediaType, request.inputMode, request.prompt,
    Object.entries(request.values).sort(([a], [b]) => a.localeCompare(b)), request.referenceIds.length, Boolean(request.sourceVideoId)]);
  return shape(saved) === shape(next);
}

async function started(ctx: ToolContext, job: JobRow, estimate: ReturnType<typeof estimateCloudJob>) {
  const budget = await budgetStatus(ctx.env, ctx.agent, ctx.now());
  return {
    structured: { job: jobView(job), estimate: { costUsd: estimate.costUsd, confidence: estimate.confidence }, budget },
    text: `Job ${job.id} is ${job.state}. Call get_job with waitSeconds to follow it.`,
  };
}

/** Shared by the up-front existing-token lookup and the reserveCharge
 *  created:false path: a job already sitting under this token is either the
 *  exact same run (resume it) or a genuine conflict (refuse either way). */
function resumeExistingJob(ctx: ToolContext, job: JobRow, request: CloudJobRequest, estimate: ReturnType<typeof estimateCloudJob>) {
  if (job.deleted) throw new AccountError('That idempotencyKey belongs to a job that was removed. Use a new idempotencyKey.', 409, 'token_conflict');
  if (!sameRun(JSON.parse(job.request_json), request)) throw new AccountError('Submission token already used.', 409, 'token_conflict');
  return started(ctx, job, estimate);
}

/** True when `job`'s own saved request uses any upload id in `copiedIds` — ids
 *  only this call's resolveReferences could have produced (each copy is a
 *  fresh crypto.randomUUID()), so this can only be true when `job` is this
 *  call's own job: acceptJob's write committed and its own read-back then
 *  threw, never a sibling's independently resolved copies. */
function jobUsesAnyOf(job: JobRow, copiedIds: string[]): boolean {
  if (!copiedIds.length) return false;
  const used = new Set(jobInputIds(JSON.parse(job.request_json) as CloudJobRequest));
  return copiedIds.some(id => used.has(id));
}

export const generate = defineTool({
  name: 'generate',
  title: 'Generate an image or video',
  description: 'Start a background image or video job with this account\'s connected provider key. It returns at once with a job; call get_job with waitSeconds to follow it. Settings left out take the model\'s defaults, written into the request so the price and the run match. The estimate is charged against this agent\'s 24-hour spend limit before the job starts. Pass an idempotencyKey (any string you choose, reused on retry) so a retried call cannot start and pay for a second job.',
  kind: 'submit',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  input: z.object({ ...requestShape, idempotencyKey: z.string().min(1).max(200).optional() }),
  async run(ctx, args) {
    const { env, agent } = ctx;
    const prepared = await prepareRequest(ctx, args);
    const estimate = estimateCloudJob(prepared.request);
    const token = await agentJobToken(agent.id, args.idempotencyKey);
    // Deliberately not filtered on deleted = 0: a removed job's row still owns
    // this token, and a retry must be told to pick a new idempotencyKey rather
    // than fall through to reserveCharge, which would book a second charge for
    // a token that already named a (now gone) job.
    const existing = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?').bind(agent.user_id, token).first<JobRow>();
    if (existing) return resumeExistingJob(ctx, existing, prepared.request, estimate);
    const outcome = await reserveCharge(env, agent, token, estimate, ctx.now());
    if (!outcome.ok) throw budgetRefusal(outcome, estimate);
    if (!outcome.created) {
      // A sibling call already holds this exact reservation. Only the call
      // that created it may resolve references and accept a job — otherwise
      // this call would go on to accept ITS OWN (possibly bigger, possibly
      // over-limit) request under a reservation someone else's budget check
      // already passed for a different one, or, if the sibling then drops it
      // on its own refusal, accept a job for free. Re-read instead: the
      // sibling's job may already exist (resume it), or the token may simply
      // still be starting.
      const job = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?').bind(agent.user_id, token).first<JobRow>();
      if (job) return resumeExistingJob(ctx, job, prepared.request, estimate);
      throw new AccountError('A request with this idempotencyKey is still starting. Retry in a few seconds, or call list_jobs.', 425, 'request_in_progress');
    }

    // Everything from here down to acceptJob returning a job is undone on
    // failure: a reservation whose job never got made paid for nothing, and a
    // library copy resolveReferences made for it is unused. dropCharge (never
    // releaseCharge — that only marks a row released, and a retried
    // idempotencyKey looks itself up by this exact id) deletes the row outright
    // so the same key can book a fresh, budget-checked charge next time. A
    // staged { uploadId } is never in copiedIds, so it is never touched here.
    //
    // Once acceptJob has returned a job, none of this applies any more: the
    // charge and any copies it used now belong to that job, and a transient
    // failure attaching the charge, dispatching, or reading the job back must
    // leave both alone — cleanupOrphanCharges reattaches an orphaned charge by
    // token on its own schedule, and undoing a live job's inputs here would
    // fail it at the provider instead.
    let references: Awaited<ReturnType<typeof resolveReferences>>;
    try {
      references = await resolveReferences(ctx, args.references, args.sourceVideo);
    } catch (error) {
      if (outcome.created) await dropCharge(env, token).catch(() => {});
      throw error;
    }

    const request: CloudJobRequest = {
      provider: prepared.request.provider, modelId: prepared.request.modelId, mediaType: prepared.request.mediaType,
      inputMode: prepared.request.inputMode, prompt: prepared.request.prompt, values: prepared.request.values,
      referenceIds: references.referenceIds, ...(references.sourceVideoId ? { sourceVideoId: references.sourceVideoId } : {}),
    };
    let job: JobRow;
    try {
      job = await acceptJob(env, agent.user_id, token, request, agent.id);
    } catch (error) {
      // acceptJob can throw after its own write already committed — its
      // internal read-back can itself fail transiently — in which case the
      // job that now exists under this token is THIS call's own, not a
      // sibling's: only this call was ever allowed to reach acceptJob for it
      // (the created:false path above never does), so the only other job
      // that could legitimately be sitting here is this one. Recognize it by
      // referencing one of the uploads this call itself just copied — no
      // other job ever could, since each copy is a fresh id — and finish
      // exactly as the normal path would, never discarding or dropping.
      //
      // Guard the re-read itself: if IT throws, that is a fresh problem with
      // the read path, not evidence about the write that already committed —
      // surface the original acceptJob error and touch nothing.
      let reread: JobRow | null;
      try {
        reread = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?').bind(agent.user_id, token).first<JobRow>() ?? null;
      } catch {
        throw error;
      }
      if (reread && jobUsesAnyOf(reread, references.copiedIds)) {
        await attachCharge(env, token, reread.id);
        if (!reread.dispatched) await dispatchJob(env, reread).catch(() => {});
        return started(ctx, (await getJob(env, reread.id, agent.user_id)) ?? reread, estimate);
      }
      if (reread) {
        // A job under this token that does not use any of our own copies is
        // someone else's — it owns the shared charge via its own
        // attachCharge, so only the copies this call made are ours to discard.
        if (references.copiedIds.length) await discardUploads(env, agent.user_id, references.copiedIds).catch(() => {});
        if (sameRun(JSON.parse(reread.request_json), prepared.request)) return started(ctx, reread, estimate);
        throw error;
      }
      if (outcome.created) await dropCharge(env, token).catch(() => {});
      if (references.copiedIds.length) await discardUploads(env, agent.user_id, references.copiedIds).catch(() => {});
      throw error;
    }

    await attachCharge(env, token, job.id);
    // Acceptance is durable even when dispatch fails; scheduled reconciliation repairs it.
    if (!job.dispatched) await dispatchJob(env, job).catch(() => {});
    return started(ctx, (await getJob(env, job.id, agent.user_id)) ?? job, estimate);
  },
});

export const getJobTool = defineTool({
  name: 'get_job',
  title: 'Get a job',
  description: 'A job\'s state and, once it is saved, its outputs with download links that expire in a few minutes. Pass waitSeconds (up to 25) to hold the call until the state changes, instead of polling.',
  kind: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({ jobId: z.string().min(1).max(64), waitSeconds: z.number().int().min(0).max(25).optional() }),
  async run(ctx, { jobId, waitSeconds = 0 }) {
    const owner = ctx.agent.user_id;
    const notFound = () => new ToolError('not_found', 'No job with that id on this account.');
    let job = await getJob(ctx.env, jobId, owner);
    if (!job) throw notFound();
    const from = job.state;
    const deadline = ctx.now() + waitSeconds * 1000;
    while (!TERMINAL.includes(job.state) && job.state === from && ctx.now() < deadline) {
      await ctx.sleep(Math.min(POLL_MS, deadline - ctx.now()));
      const refreshed = await getJob(ctx.env, jobId, owner);
      // A job removed mid-wait is gone, not merely unchanged: report that
      // rather than keep returning its last state as if the wait continued.
      if (!refreshed) throw notFound();
      job = refreshed;
    }
    const outputs = job.state === 'saved'
      ? await Promise.all((await jobAssets(ctx.env, owner, job.id)).map(async asset => {
        const access = await mediaAccess(ctx.env, owner, asset.id, 'download');
        return { assetId: asset.id, kind: asset.kind, mimeType: asset.mime_type, bytes: asset.bytes, downloadUrl: access.url, expiresAt: access.expiresAt };
      }))
      : [];
    return {
      structured: { job: jobView(job), outputs },
      text: job.state === 'saved' ? `Job ${job.id} is saved with ${outputs.length} output${outputs.length === 1 ? '' : 's'}. Call view_asset to look at one.` : `Job ${job.id} is ${job.state}.`,
      content: outputs.map(output => ({ type: 'resource_link' as const, uri: output.downloadUrl, name: output.assetId, mimeType: output.mimeType })),
    };
  },
});

const LIST_STATES: Record<'active' | 'needs_attention' | 'finished', CloudJobState[]> = {
  // The same four isActiveJob (lib/account/job-status.ts) calls active.
  active: ['queued', 'submitting', 'running', 'saving'],
  needs_attention: ['needs_attention'],
  finished: ['saved', 'failed', 'cancelled'],
};

export const listJobs = defineTool({
  name: 'list_jobs',
  title: 'List jobs',
  description: 'This account\'s most recent jobs, newest first, including ones started in the browser. Filter by state: active (still running), needs_attention (stopped and waiting on a decision), finished, or all.',
  kind: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({ state: z.enum(['active', 'needs_attention', 'finished', 'all']).optional(), limit: z.number().int().min(1).max(100).optional() }),
  async run(ctx, { state = 'all', limit = 20 }) {
    // The state filter has to run inside SQL, before LIMIT: filtering in JS
    // after fetching only the newest rows can miss a match that is older than
    // the cutoff, e.g. a needs_attention job that has sat untouched while a
    // hundred newer active ones were created.
    const states = state === 'all' ? null : JSON.stringify(LIST_STATES[state]);
    const rows = await ctx.env.DB.prepare(`SELECT j.*, g.client_name AS agent_name FROM account_jobs j LEFT JOIN account_agents g ON g.id = j.agent_id
      WHERE j.user_id = ? AND j.deleted = 0 AND (? IS NULL OR j.state IN (SELECT value FROM json_each(?)))
      ORDER BY j.created_at DESC LIMIT ?`)
      .bind(ctx.agent.user_id, states, states, limit).all<JobRow>();
    const jobs = rows.results.map(jobView);
    return { structured: { jobs }, text: `${jobs.length} job${jobs.length === 1 ? '' : 's'}.` };
  },
});

const jobId = z.object({ jobId: z.string().min(1).max(64) });

/** Ownership is checked before any state change, so another account's job
 *  always reads not_found rather than leaking a state-conflict refusal. */
async function ownJob(ctx: ToolContext, id: string) {
  const job = await getJob(ctx.env, id, ctx.agent.user_id);
  if (!job) throw new ToolError('not_found', 'No job with that id on this account.');
  return job;
}

export const cancelJob = defineTool({
  name: 'cancel_job',
  title: 'Cancel a job',
  description: 'Cancel a job that is still queued, before the provider has it. Its charge against this agent\'s limit is released. A job the provider already started cannot be cancelled and stays tracked.',
  kind: 'write',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  input: jobId,
  async run(ctx, args) {
    await ownJob(ctx, args.jobId);
    const job = await cancelQueuedJob(ctx.env, args.jobId, ctx.agent.user_id);
    if (!job) throw new ToolError('not_found', 'No job with that id on this account.');
    return { structured: { job: jobView(job) }, text: `Job ${job.id} is cancelled.` };
  },
});

export const resumeJobTool = defineTool({
  name: 'resume_job',
  title: 'Resume a job',
  description: 'Try again on a job that needs attention, when the reason it stopped can be fixed by trying again (the job\'s failureReason says). Refused for results that cannot be recovered and after three attempts; dismiss_job clears those.',
  // 'submit', not 'write': a successful resume dispatches the provider again,
  // the same paid work generate starts, so it shares generate's 10/minute
  // submission budget rather than the looser 60/minute write bucket.
  kind: 'submit',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  input: jobId,
  async run(ctx, args) {
    const job = await resumeJob(ctx.env, await ownJob(ctx, args.jobId), ctx.agent.user_id);
    return { structured: { job: jobView(job) }, text: `Job ${job.id} is ${job.state} again.` };
  },
});

export const dismissJob = defineTool({
  name: 'dismiss_job',
  title: 'Stop tracking a job',
  description: 'Stop tracking a job that needs attention. The provider may still finish it and charge for it. Pass remove: true to take it off the list as well.',
  kind: 'write',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({ jobId: z.string().min(1).max(64), remove: z.boolean().optional() }),
  async run(ctx, args) {
    await ownJob(ctx, args.jobId);
    const job = await dismissAttentionJob(ctx.env, args.jobId, ctx.agent.user_id, args.remove === true);
    if (!job) throw new ToolError('not_found', 'No job with that id on this account.');
    return { structured: { job: jobView(job), removed: args.remove === true }, text: `Job ${job.id} is no longer tracked.` };
  },
});
