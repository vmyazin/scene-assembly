import { describe, expect, it, vi } from 'vitest';
import { acceptJob } from '../src/jobs';
import { reserveCharge, attachCharge } from '../src/mcp/budget';
import { agentEnv, connectProvider, OWNER, seedAgent, seedUser } from './agent-fixtures';
import { connectAgent, structured } from './mcp-harness';

const local = { provider: 'local-test' as const, modelId: 'local-test', mediaType: 'image' as const, inputMode: 'text' as const, prompt: 'p', values: {}, referenceIds: [] };
async function setup() {
  const create = vi.fn(async () => ({}));
  const { db, env } = agentEnv({ CLOUD_GENERATION_PROVIDERS: 'atlas', GENERATION: { create, get: vi.fn() } as never });
  connectProvider(db, 'atlas');
  const agent = await seedAgent(env);
  return { db, env, create, agent, client: await connectAgent(env, agent) };
}

describe('job control', () => {
  it('cancels a queued job and frees its charge', async () => {
    const { db, env, agent, client } = await setup();
    await reserveCharge(env, agent, 'control-token-000001', { costUsd: 1, confidence: 'estimated' });
    const job = await acceptJob(env, OWNER, 'control-token-000001', local, agent.id);
    await attachCharge(env, 'control-token-000001', job.id);
    expect(structured(await client.callTool({ name: 'cancel_job', arguments: { jobId: job.id } }))).toMatchObject({ job: { state: 'cancelled' } });
    expect(db.prepare('SELECT released FROM account_agent_charges').get()).toEqual({ released: 1 });
  });

  it('will not cancel a job the provider already has', async () => {
    const { db, env, client } = await setup();
    const job = await acceptJob(env, OWNER, 'control-token-000002', local);
    db.prepare("UPDATE account_jobs SET state = 'running', provider_task = 'task' WHERE id = ?").run(job.id);
    expect(structured(await client.callTool({ name: 'cancel_job', arguments: { jobId: job.id } }))).toMatchObject({ code: 'generation_started' });
  });

  it('resumes a recoverable job and dispatches it again', async () => {
    const { db, env, create, client } = await setup();
    const job = await acceptJob(env, OWNER, 'control-token-000003', local);
    db.prepare("UPDATE account_jobs SET state = 'needs_attention', provider_task = 'task', failure_reason = 'worker_interrupted' WHERE id = ?").run(job.id);
    expect(structured(await client.callTool({ name: 'resume_job', arguments: { jobId: job.id } }))).toMatchObject({ job: { state: 'running', attempts: 1 } });
    expect(create).toHaveBeenCalled();
  });

  it('refuses to resume what trying again cannot fix', async () => {
    const { db, env, client } = await setup();
    const job = await acceptJob(env, OWNER, 'control-token-000004', local);
    db.prepare("UPDATE account_jobs SET state = 'needs_attention', provider_task = 'task', failure_reason = 'result_link_expired' WHERE id = ?").run(job.id);
    expect(structured(await client.callTool({ name: 'resume_job', arguments: { jobId: job.id } }))).toMatchObject({ code: 'unrecoverable', retryable: false });
  });

  it('stops tracking a stuck job and can remove it', async () => {
    const { db, env, client } = await setup();
    const job = await acceptJob(env, OWNER, 'control-token-000005', local);
    db.prepare("UPDATE account_jobs SET state = 'needs_attention' WHERE id = ?").run(job.id);
    expect(structured(await client.callTool({ name: 'dismiss_job', arguments: { jobId: job.id, remove: true } }))).toMatchObject({ removed: true });
    expect(db.prepare('SELECT deleted FROM account_jobs WHERE id = ?').get(job.id)).toEqual({ deleted: 1 });
  });

  it('never touches another account\'s job', async () => {
    const { db, env, client } = await setup();
    seedUser(db, 'other');
    const theirs = await acceptJob(env, 'other', 'control-token-000006', local);
    for (const name of ['cancel_job', 'resume_job', 'dismiss_job']) {
      expect(structured(await client.callTool({ name, arguments: { jobId: theirs.id } })), name).toMatchObject({ code: 'not_found' });
    }
  });
});
