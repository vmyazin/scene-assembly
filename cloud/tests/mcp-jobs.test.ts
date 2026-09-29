import { describe, expect, it, vi } from 'vitest';
import { acceptJob } from '../src/jobs';
import { reserveCharge } from '../src/mcp/budget';
import { agentJobToken } from '../src/mcp/tools/jobs';
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
const fluxRequestJson = () => JSON.stringify({ ...flux, values: {}, referenceIds: [] });
const seedance = { provider: 'atlas', modelId: 'bytedance/seedance-2.0-fast/text-to-video', mediaType: 'video', inputMode: 'text', prompt: 'x', values: { size: '720p', durationSeconds: 10 } };
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

  it('names the agent that started the job in generate and get_job, as list_jobs does', async () => {
    const { env, agent } = setup();
    const client = await connectAgent(env, await agent);
    const started = structured<{ job: { id: string; startedBy: { agentId: string; name: string | null } } }>(
      await client.callTool({ name: 'generate', arguments: { ...flux, idempotencyKey: 'kite-named' } }));
    expect(started.job.startedBy).toEqual({ agentId: (await agent).id, name: 'Claude Code' });
    const fetched = structured<{ job: { startedBy: { name: string | null } } }>(
      await client.callTool({ name: 'get_job', arguments: { jobId: started.job.id } }));
    expect(fetched.job.startedBy.name).toBe('Claude Code');
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

  // Fix round 2, the open Critical: reserveCharge's created:false fallback
  // used to let a sibling's still-held reservation stand in for THIS call's
  // own budget check, so a second, differently priced request could ride in
  // on a cheap reservation someone else made. (iii-a) from the reviewer's
  // probe: the sibling never gets far enough to accept a job, so the second
  // call must refuse rather than spend the sibling's room.
  it('refuses with request_in_progress when a sibling call still holds the reservation for this key', async () => {
    const { db, env, agent: agentP } = setup({ budgetUsd: 0.5 });
    const agent = await agentP;
    const token = await agentJobToken(agent.id, 'sibling-holds');
    expect(await reserveCharge(env, agent, token, { costUsd: 0.003, confidence: 'estimated' })).toMatchObject({ ok: true, created: true });
    const client = await connectAgent(env, agent);
    const result = await client.callTool({ name: 'generate', arguments: { ...seedance, idempotencyKey: 'sibling-holds' } });
    expect(structured(result)).toMatchObject({ code: 'request_in_progress', retryable: true });
    expect(jobs(db)).toHaveLength(0);
    expect(charges(db)).toHaveLength(1); // only the sibling's original reservation — no new one
  });

  // (iii-b) from the probe: even if the sibling's reservation is dropped
  // (its own refusal running concurrently) at the worst possible moment —
  // right as this call re-reads for a job — this call must still never end
  // up accepting a job for free.
  it('never creates an uncharged job when the sibling\'s reservation drops mid-flight', async () => {
    const { db, env, agent: agentP } = setup({ budgetUsd: 0.5 });
    const agent = await agentP;
    const token = await agentJobToken(agent.id, 'sibling-drops');
    await reserveCharge(env, agent, token, { costUsd: 0.003, confidence: 'estimated' });
    const originalPrepare = env.DB.prepare.bind(env.DB);
    let seen = 0;
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation(((query: string) => {
      if (query === 'SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?') {
        seen += 1;
        // 1st: the up-front existing lookup (no job yet). 2nd: the re-read
        // after reserveCharge returns created:false. Simulate the sibling's
        // own refusal dropping its reservation exactly then.
        if (seen === 2) db.prepare('DELETE FROM account_agent_charges WHERE id = ? AND job_id IS NULL').run(token);
      }
      return originalPrepare(query);
    }) as typeof env.DB.prepare);
    const client = await connectAgent(env, agent);
    const result = await client.callTool({ name: 'generate', arguments: { ...seedance, idempotencyKey: 'sibling-drops' } });
    spy.mockRestore();
    expect(structured(result)).toMatchObject({ code: 'request_in_progress' });
    expect(jobs(db)).toHaveLength(0);
    expect(charges(db)).toHaveLength(0);
  });

  // Only the call that created a reservation may resolve references and
  // accept a job; a call that finds one already held (created:false) must
  // resume the job it names, not just refuse, once that job exists.
  it('resumes the sibling\'s job once it exists, for a call that only ever sees created:false', async () => {
    const { db, env, agent: agentP } = setup();
    const agent = await agentP;
    const token = await agentJobToken(agent.id, 'sibling-ready');
    const originalPrepare = env.DB.prepare.bind(env.DB);
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation(((query: string) => {
      // Right before this call's own reserveCharge INSERT runs, simulate a
      // sibling's whole flow (reserve, accept, attach) having already landed.
      if (query.startsWith('INSERT INTO account_agent_charges')) {
        db.prepare(`INSERT INTO account_jobs (id,user_id,request_token,request_digest,provider,request_json,reservation_bytes,created_at,updated_at,agent_id)
          VALUES ('sibling-job',?,?,'sibling-digest','atlas',?,1,1,1,?)`).run(OWNER, token, fluxRequestJson(), agent.id);
        db.prepare('INSERT INTO account_agent_charges (id,agent_id,job_id,estimate_micros,actual_micros,confidence,released,at) VALUES (?,?,?,?,?,?,0,?)')
          .run(token, agent.id, 'sibling-job', 3000, null, 'estimated', 1);
      }
      return originalPrepare(query);
    }) as typeof env.DB.prepare);
    const client = await connectAgent(env, agent);
    const result = await client.callTool({ name: 'generate', arguments: { ...flux, idempotencyKey: 'sibling-ready' } });
    spy.mockRestore();
    expect(structured(result)).toMatchObject({ job: { id: 'sibling-job' } });
    expect(jobs(db)).toHaveLength(1);
    expect(charges(db)).toHaveLength(1);
  });

  // Fix round 2, Minor leftover (jobs.ts:101-103): acceptJob can throw after
  // its own write already committed, if its own internal read-back is what
  // failed. The job that now exists under this token is THIS call's own —
  // only this call was ever allowed to reach acceptJob for it — so it must be
  // finished exactly as the normal path would, never discarded or dropped.
  it('finishes the job when acceptJob commits but its own read-back throws', async () => {
    const { db, env, objects, agent } = setup();
    objects.set(seedAsset(db, { id: 'asset-v', jobId: null, bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    const originalPrepare = env.DB.prepare.bind(env.DB);
    let seen = 0;
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation(((query: string) => {
      if (query === 'SELECT * FROM account_jobs WHERE user_id = ? AND request_token = ?') {
        seen += 1;
        // 1: generate's existing lookup. 2: acceptJob's own existing check.
        // 3: acceptJob's own read-back after its batch has already committed.
        if (seen === 3) throw new Error('transient D1 read failure');
      }
      return originalPrepare(query);
    }) as typeof env.DB.prepare);
    const result = await (await connectAgent(env, await agent)).callTool({ name: 'generate', arguments: seedreamEdit([{ assetId: 'asset-v' }]) });
    spy.mockRestore();
    expect(result.isError).toBeFalsy();
    const out = structured<{ job: { id: string } }>(result);
    expect(jobs(db)).toHaveLength(1);
    expect(jobs(db)[0]).toMatchObject({ id: out.job.id });
    expect(charges(db)[0]).toMatchObject({ job_id: out.job.id, released: 0 });
    expect(readyUploads(db)).toBe(1); // this call's own copy — kept, not discarded
  });

  // The safety net the "own job" check above sits in front of: a job under
  // this token that does NOT reference any of this call's own copies really
  // is someone else's. Only then are the copies unused and the charge someone
  // else's to keep.
  it('discards this call\'s copies but keeps the charge when another job already won the token', async () => {
    const { db, env, objects, agent } = setup();
    const agentRow = await agent;
    objects.set(seedAsset(db, { id: 'asset-w', jobId: null, bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    const token = await agentJobToken(agentRow.id, 'foreign-wins');
    const originalPrepare = env.DB.prepare.bind(env.DB);
    const spy = vi.spyOn(env.DB, 'prepare').mockImplementation(((query: string) => {
      // Right before acceptJob's own INSERT attempt, plant a foreign job
      // under the same token — as if some other acceptance had already
      // claimed it. This single-threaded harness cannot reproduce the real
      // race directly (D1 serializes the conditional INSERT itself), so the
      // plant stands in for whatever real-world condition would land one.
      if (query.startsWith('SELECT id,mime_type FROM account_uploads')) {
        db.prepare(`INSERT INTO account_jobs (id,user_id,request_token,request_digest,provider,request_json,reservation_bytes,created_at,updated_at)
          VALUES ('foreign-job',?,?,'foreign-digest','atlas',?,1,1,1)`)
          .run(OWNER, token, JSON.stringify({ provider: 'atlas', modelId: 'foreign-model', mediaType: 'image', inputMode: 'text', prompt: 'y', values: {}, referenceIds: [] }));
      }
      return originalPrepare(query);
    }) as typeof env.DB.prepare);
    const result = await (await connectAgent(env, agentRow)).callTool({ name: 'generate', arguments: { ...seedreamEdit([{ assetId: 'asset-w' }]), idempotencyKey: 'foreign-wins' } });
    spy.mockRestore();
    expect(structured(result)).toMatchObject({ code: 'token_conflict' });
    expect(charges(db)[0]).toMatchObject({ released: 0 }); // kept — it belongs to the foreign job now
    expect(readyUploads(db)).toBe(0); // this call's own copy discarded
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
