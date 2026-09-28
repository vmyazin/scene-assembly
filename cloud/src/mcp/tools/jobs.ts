import * as z from 'zod';
import type { CloudJobRequest, CloudJobState } from '../../../../lib/account/contracts';
import { estimateCloudJob } from '../../../../lib/spend/estimate';
import { jobAssets } from '../../assets';
import { acceptJob, AccountError, dispatchJob, getJob, jobView, type JobRow } from '../../jobs';
import { mediaAccess } from '../../media';
import { hash, randomToken } from '../../security';
import { discardUploads } from '../../uploads';
import { attachCharge, budgetStatus, releaseCharge, reserveCharge } from '../budget';
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
    const existing = await env.DB.prepare('SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ? AND deleted = 0').bind(agent.user_id, token).first<JobRow>();
    if (existing) {
      if (!sameRun(JSON.parse(existing.request_json), prepared.request)) throw new AccountError('Submission token already used.', 409, 'token_conflict');
      return started(ctx, existing, estimate);
    }
    const outcome = await reserveCharge(env, agent, token, estimate, ctx.now());
    if (!outcome.ok) throw budgetRefusal(outcome, estimate);
    // References resolved (and possibly copied from the library) only reach a
    // job that actually gets created; a copy this call made is tracked here so
    // a refusal below (acceptJob throwing after a successful resolve) can
    // discard it rather than leave it occupying an input slot for 24 hours. A
    // staged { uploadId } the agent already owns is never in copiedIds, so it
    // is never touched here.
    let references: Awaited<ReturnType<typeof resolveReferences>> | undefined;
    try {
      references = await resolveReferences(ctx, args.references, args.sourceVideo);
      const request: CloudJobRequest = {
        provider: prepared.request.provider, modelId: prepared.request.modelId, mediaType: prepared.request.mediaType,
        inputMode: prepared.request.inputMode, prompt: prepared.request.prompt, values: prepared.request.values,
        referenceIds: references.referenceIds, ...(references.sourceVideoId ? { sourceVideoId: references.sourceVideoId } : {}),
      };
      const job = await acceptJob(env, agent.user_id, token, request, agent.id);
      await attachCharge(env, token, job.id);
      // Acceptance is durable even when dispatch fails; scheduled reconciliation repairs it.
      if (!job.dispatched) await dispatchJob(env, job).catch(() => {});
      return started(ctx, (await getJob(env, job.id, agent.user_id)) ?? job, estimate);
    } catch (error) {
      if (outcome.created) await releaseCharge(env, token);
      if (references?.copiedIds.length) await discardUploads(env, agent.user_id, references.copiedIds);
      throw error;
    }
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
    let job = await getJob(ctx.env, jobId, owner);
    if (!job) throw new ToolError('not_found', 'No job with that id on this account.');
    const from = job.state;
    const deadline = ctx.now() + waitSeconds * 1000;
    while (!TERMINAL.includes(job.state) && job.state === from && ctx.now() < deadline) {
      await ctx.sleep(Math.min(POLL_MS, deadline - ctx.now()));
      job = (await getJob(ctx.env, jobId, owner)) ?? job;
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
    const rows = await ctx.env.DB.prepare('SELECT j.*, g.client_name AS agent_name FROM account_jobs j LEFT JOIN account_agents g ON g.id = j.agent_id WHERE j.user_id = ? AND j.deleted = 0 ORDER BY j.created_at DESC LIMIT 100')
      .bind(ctx.agent.user_id).all<JobRow>();
    const jobs = rows.results.filter(row => state === 'all' || LIST_STATES[state].includes(row.state)).slice(0, limit).map(jobView);
    return { structured: { jobs }, text: `${jobs.length} job${jobs.length === 1 ? '' : 's'}.` };
  },
});
