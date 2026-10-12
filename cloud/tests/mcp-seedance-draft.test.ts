// cloud/tests/mcp-seedance-draft.test.ts
import { expect, it } from 'vitest';
import { acceptJob } from '../src/jobs';
import { agentEnv, connectProvider, OWNER, seedAgent } from './agent-fixtures';
import { connectAgent, structured } from './mcp-harness';

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
