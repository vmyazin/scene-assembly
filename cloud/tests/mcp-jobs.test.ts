import { describe, expect, it, vi } from 'vitest';
import { acceptJob } from '../src/jobs';
import { storeUpload } from '../src/uploads';
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
const seedreamEdit = (references: { assetId?: string; uploadId?: string }[]) =>
  ({ provider: 'atlas', modelId: 'bytedance/seedream-v5.0-pro/edit', mediaType: 'image', inputMode: 'image', prompt: 'x', references });
const local = { provider: 'local-test' as const, modelId: 'local-test', mediaType: 'image' as const, inputMode: 'text' as const, prompt: 'p', values: {}, referenceIds: [] };
const fillActiveJobs = (env: import('../src/security').Env) =>
  Promise.all(Array.from({ length: 10 }, (_, index) => acceptJob(env, OWNER, `busy-token-${String(index).padStart(8, '0')}`, local)));
const jobs = (db: import('node:sqlite').DatabaseSync) => db.prepare('SELECT * FROM account_jobs').all() as Record<string, unknown>[];
const charges = (db: import('node:sqlite').DatabaseSync) => db.prepare('SELECT * FROM account_agent_charges').all() as Record<string, unknown>[];
const readyUploads = (db: import('node:sqlite').DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n FROM account_uploads WHERE state = 'ready'").get() as { n: number }).n;

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

  it('drops the charge, booking nothing, when the Worker refuses the job before acceptance', async () => {
    const { db, env, agent } = setup();
    await fillActiveJobs(env);
    const result = await (await connectAgent(env, await agent)).callTool({ name: 'generate', arguments: flux });
    expect(structured(result)).toMatchObject({ code: 'active_jobs' });
    expect(charges(db)).toHaveLength(0);
  });

  // Review focus 2, the charge half.
  it('drops the charge, booking nothing, when a reference cannot be used', async () => {
    const { db, env, agent } = setup();
    const result = await (await connectAgent(env, await agent)).callTool({ name: 'generate', arguments: seedreamEdit([{ assetId: 'not-mine' }]) });
    expect(structured(result)).toMatchObject({ code: 'reference_unavailable' });
    expect(charges(db)).toHaveLength(0);
    expect(jobs(db)).toHaveLength(0);
  });

  // Controller decision 1: a copy resolveReferences made must not outlive a job
  // that never got created, or it would sit occupying an input slot for 24 hours.
  it('discards a copied library reference when acceptJob refuses the job afterwards', async () => {
    const { db, env, objects, agent } = setup();
    objects.set(seedAsset(db, { id: 'asset-1', jobId: null, bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    await fillActiveJobs(env);
    const result = await (await connectAgent(env, await agent)).callTool({ name: 'generate', arguments: seedreamEdit([{ assetId: 'asset-1' }]) });
    expect(structured(result)).toMatchObject({ code: 'active_jobs' });
    expect(readyUploads(db)).toBe(0);
    expect(charges(db)).toHaveLength(0);
  });

  // Fix round 1, Finding 1: the reviewer's exact probe. A refusal before
  // acceptance must drop its charge outright, not release it — release leaves
  // the row present, and reserveCharge's "same reservation" fallback used to
  // accept any present row for that id without rechecking the budget, so a
  // retry with the same key under a request that never fits ran uncharged.
  it('refuses a retried key with a bigger request after an earlier refusal, rather than skipping the budget', async () => {
    const { db, env, agent } = setup({ budgetUsd: 0.5 });
    const client = await connectAgent(env, await agent);
    const first = await client.callTool({ name: 'generate', arguments: { ...seedreamEdit([{ assetId: 'not-mine' }]), idempotencyKey: 'retry-key' } });
    expect(structured(first)).toMatchObject({ code: 'reference_unavailable' });
    expect(charges(db)).toHaveLength(0);
    const second = await client.callTool({ name: 'generate', arguments: { provider: 'atlas', modelId: 'bytedance/seedance-2.0-fast/text-to-video', mediaType: 'video', inputMode: 'text', prompt: 'x', values: { size: '720p', durationSeconds: 10 }, idempotencyKey: 'retry-key' } });
    expect(structured(second)).toMatchObject({ code: 'budget_exceeded' });
    expect(jobs(db)).toHaveLength(0);
    expect(charges(db)).toHaveLength(0);
  });

  it('books exactly one fresh charge when the same key is retried after an earlier refusal', async () => {
    const { db, env, agent } = setup();
    const client = await connectAgent(env, await agent);
    const refused = await client.callTool({ name: 'generate', arguments: { ...seedreamEdit([{ assetId: 'not-mine' }]), idempotencyKey: 'retry-fit' } });
    expect(structured(refused)).toMatchObject({ code: 'reference_unavailable' });
    const retried = await client.callTool({ name: 'generate', arguments: { ...flux, idempotencyKey: 'retry-fit' } });
    expect(retried.isError).toBeFalsy();
    expect(jobs(db)).toHaveLength(1);
    expect(charges(db)).toHaveLength(1);
    expect(charges(db)[0]).toMatchObject({ released: 0 });
  });

  it('refuses a retried key whose job was removed, and books no new charge', async () => {
    const { db, env, agent } = setup();
    const client = await connectAgent(env, await agent);
    const first = structured<{ job: { id: string } }>(await client.callTool({ name: 'generate', arguments: { ...flux, idempotencyKey: 'removed-key' } }));
    db.prepare("UPDATE account_jobs SET deleted = 1, state = 'failed' WHERE id = ?").run(first.job.id);
    const before = charges(db).length;
    const retried = await client.callTool({ name: 'generate', arguments: { ...flux, idempotencyKey: 'removed-key' } });
    expect(structured(retried)).toMatchObject({ code: 'token_conflict' });
    expect(charges(db)).toHaveLength(before);
  });

  // Fix round 1, Finding 2: once acceptJob has returned a job, nothing below
  // may drop the charge or discard its inputs — a transient failure attaching,
  // dispatching, or reading the job back must leave a live job's money and
  // inputs alone. Stub attachCharge's own UPDATE to throw and confirm neither
  // is undone.
  it('leaves an accepted job\'s charge and inputs alone when attaching it afterwards fails', async () => {
    const { db, env, objects, agent } = setup();
    objects.set(seedAsset(db, { id: 'asset-attach', jobId: null, bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    const originalPrepare = env.DB.prepare.bind(env.DB);
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation(((query: string) => {
      if (query.startsWith('UPDATE account_agent_charges SET job_id')) throw new Error('boom');
      return originalPrepare(query);
    }) as typeof env.DB.prepare);
    const result = await (await connectAgent(env, await agent)).callTool({ name: 'generate', arguments: seedreamEdit([{ assetId: 'asset-attach' }]) });
    spy.mockRestore();
    expect(result.isError).toBe(true);
    expect(jobs(db)).toHaveLength(1);
    expect(charges(db)[0]).toMatchObject({ released: 0, job_id: null });
    expect(readyUploads(db)).toBe(1);
  });

  // Controller decision 1 (unchanged by this round): a staged { uploadId } is
  // never in copiedIds, so a refusal must never touch it.
  it('leaves a staged uploadId reference untouched when the job is refused', async () => {
    const { db, env, agent } = setup();
    const staged = await storeUpload(env, OWNER, PNG, PNG.length, 'image/png');
    await fillActiveJobs(env);
    const result = await (await connectAgent(env, await agent)).callTool({ name: 'generate', arguments: seedreamEdit([{ uploadId: staged.id }]) });
    expect(structured(result)).toMatchObject({ code: 'active_jobs' });
    expect(db.prepare('SELECT state FROM account_uploads WHERE id = ?').get(staged.id)).toEqual({ state: 'ready' });
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

  // Fix round 1: a job removed mid-wait must be reported as gone, not returned
  // with its last-known (now stale) state.
  it('refuses when the job is removed mid-wait', async () => {
    const { db, env, agent, job } = await started();
    const time = fakeTime(undefined, () => { db.prepare('UPDATE account_jobs SET deleted = 1 WHERE id = ?').run(job.id); });
    const client = await connectAgent(env, agent, time.options);
    const result = await client.callTool({ name: 'get_job', arguments: { jobId: job.id, waitSeconds: 10 } });
    expect(structured(result)).toMatchObject({ code: 'not_found' });
  });
});

describe('list_jobs', () => {
  it('filters by what the agent is waiting on', async () => {
    const { db, env, agent } = setup();
    const queued = await acceptJob(env, OWNER, 'list-token-00000001', local);
    const saved = await acceptJob(env, OWNER, 'list-token-00000002', local);
    db.prepare("UPDATE account_jobs SET state = 'saved' WHERE id = ?").run(saved.id);
    const client = await connectAgent(env, await agent);
    const ids = async (state: string) => structured<{ jobs: { id: string }[] }>(await client.callTool({ name: 'list_jobs', arguments: { state } })).jobs.map(job => job.id);
    expect(await ids('active')).toEqual([queued.id]);
    expect(await ids('finished')).toEqual([saved.id]);
    expect((await ids('all')).sort()).toEqual([queued.id, saved.id].sort());
  });

  // Fix round 1: the state filter has to run in SQL before LIMIT, or an old
  // match can be crowded out by newer non-matching rows before it is ever
  // considered.
  it('finds a needs_attention job older than the 100 newest', async () => {
    const { db, env, agent } = setup();
    const insert = db.prepare(`INSERT INTO account_jobs (id,user_id,request_token,request_digest,provider,request_json,reservation_bytes,created_at,updated_at,state)
      VALUES (?,?,?,?, 'atlas', '{}', 1, ?, ?, ?)`);
    insert.run('old-attn', OWNER, 'old-attn-token', 'd0', 1, 1, 'needs_attention');
    for (let index = 0; index < 100; index++) insert.run(`recent-${index}`, OWNER, `recent-token-${index}`, `d${index + 1}`, 1000 + index, 1000 + index, 'queued');
    const client = await connectAgent(env, await agent);
    const result = structured<{ jobs: { id: string }[] }>(await client.callTool({ name: 'list_jobs', arguments: { state: 'needs_attention' } }));
    expect(result.jobs.map(job => job.id)).toEqual(['old-attn']);
  });
});
