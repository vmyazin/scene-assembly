// cloud/tests/mcp-seedance-draft.test.ts
import { expect, it } from 'vitest';
import { acceptJob } from '../src/jobs';
import { storeUpload } from '../src/uploads';
import { agentEnv, connectProvider, OWNER, seedAgent, seedAsset } from './agent-fixtures';
import { connectAgent, structured } from './mcp-harness';

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
  out.set(payload, 8);
  return out;
}

/** A tiny MP4 whose mvhd says `seconds`. The mdat is four bytes; the length is not the file size. */
function mp4WithDuration(seconds: number): Uint8Array {
  const payload = new Uint8Array(100);
  const view = new DataView(payload.buffer);
  view.setUint32(12, 1000);
  view.setUint32(16, Math.round(seconds * 1000));
  const moov = box('moov', box('mvhd', payload));
  const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
  const mdat = box('mdat', new Uint8Array(4));
  const all = new Uint8Array(ftyp.length + mdat.length + moov.length);
  all.set(ftyp, 0);
  all.set(mdat, ftyp.length);
  all.set(moov, ftyp.length + mdat.length);
  return all;
}

const draftRequest = {
  provider: 'runware' as const, modelId: 'bytedance:seedance@2.5', mediaType: 'video' as const, inputMode: 'text' as const,
  prompt: 'A lighthouse at dusk', values: { draft: true, size: '480p · 16:9', durationSeconds: 5 }, referenceIds: [] as string[],
};

function setup(settings = {}) {
  const { db, env } = agentEnv({ CLOUD_GENERATION_PROVIDERS: 'runware' });
  connectProvider(db, 'runware');
  return { db, env, agent: seedAgent(env, settings) };
}

it('charges a Seedance draft from the documented 480p rate', async () => {
  const { db, env, agent } = setup();
  const client = await connectAgent(env, await agent);
  const result = await client.callTool({ name: 'generate', arguments: { ...draftRequest, idempotencyKey: 'draft-1' } });
  expect(result.isError).toBeFalsy();
  const out = structured<{ estimate: { costUsd: number; confidence: string } }>(result);
  expect(out.estimate.costUsd).toBeCloseTo(0.51, 2);
  expect(out.estimate.confidence).toBe('estimated');
  expect(db.prepare('SELECT estimate_micros FROM account_agent_charges').get()).toMatchObject({ estimate_micros: Math.round(out.estimate.costUsd * 1_000_000) });
});

it('finalizes as a separate budget-checked job and refuses prompt or media', async () => {
  const { db, env, agent } = setup();
  const saved = await acceptJob(env, OWNER, 'seedance-draft-job-1', draftRequest);
  db.prepare('UPDATE account_jobs SET state = ?, result_json = ? WHERE id = ?').run('saved', JSON.stringify({ sources: [{ url: 'https://example.test/draft.mp4' }], draftId: 'draft-abc' }), saved.id);
  const client = await connectAgent(env, await agent);
  const refused = structured<{ code: string }>(await client.callTool({ name: 'finalize_draft', arguments: { jobId: saved.id, durationSeconds: 5, prompt: 'again', idempotencyKey: 'fin-1' } }));
  expect(refused.code).toBe('invalid_field');
  const result = await client.callTool({ name: 'finalize_draft', arguments: { jobId: saved.id, durationSeconds: 5, idempotencyKey: 'fin-1' } });
  expect(result.isError).toBeFalsy();
  const out = structured<{ job: { id: string }; estimate: { costUsd: number; confidence: string } }>(result);
  expect(out.estimate.costUsd).toBeCloseTo(3.07, 2);
  expect(out.estimate.confidence).toBe('estimated');
  expect(out.job.id).not.toBe(saved.id);
  const stored = JSON.parse((db.prepare('SELECT request_json FROM account_jobs WHERE id = ?').get(out.job.id) as { request_json: string }).request_json);
  expect(stored.values).toEqual({ finalize: true, draftId: 'draft-abc', durationSeconds: 5 });
  expect(stored.referenceIds).toEqual([]);
  expect(stored.sourceVideoId).toBeUndefined();
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toMatchObject({ n: 1 });
});

it('refuses a finalize that does not fit the remaining budget', async () => {
  const { env, agent } = setup({ budgetUsd: 1 });
  const saved = await acceptJob(env, OWNER, 'seedance-draft-job-2', draftRequest);
  await env.DB.prepare('UPDATE account_jobs SET state = ?, result_json = ? WHERE id = ?').bind('saved', JSON.stringify({ sources: [{}], draftId: 'draft-abc' }), saved.id).run();
  const client = await connectAgent(env, await agent);
  const refused = structured<{ code: string }>(await client.callTool({ name: 'finalize_draft', arguments: { jobId: saved.id, durationSeconds: 5, idempotencyKey: 'fin-over' } }));
  expect(refused.code).toBe('budget_exceeded');
});

it('refuses a job that has no draft id', async () => {
  const { env, agent } = setup();
  const saved = await acceptJob(env, OWNER, 'seedance-draft-job-3', { ...draftRequest, values: { size: '480p · 16:9', durationSeconds: 5 } });
  const client = await connectAgent(env, await agent);
  const refused = structured<{ code: string }>(await client.callTool({ name: 'finalize_draft', arguments: { jobId: saved.id, durationSeconds: 5 } }));
  expect(refused.code).toBe('draft_unavailable');
});

it('prices a finalize from the saved draft length and refuses a shorter claim', async () => {
  const { db, env, agent } = setup({ budgetUsd: 40 });
  const saved = await acceptJob(env, OWNER, 'seedance-draft-long', { ...draftRequest, values: { draft: true, size: '480p · 16:9', durationSeconds: 30 } });
  db.prepare('UPDATE account_jobs SET state = ?, result_json = ? WHERE id = ?').run('saved', JSON.stringify({ sources: [{}], draftId: 'draft-long' }), saved.id);
  const client = await connectAgent(env, await agent);
  const refused = structured<{ code: string }>(await client.callTool({ name: 'finalize_draft', arguments: { jobId: saved.id, durationSeconds: 4, idempotencyKey: 'fin-short' } }));
  expect(refused.code).toBe('invalid_field');
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toMatchObject({ n: 0 });
  const result = await client.callTool({ name: 'finalize_draft', arguments: { jobId: saved.id, idempotencyKey: 'fin-saved' } });
  expect(result.isError).toBeFalsy();
  const out = structured<{ estimate: { costUsd: number } }>(result);
  expect(out.estimate.costUsd).toBeCloseTo(18.42, 2);
  const stored = JSON.parse((db.prepare('SELECT request_json FROM account_jobs WHERE id != ?').get(saved.id) as { request_json: string }).request_json);
  expect(stored.values.durationSeconds).toBe(30);
});

it('prices a bare draftId from the account\'s saved draft, not from the agent\'s claim', async () => {
  const { db, env, agent } = setup({ budgetUsd: 40 });
  const saved = await acceptJob(env, OWNER, 'seedance-draft-bare-long', { ...draftRequest, values: { draft: true, size: '480p · 16:9', durationSeconds: 30 } });
  db.prepare('UPDATE account_jobs SET state = ?, result_json = ? WHERE id = ?').run('saved', JSON.stringify({ sources: [{}], draftId: 'draft-bare-long' }), saved.id);
  const client = await connectAgent(env, await agent);
  const refused = structured<{ code: string }>(await client.callTool({ name: 'finalize_draft', arguments: { draftId: 'draft-bare-long', durationSeconds: 4, inputMode: 'text', idempotencyKey: 'fin-bare-short' } }));
  expect(refused.code).toBe('invalid_field');
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toMatchObject({ n: 0 });
  const result = await client.callTool({ name: 'finalize_draft', arguments: { draftId: 'draft-bare-long', idempotencyKey: 'fin-bare-saved' } });
  expect(result.isError).toBeFalsy();
  expect(structured<{ estimate: { costUsd: number } }>(result).estimate.costUsd).toBeCloseTo(18.42, 2);
  const stored = JSON.parse((db.prepare('SELECT request_json FROM account_jobs WHERE id != ?').get(saved.id) as { request_json: string }).request_json);
  expect(stored.values).toEqual({ finalize: true, draftId: 'draft-bare-long', durationSeconds: 30 });
});

it('reserves a draftId with no saved job at the longest length and costliest mode', async () => {
  const { db, env, agent } = setup({ budgetUsd: 40 });
  const client = await connectAgent(env, await agent);
  const result = await client.callTool({ name: 'finalize_draft', arguments: { draftId: 'draft-from-elsewhere', durationSeconds: 4, inputMode: 'text', idempotencyKey: 'fin-unknown' } });
  expect(result.isError).toBeFalsy();
  expect(structured<{ estimate: { costUsd: number } }>(result).estimate.costUsd).toBeGreaterThanOrEqual(18.42);
  const stored = JSON.parse((db.prepare('SELECT request_json FROM account_jobs').get() as { request_json: string }).request_json);
  expect(stored.values.durationSeconds).toBe(30);
});

it('refuses to finalize a draft that has no saved length', async () => {
  const { db, env, agent } = setup();
  const saved = await acceptJob(env, OWNER, 'seedance-draft-nolength', { ...draftRequest, values: { draft: true, size: '480p · 16:9' } });
  db.prepare('UPDATE account_jobs SET state = ?, result_json = ? WHERE id = ?').run('saved', JSON.stringify({ sources: [{}], draftId: 'draft-nolength' }), saved.id);
  const client = await connectAgent(env, await agent);
  const refused = structured<{ code: string }>(await client.callTool({ name: 'finalize_draft', arguments: { jobId: saved.id, durationSeconds: 5, idempotencyKey: 'fin-nolength' } }));
  expect(refused.code).toBe('draft_unavailable');
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toMatchObject({ n: 0 });
});

it('prices an edit draft from the clip and refuses a shorter claim', async () => {
  const { db, env, agent } = setup({ allowUnknownCost: true });
  const clip = mp4WithDuration(30);
  const stored = await storeUpload(env, OWNER, clip, clip.byteLength, 'video/mp4');
  const client = await connectAgent(env, await agent);
  const common = {
    provider: 'runware', modelId: 'bytedance:seedance@2.5', mediaType: 'video', inputMode: 'edit',
    prompt: 'replace the sky', sourceVideo: { uploadId: stored.id },
  };
  const refused = structured<{ code: string }>(await client.callTool({
    name: 'generate',
    arguments: { ...common, values: { draft: true, size: '480p', sourceDurationSeconds: 4 }, idempotencyKey: 'edit-short' },
  }));
  expect(refused.code).toBe('invalid_field');
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toMatchObject({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_jobs').get()).toMatchObject({ n: 0 });
  const priced = await client.callTool({
    name: 'generate',
    arguments: { ...common, values: { draft: true, size: '480p' }, idempotencyKey: 'edit-measured' },
  });
  expect(priced.isError).toBeFalsy();
  expect(structured<{ estimate: { costUsd: number } }>(priced).estimate.costUsd).toBeCloseTo(30 * 0.131, 2);
});

it('refuses an edit draft whose clip has no readable duration, even when unknown cost is allowed', async () => {
  const { db, env, agent } = setup({ allowUnknownCost: true });
  const junk = new Uint8Array(32);
  const stored = await storeUpload(env, OWNER, junk, junk.byteLength, 'video/mp4');
  const client = await connectAgent(env, await agent);
  const refused = structured<{ code: string }>(await client.callTool({
    name: 'generate',
    arguments: {
      provider: 'runware', modelId: 'bytedance:seedance@2.5', mediaType: 'video', inputMode: 'edit',
      prompt: 'replace the sky', sourceVideo: { uploadId: stored.id },
      values: { draft: true, size: '480p' }, idempotencyKey: 'edit-unread',
    },
  }));
  expect(refused.code).toBe('invalid_field');
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toMatchObject({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_jobs').get()).toMatchObject({ n: 0 });
});

it('refuses a short claim against a library clip without copying it', async () => {
  const { db, env, objects } = agentEnv({ CLOUD_GENERATION_PROVIDERS: 'runware' });
  connectProvider(db, 'runware');
  const agent = seedAgent(env, { allowUnknownCost: true });
  const clip = mp4WithDuration(30);
  const key = seedAsset(db, { id: 'clip', jobId: null, kind: 'video', mimeType: 'video/mp4', bytes: clip.byteLength });
  objects.set(key, { bytes: clip, contentType: 'video/mp4' });
  const client = await connectAgent(env, await agent);
  const refused = structured<{ code: string }>(await client.callTool({
    name: 'generate',
    arguments: {
      provider: 'runware', modelId: 'bytedance:seedance@2.5', mediaType: 'video', inputMode: 'edit',
      prompt: 'replace the sky', sourceVideo: { assetId: 'clip' },
      values: { draft: true, size: '480p', sourceDurationSeconds: 4 }, idempotencyKey: 'asset-short',
    },
  }));
  expect(refused.code).toBe('invalid_field');
  expect(db.prepare("SELECT COUNT(*) AS n FROM account_uploads WHERE state != 'deleted'").get()).toMatchObject({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toMatchObject({ n: 0 });
});
