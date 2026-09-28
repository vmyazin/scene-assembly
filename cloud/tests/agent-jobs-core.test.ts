import { describe, expect, it } from 'vitest';
import { acceptJob } from '../src/jobs';
import { listAssets, resumeJob } from '../src/job-routes';
import { jobAssets } from '../src/assets';
import { listSpend, spendTotals } from '../src/spend';
import { readAccountBilling } from '../src/provider-billing';
import { attachCharge, reserveCharge } from '../src/mcp/budget';
import type { CloudJobRequest } from '../../lib/account/contracts';
import { accountCall, agentEnv, OWNER, seedAgent, seedAsset, signIn } from './agent-fixtures';

const request: CloudJobRequest = { provider: 'local-test', modelId: 'local-test', mediaType: 'image', inputMode: 'text', prompt: 'a kite', values: {}, referenceIds: [] };

describe('agent provenance', () => {
  it('records which agent started a job and lists it by name', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    const byAgent = await acceptJob(env, OWNER, 'agent-token-000000001', request, agent.id);
    const byBrowser = await acceptJob(env, OWNER, 'browser-token-00000001', request);
    expect(byAgent.agent_id).toBe(agent.id);
    const { jobs } = await (await accountCall(env, 'jobs', 'GET', await signIn(env))).json();
    expect(jobs.find((job: { id: string }) => job.id === byAgent.id).startedBy).toEqual({ agentId: agent.id, name: 'Claude Code' });
    expect(jobs.find((job: { id: string }) => job.id === byBrowser.id)).not.toHaveProperty('startedBy');
  });

  it('keeps the name of an agent that has since been disconnected, on jobs and on assets', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    const job = await acceptJob(env, OWNER, 'agent-token-000000002', request, agent.id);
    seedAsset(db, { id: 'asset-1', jobId: job.id });
    db.prepare('UPDATE account_agents SET revoked_at = 1').run();
    const { assets } = await listAssets(env, OWNER, { kind: null, cursor: null, temporaryOnly: false });
    expect(assets[0].startedBy).toEqual({ agentId: agent.id, name: 'Claude Code' });
    expect((await (await accountCall(env, 'assets', 'GET', await signIn(env))).json()).assets[0].startedBy).toEqual({ agentId: agent.id, name: 'Claude Code' });
  });

  it('lists the outputs a job saved', async () => {
    const { db, env } = agentEnv();
    const job = await acceptJob(env, OWNER, 'agent-token-000000003', request);
    seedAsset(db, { id: 'out-1', jobId: job.id });
    seedAsset(db, { id: 'other', jobId: null });
    expect((await jobAssets(env, OWNER, job.id)).map(asset => asset.id)).toEqual(['out-1']);
  });
});

describe('charges follow cancellation wherever it comes from', () => {
  it('releases the charge when the browser cancels a queued agent job', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    const token = 'agent-token-000000004';
    await reserveCharge(env, agent, token, { costUsd: 1, confidence: 'estimated' });
    const job = await acceptJob(env, OWNER, token, request, agent.id);
    await attachCharge(env, token, job.id);
    expect((await accountCall(env, `jobs/${job.id}/cancel`, 'POST', await signIn(env))).status).toBe(200);
    expect(db.prepare('SELECT released FROM account_agent_charges').get()).toEqual({ released: 1 });
  });

  it('keeps the charge when the job had already started', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    const token = 'agent-token-000000005';
    await reserveCharge(env, agent, token, { costUsd: 1, confidence: 'estimated' });
    const job = await acceptJob(env, OWNER, token, request, agent.id);
    await attachCharge(env, token, job.id);
    db.prepare("UPDATE account_jobs SET state = 'running', provider_task = 'task-1' WHERE id = ?").run(job.id);
    expect((await accountCall(env, `jobs/${job.id}/cancel`, 'POST', await signIn(env))).status).toBe(409);
    expect(db.prepare('SELECT released FROM account_agent_charges').get()).toEqual({ released: 0 });
  });
});

describe('shared route functions', () => {
  it('refuses a resume with a code an agent can read', async () => {
    const { env } = agentEnv();
    const job = await acceptJob(env, OWNER, 'agent-token-000000006', request);
    await expect(resumeJob(env, job, OWNER)).rejects.toMatchObject({ code: 'reconciliation_required', status: 409 });
  });

  it('reads spend and billing the way the routes do', async () => {
    const { env } = agentEnv();
    expect(await listSpend(env, OWNER, null)).toEqual({ entries: [], nextCursor: null });
    expect(await spendTotals(env, OWNER)).toMatchObject({ costUsd: 0, runs: 0 });
    expect(await readAccountBilling(env, OWNER)).toEqual([]);
    await expect(listSpend(env, OWNER, 'not-a-cursor')).rejects.toMatchObject({ status: 400 });
  });
});
