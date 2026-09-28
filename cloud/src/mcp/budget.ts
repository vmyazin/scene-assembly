import { fromMicros, toMicros, type AgentRow } from './agents';
import type { Env } from '../security';

/** A rolling window, not a calendar day: nothing resets at an hour the person never chose. */
export const BUDGET_WINDOW_MS = 86_400_000;
/** A reservation whose acceptJob never came back. Longer than any intake takes. */
const ORPHAN_AFTER_MS = 600_000;

export interface ChargeEstimate { costUsd: number | null; confidence: 'exact' | 'estimated' | 'unknown' }
export interface BudgetStatus { limitUsd: number; usedUsd: number; remainingUsd: number }
export type ChargeOutcome =
  | { ok: true; created: boolean; status: BudgetStatus }
  | { ok: false; code: 'cost_unknown'; status: BudgetStatus }
  | { ok: false; code: 'budget_exceeded'; status: BudgetStatus; needUsd: number; roomAt: number | null };

/** What one charge counts for: the ledger's figure once settled, the estimate
 *  until then, nothing once released or for an unknown price. */
const CHARGED = 'CASE WHEN released = 1 THEN 0 ELSE COALESCE(actual_micros, estimate_micros, 0) END';
const USED_MICROS = `SELECT COALESCE(SUM(${CHARGED}), 0) FROM account_agent_charges WHERE agent_id = ? AND at > ?`;

const needMicros = (estimate: ChargeEstimate) =>
  estimate.costUsd === null || estimate.confidence === 'unknown' ? null : toMicros(estimate.costUsd);

export async function budgetStatus(env: Env, agent: Pick<AgentRow, 'id' | 'budget_micros'>, now = Date.now()): Promise<BudgetStatus> {
  const row = await env.DB.prepare(`SELECT (${USED_MICROS}) AS used`).bind(agent.id, now - BUDGET_WINDOW_MS).first<{ used: number }>();
  const used = row?.used ?? 0;
  return { limitUsd: fromMicros(agent.budget_micros), usedUsd: fromMicros(used), remainingUsd: fromMicros(Math.max(0, agent.budget_micros - used)) };
}

/** The earliest moment enough of this window's charges have aged out for `micros` to fit. */
async function roomAt(env: Env, agent: AgentRow, micros: number, now: number): Promise<number | null> {
  if (micros > agent.budget_micros) return null;
  const rows = await env.DB.prepare(`SELECT at, ${CHARGED} AS amount FROM account_agent_charges WHERE agent_id = ? AND at > ? ORDER BY at ASC`)
    .bind(agent.id, now - BUDGET_WINDOW_MS).all<{ at: number; amount: number }>();
  let used = rows.results.reduce((sum, row) => sum + row.amount, 0);
  if (used + micros <= agent.budget_micros) return now;
  for (const row of rows.results) {
    used -= row.amount;
    if (used + micros <= agent.budget_micros) return row.at + BUDGET_WINDOW_MS;
  }
  return null;
}

export async function previewCharge(env: Env, agent: AgentRow, estimate: ChargeEstimate, now = Date.now()): Promise<ChargeOutcome> {
  const status = await budgetStatus(env, agent, now);
  const micros = needMicros(estimate);
  if (micros === null) return agent.allow_unknown_cost ? { ok: true, created: false, status } : { ok: false, code: 'cost_unknown', status };
  if (toMicros(status.usedUsd) + micros <= agent.budget_micros) return { ok: true, created: false, status };
  return { ok: false, code: 'budget_exceeded', status, needUsd: fromMicros(micros), roomAt: await roomAt(env, agent, micros, now) };
}

/**
 * Books a job's estimate before the job exists.
 *
 * One conditional INSERT, because D1 runs it as one write: two calls racing for
 * the last dollars each see the other's row or none, never both fit. A repeated
 * `chargeId` (a retried idempotency key) finds its own row and books nothing new.
 */
export async function reserveCharge(env: Env, agent: AgentRow, chargeId: string, estimate: ChargeEstimate, now = Date.now()): Promise<ChargeOutcome> {
  const micros = needMicros(estimate);
  if (micros === null && !agent.allow_unknown_cost) return { ok: false, code: 'cost_unknown', status: await budgetStatus(env, agent, now) };
  const inserted = await env.DB.prepare(`INSERT INTO account_agent_charges (id, agent_id, job_id, estimate_micros, actual_micros, confidence, released, at)
    SELECT ?, ?, NULL, ?, NULL, ?, 0, ?
    WHERE NOT EXISTS (SELECT 1 FROM account_agent_charges WHERE id = ?)
      AND (${USED_MICROS}) + ? <= ?`)
    .bind(chargeId, agent.id, micros, estimate.confidence, now, chargeId, agent.id, now - BUDGET_WINDOW_MS, micros ?? 0, agent.budget_micros).run();
  const status = await budgetStatus(env, agent, now);
  if (inserted.meta.changes) return { ok: true, created: true, status };
  if (await env.DB.prepare('SELECT 1 AS found FROM account_agent_charges WHERE id = ? AND agent_id = ?').bind(chargeId, agent.id).first()) {
    return { ok: true, created: false, status };
  }
  return { ok: false, code: 'budget_exceeded', status, needUsd: fromMicros(micros ?? 0), roomAt: await roomAt(env, agent, micros ?? 0, now) };
}

export async function attachCharge(env: Env, chargeId: string, jobId: string) {
  await env.DB.prepare('UPDATE account_agent_charges SET job_id = ? WHERE id = ? AND job_id IS NULL').bind(jobId, chargeId).run();
}

/** Only when the provider certainly never ran the job; see the spec's Budget section. */
export async function releaseCharge(env: Env, chargeId: string) {
  await env.DB.prepare('UPDATE account_agent_charges SET released = 1 WHERE id = ?').bind(chargeId).run();
}

/** The ledger's figure replaces the estimate. An unknown figure changes nothing. */
export async function settleCharge(env: Env, jobId: string, figure: { costUsd: number | null; confidence: string }) {
  if (figure.costUsd === null || figure.confidence === 'unknown') return;
  await env.DB.prepare('UPDATE account_agent_charges SET actual_micros = ?, confidence = ? WHERE job_id = ? AND released = 0')
    .bind(toMicros(figure.costUsd), figure.confidence, jobId).run();
}

/**
 * A reservation with no job after ten minutes: the Worker stopped between
 * booking and acceptJob, or between acceptJob and attach. The second kind has a
 * job — found by its token, which is the charge id — and must keep counting; only
 * the first kind paid for nothing.
 */
export async function cleanupOrphanCharges(env: Env, now = Date.now()) {
  const before = now - ORPHAN_AFTER_MS;
  await env.DB.prepare(`UPDATE account_agent_charges SET job_id = (
      SELECT j.id FROM account_jobs j JOIN account_agents a ON a.user_id = j.user_id
      WHERE a.id = account_agent_charges.agent_id AND j.request_token = account_agent_charges.id)
    WHERE job_id IS NULL AND at <= ?`).bind(before).run();
  await env.DB.prepare('DELETE FROM account_agent_charges WHERE job_id IS NULL AND at <= ?').bind(before).run();
}
