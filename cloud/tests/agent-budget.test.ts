import { describe, expect, it } from 'vitest';
import { attachCharge, BUDGET_WINDOW_MS, budgetStatus, cleanupOrphanCharges, dropCharge, previewCharge, releaseCharge, reserveCharge, settleCharge } from '../src/mcp/budget';
import { recordAccountSpend } from '../src/spend';
import type { JobRow } from '../src/jobs';
import { agentEnv, OWNER, seedAgent } from './agent-fixtures';

const priced = (usd: number) => ({ costUsd: usd, confidence: 'estimated' as const });
const unpriced = { costUsd: null, confidence: 'unknown' as const };
const T0 = 1_800_000_000_000;

describe('agent budget', () => {
  it('books an estimate and reports what is left', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    expect(await reserveCharge(env, agent, 'charge-1', priced(1.25), T0)).toEqual({ ok: true, created: true, status: { limitUsd: 5, usedUsd: 1.25, remainingUsd: 3.75 } });
  });

  it('refuses the charge that would cross the limit and says when room frees up', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'first', priced(4), T0);
    const refused = await reserveCharge(env, agent, 'second', priced(2), T0 + 3_600_000);
    expect(refused).toMatchObject({ ok: false, code: 'budget_exceeded', needUsd: 2, roomAt: T0 + BUDGET_WINDOW_MS, status: { remainingUsd: 1 } });
  });

  it('says a run larger than the whole limit never fits', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env, { budgetUsd: 1 });
    expect(await reserveCharge(env, agent, 'huge', priced(3), T0)).toMatchObject({ ok: false, code: 'budget_exceeded', roomAt: null });
  });

  it('lets only one of two parallel reservations fit', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    const outcomes = await Promise.all([reserveCharge(env, agent, 'a', priced(3), T0), reserveCharge(env, agent, 'b', priced(3), T0)]);
    expect(outcomes.filter(outcome => outcome.ok)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toEqual({ n: 1 });
  });

  it('treats a repeated charge id as the same reservation', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'same', priced(4), T0);
    expect(await reserveCharge(env, agent, 'same', priced(4), T0 + 1)).toMatchObject({ ok: true, created: false });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toEqual({ n: 1 });
  });

  it('refuses an unknown price unless the grant allows it, and then books nothing', async () => {
    const { db, env } = agentEnv();
    const strict = await seedAgent(env);
    expect(await reserveCharge(env, strict, 'u1', unpriced, T0)).toMatchObject({ ok: false, code: 'cost_unknown' });
    const lenient = await seedAgent(env, { allowUnknownCost: true });
    expect(await reserveCharge(env, lenient, 'u2', unpriced, T0)).toMatchObject({ ok: true, created: true, status: { usedUsd: 0 } });
    expect(db.prepare("SELECT estimate_micros, confidence FROM account_agent_charges WHERE id = 'u2'").get()).toEqual({ estimate_micros: null, confidence: 'unknown' });
  });

  it('counts the settled figure, ignores an unknown one, and frees a released charge', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'c', priced(2), T0);
    await attachCharge(env, 'c', 'job-1');
    await settleCharge(env, 'job-1', { costUsd: null, confidence: 'unknown' });
    expect((await budgetStatus(env, agent, T0)).usedUsd).toBe(2);
    await settleCharge(env, 'job-1', { costUsd: 3.5, confidence: 'exact' });
    expect((await budgetStatus(env, agent, T0)).usedUsd).toBe(3.5);
    await releaseCharge(env, 'c');
    expect((await budgetStatus(env, agent, T0)).usedUsd).toBe(0);
  });

  it('drops charges older than 24 hours from the window', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'old', priced(4.5), T0);
    expect((await budgetStatus(env, agent, T0 + BUDGET_WINDOW_MS)).usedUsd).toBe(0);
    expect(await reserveCharge(env, agent, 'new', priced(4.5), T0 + BUDGET_WINDOW_MS)).toMatchObject({ ok: true });
  });

  // Review focus 3: the person lowers the limit below what was already spent.
  it('never reports negative room after the limit is lowered', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'spent', priced(4), T0);
    db.prepare('UPDATE account_agents SET budget_micros = 1000000').run();
    const lowered = { ...agent, budget_micros: 1_000_000 };
    expect(await budgetStatus(env, lowered, T0)).toEqual({ limitUsd: 1, usedUsd: 4, remainingUsd: 0 });
    expect(await reserveCharge(env, lowered, 'next', priced(0.5), T0 + 1)).toMatchObject({ ok: false, code: 'budget_exceeded', roomAt: T0 + BUDGET_WINDOW_MS });
  });

  // Fix round 1, Finding 1(c): a released row must not let a repeated charge
  // id skip straight past the budget check.
  it('refuses a repeated charge id whose reservation was already released', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env, { budgetUsd: 1 });
    await reserveCharge(env, agent, 'released-charge', priced(0.5), T0);
    await releaseCharge(env, 'released-charge');
    expect(await reserveCharge(env, agent, 'released-charge', priced(0.5), T0 + 1)).toMatchObject({ ok: false, code: 'budget_exceeded' });
  });

  it('drops a reservation that never became a job, but leaves an attached one alone', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'orphan', priced(1), T0);
    await reserveCharge(env, agent, 'attached', priced(1), T0);
    await attachCharge(env, 'attached', 'job-x');
    await dropCharge(env, 'orphan');
    await dropCharge(env, 'attached');
    expect(db.prepare('SELECT id FROM account_agent_charges ORDER BY id').all()).toEqual([{ id: 'attached' }]);
  });

  it('previews without booking', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    expect(await previewCharge(env, agent, priced(1), T0)).toMatchObject({ ok: true, created: false });
    expect(await previewCharge(env, agent, priced(9), T0)).toMatchObject({ ok: false, code: 'budget_exceeded' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_charges').get()).toEqual({ n: 0 });
  });

  it('attaches a stray reservation to the job it paid for, and deletes one that paid for nothing', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'token-with-a-job-1', priced(1), T0);
    await reserveCharge(env, agent, 'token-without-job-1', priced(1), T0);
    db.prepare("INSERT INTO account_jobs (id,user_id,request_token,request_digest,provider,request_json,reservation_bytes,created_at,updated_at) VALUES ('job-9',?,'token-with-a-job-1','d','atlas','{}',1,1,1)").run(OWNER);
    await cleanupOrphanCharges(env, T0 + 11 * 60_000);
    expect(db.prepare('SELECT id, job_id FROM account_agent_charges ORDER BY id').all()).toEqual([{ id: 'token-with-a-job-1', job_id: 'job-9' }]);
  });

  it('settles from the ledger when a finished job is recorded', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'ledger-token-000001', priced(0.01), T0);
    const request = { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell', mediaType: 'image', inputMode: 'text', prompt: 'p', values: {}, referenceIds: [] };
    db.prepare(`INSERT INTO account_jobs (id,user_id,request_token,request_digest,provider,request_json,reservation_bytes,created_at,updated_at,state,result_json,agent_id)
      VALUES ('job-l',?,'ledger-token-000001','d','atlas',?,1,1,1,'saved',?,?)`).run(OWNER, JSON.stringify(request), JSON.stringify({ sources: [{ objectKey: 'k' }] }), agent.id);
    await attachCharge(env, 'ledger-token-000001', 'job-l');
    await recordAccountSpend(env, db.prepare("SELECT * FROM account_jobs WHERE id='job-l'").get() as unknown as JobRow);
    expect(db.prepare("SELECT actual_micros FROM account_agent_charges WHERE job_id='job-l'").get()).toEqual({ actual_micros: 3000 });
  });

  it('still reports a recorded spend entry as recorded when settling its charge fails', async () => {
    const { db, env } = agentEnv();
    const request = { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell', mediaType: 'image', inputMode: 'text', prompt: 'p', values: {}, referenceIds: [] };
    db.prepare(`INSERT INTO account_jobs (id,user_id,request_token,request_digest,provider,request_json,reservation_bytes,created_at,updated_at,state,result_json)
      VALUES ('job-settle-fail',?,'settle-fail-token','d','atlas',?,1,1,1,'saved',?)`).run(OWNER, JSON.stringify(request), JSON.stringify({ sources: [{ objectKey: 'k' }] }));
    db.exec('DROP TABLE account_agent_charges');
    const job = db.prepare("SELECT * FROM account_jobs WHERE id='job-settle-fail'").get() as unknown as JobRow;
    expect(await recordAccountSpend(env, job)).toBe(true);
    expect(db.prepare("SELECT job_id FROM account_spend WHERE job_id='job-settle-fail'").get()).toEqual({ job_id: 'job-settle-fail' });
  });
});
