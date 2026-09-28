import { describe, expect, it, vi } from 'vitest';
import { acceptJob } from '../src/jobs';
import { agentEnv, connectProvider, OWNER, seedAgent, seedAsset, seedUser } from './agent-fixtures';
import { connectAgent, fakeTime, structured } from './mcp-harness';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function setup(settings = {}) {
  const create = vi.fn(async () => ({}));
  const { db, env, objects } = agentEnv({ CLOUD_GENERATION_PROVIDERS: 'atlas,fal,runware', GENERATION: { create, get: vi.fn() } as never });
  for (const provider of ['atlas', 'fal', 'runware']) connectProvider(db, provider);
  return { db, env, objects, create, agent: seedAgent(env, settings) };
}
const flux = { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell', mediaType: 'image', inputMode: 'text', prompt: 'a red kite' };
const jobs = (db: import('node:sqlite').DatabaseSync) => db.prepare('SELECT * FROM account_jobs').all() as Record<string, unknown>[];
const charges = (db: import('node:sqlite').DatabaseSync) => db.prepare('SELECT * FROM account_agent_charges').all() as Record<string, unknown>[];

describe('generate', () => {
  it('books the estimate, starts the job as this agent and dispatches it', async () => {
    const { db, env, create, agent } = setup();
    const client = await connectAgent(env, await agent);
    const result = await client.callTool({ name: 'generate', arguments: { ...flux, idempotencyKey: 'kite-1' } });
    expect(result.isError).toBeFalsy();
    const out = structured<{ job: { id: string; state: string }; estimate: { costUsd: number }; budget: { usedUsd: number } }>(result);
    expect(out.estimate.costUsd).toBeCloseTo(0.003);
    expect(out.budget.usedUsd).toBeCloseTo(0.003);
    expect(jobs(db)[0]).toMatchObject({ id: out.job.id, agent_id: (await agent).id, dispatched: 1 });
    expect(charges(db)[0]).toMatchObject({ job_id: out.job.id, estimate_micros: 3000, released: 0 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('starts one job and books one charge however often the same key is retried', async () => {
    const { db, env, create, agent } = setup();
    const client = await connectAgent(env, await agent);
    const first = structured<{ job: { id: string } }>(await client.callTool({ name: 'generate', arguments: { ...flux, idempotencyKey: 'kite-2' } }));
    const again = structured<{ job: { id: string } }>(await client.callTool({ name: 'generate', arguments: { ...flux, idempotencyKey: 'kite-2' } }));
    expect(again.job.id).toBe(first.job.id);
    expect(jobs(db)).toHaveLength(1);
    expect(charges(db)).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
    const conflict = await client.callTool({ name: 'generate', arguments: { ...flux, prompt: 'a blue kite', idempotencyKey: 'kite-2' } });
    expect(structured(conflict)).toMatchObject({ code: 'token_conflict' });
    expect(charges(db)[0]).toMatchObject({ released: 0 });
  });

  it('writes the model\'s defaults into the submitted request', async () => {
    // Unknown prices allowed so the assertion does not depend on whether Veo's
    // default resolution has a published rate; the budget is not what this tests.
    const { db, env, agent } = setup({ budgetUsd: 500, allowUnknownCost: true });
    const client = await connectAgent(env, await agent);
    await client.callTool({ name: 'generate', arguments: { provider: 'fal', modelId: 'veo-3-1', mediaType: 'video', inputMode: 'text', prompt: 'waves' } });
    expect(JSON.parse(String(jobs(db)[0].request_json)).values).toHaveProperty('duration');
  });

  it('refuses an unpriced model under a default grant, and runs it when allowed', async () => {
    const strict = setup();
    const refused = await (await connectAgent(strict.env, await strict.agent)).callTool({ name: 'generate', arguments: { provider: 'runware', modelId: 'runware:z-image@turbo', mediaType: 'image', inputMode: 'text', prompt: 'x' } });
    expect(structured(refused)).toMatchObject({ code: 'cost_unknown' });
    expect(jobs(strict.db)).toHaveLength(0);
    expect(charges(strict.db)).toHaveLength(0);
    const lenient = setup({ allowUnknownCost: true });
    const ran = await (await connectAgent(lenient.env, await lenient.agent)).callTool({ name: 'generate', arguments: { provider: 'runware', modelId: 'runware:z-image@turbo', mediaType: 'image', inputMode: 'text', prompt: 'x' } });
    expect(ran.isError).toBeFalsy();
    expect(charges(lenient.db)[0]).toMatchObject({ estimate_micros: null, confidence: 'unknown' });
  });

  it('says a run bigger than the whole limit will never fit', async () => {
    const { env, agent } = setup({ budgetUsd: 0.5 });
    const client = await connectAgent(env, await agent);
    const result = await client.callTool({ name: 'generate', arguments: { provider: 'atlas', modelId: 'bytedance/seedance-2.0-fast/text-to-video', mediaType: 'video', inputMode: 'text', prompt: 'x', values: { size: '720p', durationSeconds: 10 } } });
    expect(structured(result)).toMatchObject({ code: 'budget_exceeded', roomAt: null, estimateUsd: expect.closeTo(0.581, 6) });
    expect(JSON.stringify(result.content)).toMatch(/more than the whole limit/);
  });

  it('releases the charge when the Worker refuses the job', async () => {
    const { db, env, agent } = setup();
    const local = { provider: 'local-test' as const, modelId: 'local-test', mediaType: 'image' as const, inputMode: 'text' as const, prompt: 'p', values: {}, referenceIds: [] };
    for (let index = 0; index < 10; index++) await acceptJob(env, OWNER, `busy-token-${String(index).padStart(8, '0')}`, local);
    const result = await (await connectAgent(env, await agent)).callTool({ name: 'generate', arguments: flux });
    expect(structured(result)).toMatchObject({ code: 'active_jobs' });
    expect(charges(db)[0]).toMatchObject({ released: 1 });
  });

  // Review focus 2, the charge half.
  it('releases the charge when a reference cannot be used', async () => {
    const { db, env, agent } = setup();
    const result = await (await connectAgent(env, await agent)).callTool({ name: 'generate', arguments: { provider: 'atlas', modelId: 'bytedance/seedream-v5.0-pro/edit', mediaType: 'image', inputMode: 'image', prompt: 'x', references: [{ assetId: 'not-mine' }] } });
    expect(structured(result)).toMatchObject({ code: 'reference_unavailable' });
    expect(charges(db)[0]).toMatchObject({ released: 1 });
    expect(jobs(db)).toHaveLength(0);
  });

  // Controller decision 1: a copy resolveReferences made must not outlive a job
  // that never got created, or it would sit occupying an input slot for 24 hours.
  it('discards a copied library reference when acceptJob refuses the job afterwards', async () => {
    const { db, env, objects, agent } = setup();
    objects.set(seedAsset(db, { id: 'asset-1', jobId: null, bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    const local = { provider: 'local-test' as const, modelId: 'local-test', mediaType: 'image' as const, inputMode: 'text' as const, prompt: 'p', values: {}, referenceIds: [] };
    for (let index = 0; index < 10; index++) await acceptJob(env, OWNER, `busy-token-${String(index).padStart(8, '0')}`, local);
    const result = await (await connectAgent(env, await agent)).callTool({
      name: 'generate',
      arguments: { provider: 'atlas', modelId: 'bytedance/seedream-v5.0-pro/edit', mediaType: 'image', inputMode: 'image', prompt: 'x', references: [{ assetId: 'asset-1' }] },
    });
    expect(structured(result)).toMatchObject({ code: 'active_jobs' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM account_uploads WHERE state = 'ready'").get()).toEqual({ n: 0 });
    expect(charges(db)[0]).toMatchObject({ released: 1 });
  });
});

describe('get_job', () => {
  async function started() {
    const context = setup();
    const agent = await context.agent;
    const job = await acceptJob(context.env, OWNER, 'agent-job-token-0001', { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell', mediaType: 'image', inputMode: 'text', prompt: 'p', values: {}, referenceIds: [] }, agent.id);
    return { ...context, agent, job };
  }

  it('waits for the state to change and returns as soon as it does', async () => {
    const { db, env, agent, job } = await started();
    let sleeps = 0;
    const time = fakeTime(undefined, () => { sleeps += 1; if (sleeps === 2) db.prepare("UPDATE account_jobs SET state = 'running' WHERE id = ?").run(job.id); });
    const client = await connectAgent(env, agent, time.options);
    const result = structured<{ job: { state: string } }>(await client.callTool({ name: 'get_job', arguments: { jobId: job.id, waitSeconds: 25 } }));
    expect(result.job.state).toBe('running');
    expect(sleeps).toBe(2);
  });

  it('does not wait on a job that has already finished', async () => {
    const { db, env, agent, job } = await started();
    db.prepare("UPDATE account_jobs SET state = 'failed' WHERE id = ?").run(job.id);
    const sleep = vi.fn(async () => {});
    const client = await connectAgent(env, agent, { sleep });
    await client.callTool({ name: 'get_job', arguments: { jobId: job.id, waitSeconds: 25 } });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns a saved job\'s outputs with short-lived download links', async () => {
    const { db, env, agent, job } = await started();
    db.prepare("UPDATE account_jobs SET state = 'saved' WHERE id = ?").run(job.id);
    seedAsset(db, { id: 'out-1', jobId: job.id });
    const result = await (await connectAgent(env, agent)).callTool({ name: 'get_job', arguments: { jobId: job.id } });
    const out = structured<{ outputs: { assetId: string; downloadUrl: string }[] }>(result);
    expect(out.outputs).toEqual([expect.objectContaining({ assetId: 'out-1', downloadUrl: expect.stringMatching(/^http:\/\/localhost:8797\/media\/download\//) })]);
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'resource_link', name: 'out-1' })]));
  });

  it('does not show another account\'s job', async () => {
    const { db, env, agent } = await started();
    seedUser(db, 'other');
    const theirs = await acceptJob(env, 'other', 'other-token-00000001', { provider: 'local-test', modelId: 'local-test', mediaType: 'image', inputMode: 'text', prompt: 'p', values: {}, referenceIds: [] });
    const result = await (await connectAgent(env, agent)).callTool({ name: 'get_job', arguments: { jobId: theirs.id } });
    expect(structured(result)).toMatchObject({ code: 'not_found' });
  });

  // Review focus 1.
  it('finishes a wait begun before revocation, then refuses the next call', async () => {
    const { db, env, agent, job } = await started();
    const time = fakeTime(undefined, () => {
      db.prepare('UPDATE account_agents SET revoked_at = 1 WHERE id = ?').run(agent.id);
      db.prepare("UPDATE account_jobs SET state = 'running' WHERE id = ?").run(job.id);
    });
    const client = await connectAgent(env, agent, time.options);
    expect(structured<{ job: { state: string } }>(await client.callTool({ name: 'get_job', arguments: { jobId: job.id, waitSeconds: 10 } })).job.state).toBe('running');
    await expect(client.callTool({ name: 'get_job', arguments: { jobId: job.id } })).rejects.toThrow();
  });
});

describe('list_jobs', () => {
  it('filters by what the agent is waiting on', async () => {
    const { db, env, agent } = setup();
    const local = { provider: 'local-test' as const, modelId: 'local-test', mediaType: 'image' as const, inputMode: 'text' as const, prompt: 'p', values: {}, referenceIds: [] };
    const queued = await acceptJob(env, OWNER, 'list-token-00000001', local);
    const saved = await acceptJob(env, OWNER, 'list-token-00000002', local);
    db.prepare("UPDATE account_jobs SET state = 'saved' WHERE id = ?").run(saved.id);
    const client = await connectAgent(env, await agent);
    const ids = async (state: string) => structured<{ jobs: { id: string }[] }>(await client.callTool({ name: 'list_jobs', arguments: { state } })).jobs.map(job => job.id);
    expect(await ids('active')).toEqual([queued.id]);
    expect(await ids('finished')).toEqual([saved.id]);
    expect((await ids('all')).sort()).toEqual([queued.id, saved.id].sort());
  });
});
