// cloud/src/mcp/tools/jobs.ts
import * as z from 'zod';
import { jobInputIds, type CloudJobRequest, type CloudJobState } from '../../../../lib/account/contracts';
import { estimateCloudJob } from '../../../../lib/spend/estimate';
import { jobAssets } from '../../assets';
import { acceptJob, AccountError, cancelQueuedJob, dismissAttentionJob, dispatchJob, getJob, jobView, resultDraftId, type JobRow } from '../../jobs';
import { enabledProviders, validateRequest } from '../../providers';
import { isSeedance25, seedanceDraftSeconds, seedanceFinalizeValuesError } from '../../../../lib/providers/seedance-draft';
import { listJobs, resumeJob } from '../../job-routes';
import { mediaAccess } from '../../media';
import { hash, randomToken } from '../../security';
import { discardUploads } from '../../uploads';
import { attachCharge, budgetStatus, dropCharge, reserveCharge } from '../budget';
import { ToolError } from '../errors';
import { defineTool, type ToolContext } from '../tool';
import { resolveReferences } from './references';
import { budgetRefusal, connectedProviders, prepareRequest, requestShape } from './request';
import { priceEditSource } from './source-duration';

const TERMINAL: CloudJobState[] = ['saved', 'failed', 'cancelled'];
const POLL_MS = 2000;

/** Scoped to the agent, so two agents choosing the same key never collide. */
export async function agentJobToken(agentId: string, idempotencyKey?: string) {
  return idempotencyKey ? hash(`agent:${agentId}:${idempotencyKey}`) : randomToken();
}

/** A retry with the same key is the same run if everything but the freshly copied reference ids matches. */
function sameRun(saved: CloudJobRequest, next: CloudJobRequest) {
  const shape = (request: CloudJobRequest) => JSON.stringify([request.provider, request.modelId, request.mediaType, request.inputMode, request.prompt,
    Object.entries(request.values).sort(([a], [b]) => a.localeCompare(b)), request.referenceIds.length, request.referenceVideoIds?.length ?? 0, request.referenceAudioIds?.length ?? 0, Boolean(request.sourceVideoId)]);
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

interface StagedRequest { request: CloudJobRequest; copiedIds: string[]; ownJob?: (job: JobRow) => boolean }

/**
 * The reservation, accept, and failure protocol shared by generate and
 * finalize_draft.
 *
 * dropCharge (never releaseCharge) deletes a reservation whose job was never
 * made, so the same idempotency key can book a fresh charge. A staged upload
 * id is never in copiedIds. Once acceptJob has returned a job, the charge and
 * any copies belong to it.
 *
 * acceptJob can throw after its write committed. The re-read that recognizes
 * that job is guarded: if the read itself throws, the original error is
 * rethrown and nothing is dropped. finalize_draft used to skip that guard, so
 * a thrown re-read left the reservation in place.
 */
async function submitPrepared(
  ctx: ToolContext,
  request: CloudJobRequest,
  estimate: ReturnType<typeof estimateCloudJob>,
  idempotencyKey: string | undefined,
  materialize: () => Promise<StagedRequest>,
) {
  const { env, agent } = ctx;
  const token = await agentJobToken(agent.id, idempotencyKey);
  const existing = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?').bind(agent.user_id, token).first<JobRow>();
  if (existing) return resumeExistingJob(ctx, existing, request, estimate);
  const outcome = await reserveCharge(env, agent, token, estimate, ctx.now());
  if (!outcome.ok) throw budgetRefusal(outcome, estimate);
  if (!outcome.created) {
    const job = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?').bind(agent.user_id, token).first<JobRow>();
    if (job) return resumeExistingJob(ctx, job, request, estimate);
    throw new AccountError('A request with this idempotencyKey is still starting. Retry in a few seconds, or call list_jobs.', 425, 'request_in_progress');
  }

  let staged: StagedRequest;
  try {
    staged = await materialize();
  } catch (error) {
    if (outcome.created) await dropCharge(env, token).catch(() => {});
    throw error;
  }
  const owns = staged.ownJob ?? ((job: JobRow) => jobUsesAnyOf(job, staged.copiedIds));

  let job: JobRow;
  try {
    job = await acceptJob(env, agent.user_id, token, staged.request, agent.id);
  } catch (error) {
    let reread: JobRow | null;
    try {
      reread = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?').bind(agent.user_id, token).first<JobRow>() ?? null;
    } catch {
      throw error;
    }
    if (reread && owns(reread)) {
      await attachCharge(env, token, reread.id);
      if (!reread.dispatched) await dispatchJob(env, reread).catch(() => {});
      return started(ctx, (await getJob(env, reread.id, agent.user_id)) ?? reread, estimate);
    }
    if (reread) {
      if (staged.copiedIds.length) await discardUploads(env, agent.user_id, staged.copiedIds).catch(() => {});
      if (sameRun(JSON.parse(reread.request_json), request)) return started(ctx, reread, estimate);
      throw error;
    }
    if (outcome.created) await dropCharge(env, token).catch(() => {});
    if (staged.copiedIds.length) await discardUploads(env, agent.user_id, staged.copiedIds).catch(() => {});
    throw error;
  }

  await attachCharge(env, token, job.id);
  if (!job.dispatched) await dispatchJob(env, job).catch(() => {});
  return started(ctx, (await getJob(env, job.id, agent.user_id)) ?? job, estimate);
}

export const generate = defineTool({
  name: 'generate',
  title: 'Generate an image or video',
  description: 'Start a background image or video job with this account\'s connected provider key. It returns at once with a job; call get_job with waitSeconds to follow it. Settings left out take the model\'s defaults, written into the request so the price and the run match. The estimate is charged against this agent\'s 24-hour spend limit before the job starts. Pass an idempotencyKey (any string you choose, reused on retry) so a retried call cannot start and pay for a second job.',
  kind: 'submit',
  // Not idempotent as such: only a call that passes an idempotencyKey is, and a
  // client trusting the hint could retry a keyless call into a second paid job.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  input: z.object({ ...requestShape, idempotencyKey: z.string().min(1).max(200).optional() }),
  async run(ctx, args) {
    const prepared = await prepareRequest(ctx, args);
    // Measured before the reserve. An agent-supplied length is only a check.
    const request = await priceEditSource(ctx, prepared.request, args.sourceVideo);
    const estimate = estimateCloudJob(request);
    if (request.inputMode === 'edit' && request.values.draft === true && isSeedance25(request.modelId) && estimate.costUsd === null) {
      throw new ToolError('invalid_field', 'This Seedance draft could not be priced from the source clip, so it was not reserved.', { field: 'sourceVideo' });
    }
    return submitPrepared(ctx, request, estimate, args.idempotencyKey, async () => {
      const references = await resolveReferences(ctx, args.references, args.sourceVideo, args.referenceVideos, args.referenceAudios);
      return {
        request: {
          ...request,
          referenceIds: references.referenceIds,
          ...(references.sourceVideoId ? { sourceVideoId: references.sourceVideoId } : {}),
          ...(references.referenceVideoIds.length ? { referenceVideoIds: references.referenceVideoIds } : {}),
          ...(references.referenceAudioIds.length ? { referenceAudioIds: references.referenceAudioIds } : {}),
        },
        copiedIds: references.copiedIds,
      };
    });
  },
});

export const finalizeDraft = defineTool({
  name: 'finalize_draft',
  title: 'Finalize a Seedance draft',
  description: 'Render one Seedance 2.5 480p draft at 1080p. This starts a new job and a separate charge against the 24-hour limit. The estimate uses the documented 1080p rate, because Runware does not publish a finalize price. Pass the draft job\'s jobId (the length is taken from that job; a different durationSeconds is refused) or its draftId, inputMode, and durationSeconds. Do not resend the prompt or any media. Pass an idempotencyKey you reuse when retrying the same finalize.',
  kind: 'submit',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  input: z.object({
    jobId: z.string().min(1).max(64).optional(),
    draftId: z.string().min(1).max(256).optional(),
    durationSeconds: z.number().min(4).max(30).optional(),
    inputMode: z.enum(['text', 'image', 'frames', 'reference', 'edit']).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  }).strict(),
  async run(ctx, args) {
    const { env, agent } = ctx;
    if (!enabledProviders(env).includes('runware')) throw new ToolError('provider_unavailable', 'Runware is not available for background generation.');
    if (!(await connectedProviders(env, agent.user_id)).includes('runware')) {
      throw new ToolError('connection_required', 'Ask the person to connect a Runware key on their Scene Assembly account page. Agents cannot add keys.');
    }
    let prompt = 'Finalize Seedance draft';
    let inputMode = args.inputMode;
    let draftId = args.draftId?.trim();
    let modelId = 'bytedance:seedance@2.5';
    let durationSeconds = args.durationSeconds;
    if (args.jobId) {
      const savedJob = await getJob(env, args.jobId, agent.user_id);
      if (!savedJob) throw new ToolError('not_found', 'No job with that id on this account.');
      const saved = JSON.parse(savedJob.request_json) as CloudJobRequest;
      const fromResult = resultDraftId(savedJob.result_json);
      if (!isSeedance25(saved.modelId) || saved.provider !== 'runware' || saved.mediaType !== 'video') {
        throw new ToolError('draft_unavailable', 'Only a Seedance 2.5 draft on Runware can be finalized.');
      }
      if (!fromResult && !draftId) throw new ToolError('draft_unavailable', 'That job has no Seedance draft to finalize. Generate a 480p draft first.');
      if (draftId && fromResult && draftId !== fromResult) throw new ToolError('invalid_field', 'That draft ID does not belong to this job.', { field: 'draftId' });
      if (args.inputMode && args.inputMode !== saved.inputMode) throw new ToolError('invalid_field', 'inputMode is taken from the draft job.', { field: 'inputMode' });
      const savedSeconds = seedanceDraftSeconds(saved.values);
      if (savedSeconds === undefined) {
        throw new ToolError('draft_unavailable', 'That draft has no saved length, so it cannot be priced. Generate a new 480p draft.');
      }
      if (args.durationSeconds !== undefined && Math.abs(args.durationSeconds - savedSeconds) > 1) {
        throw new ToolError('invalid_field', `That draft is ${savedSeconds} seconds. Finalize is priced from the saved length, not ${args.durationSeconds}.`, { field: 'durationSeconds' });
      }
      durationSeconds = savedSeconds;
      draftId = fromResult ?? draftId;
      inputMode = saved.inputMode;
      modelId = saved.modelId;
      if (saved.prompt.trim()) prompt = saved.prompt.trim();
    }
    if (!draftId) throw new ToolError('invalid_field', 'Pass the draft jobId, or the draftId from that job.', { field: 'draftId' });
    if (!inputMode) throw new ToolError('invalid_field', 'Pass inputMode when you pass a draftId without a jobId, so the price uses the right 1080p rate.', { field: 'inputMode' });
    if (durationSeconds === undefined) {
      throw new ToolError('invalid_field', 'Pass durationSeconds when you pass a draftId without a jobId, from 4 to 30 seconds.', { field: 'durationSeconds' });
    }
    const valuesError = seedanceFinalizeValuesError({ finalize: true, draftId, durationSeconds });
    if (valuesError) throw new ToolError('invalid_field', valuesError, { field: 'durationSeconds' });
    const request: CloudJobRequest = {
      provider: 'runware', modelId, mediaType: 'video', inputMode, prompt,
      values: { finalize: true, draftId, durationSeconds },
      referenceIds: [],
    };
    validateRequest(env, request);
    const estimate = estimateCloudJob(request);
    return submitPrepared(ctx, request, estimate, args.idempotencyKey, async () => ({
      request, copiedIds: [], ownJob: (job) => sameRun(JSON.parse(job.request_json), request),
    }));
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
      text: `${job.state === 'saved' ? `Job ${job.id} is saved with ${outputs.length} output${outputs.length === 1 ? '' : 's'}. Call view_asset to look at one.` : `Job ${job.id} is ${job.state}.`}${jobView(job).draftId ? ` draftId is ${jobView(job).draftId}. Call finalize_draft to render it at 1080p; that is a separate charge.` : ''}`,
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

export const listJobsTool = defineTool({
  name: 'list_jobs',
  title: 'List jobs',
  description: 'This account\'s most recent jobs, newest first, including ones started in the browser. Filter by state: active (still running), needs_attention (stopped and waiting on a decision), finished, or all.',
  kind: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({ state: z.enum(['active', 'needs_attention', 'finished', 'all']).optional(), limit: z.number().int().min(1).max(100).optional() }),
  async run(ctx, { state = 'all', limit = 20 }) {
    const jobs = await listJobs(ctx.env, ctx.agent.user_id, { states: state === 'all' ? null : LIST_STATES[state], limit });
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
