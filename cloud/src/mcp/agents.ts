import { AccountError } from '../jobs';
import type { Env } from '../security';

/** One connected MCP client of one account (docs/claude/specs/2026-09-28-agent-mcp-design.md).
 *  This row, not the OAuth grant in KV, is what decides whether a token still works. */
export interface AgentRow {
  id: string; user_id: string; client_id: string; client_name: string;
  budget_micros: number; allow_unknown_cost: number; allow_delete: number;
  created_at: number; last_used_at: number | null; revoked_at: number | null;
}
export interface AgentSettings { budgetUsd: number; allowUnknownCost: boolean; allowDelete: boolean }

/** The limits the consent screen and the panel offer, in US dollars per rolling 24 hours. */
export const AGENT_BUDGET = { minUsd: 0.5, maxUsd: 500, defaultUsd: 5 } as const;
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { budgetUsd: AGENT_BUDGET.defaultUsd, allowUnknownCost: false, allowDelete: false };

/** Budgets are integer micro-dollars in D1: sums of float dollars drift. */
export const toMicros = (usd: number) => Math.round(usd * 1_000_000);
export const fromMicros = (micros: number) => micros / 1_000_000;

export function parseAgentSettings(value: unknown): AgentSettings {
  const body = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const { budgetUsd, allowUnknownCost, allowDelete } = body;
  if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd < AGENT_BUDGET.minUsd || budgetUsd > AGENT_BUDGET.maxUsd) {
    throw new AccountError(`Set a limit between $${AGENT_BUDGET.minUsd.toFixed(2)} and $${AGENT_BUDGET.maxUsd} per 24 hours.`, 400, 'invalid_budget');
  }
  if (typeof allowUnknownCost !== 'boolean' || typeof allowDelete !== 'boolean') throw new AccountError('Invalid agent settings.', 400, 'invalid_request');
  return { budgetUsd: Math.round(budgetUsd * 100) / 100, allowUnknownCost, allowDelete };
}

export async function createAgent(env: Env, args: { userId: string; clientId: string; clientName: string; settings: AgentSettings }, now = Date.now()): Promise<AgentRow> {
  const id = crypto.randomUUID();
  // The name comes from the client's own registration: bounded, and never trusted as markup.
  const name = args.clientName.trim().slice(0, 120) || 'Unnamed agent';
  await env.DB.prepare(`INSERT INTO account_agents (id,user_id,client_id,client_name,budget_micros,allow_unknown_cost,allow_delete,created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id, args.userId, args.clientId, name, toMicros(args.settings.budgetUsd), args.settings.allowUnknownCost ? 1 : 0, args.settings.allowDelete ? 1 : 0, now).run();
  return (await env.DB.prepare('SELECT * FROM account_agents WHERE id = ?').bind(id).first<AgentRow>())!;
}

/** The join on account_users refuses an agent whose account is gone even where
 *  the cascade has not run yet. */
export async function activeAgent(env: Env, agentId: string, userId: string): Promise<AgentRow | null> {
  return env.DB.prepare(`SELECT a.* FROM account_agents a JOIN account_users u ON u.id = a.user_id
    WHERE a.id = ? AND a.user_id = ? AND a.revoked_at IS NULL`).bind(agentId, userId).first<AgentRow>();
}

/** Every MCP request calls this, so it writes at most once a minute. */
export async function touchAgent(env: Env, agentId: string, now = Date.now()) {
  await env.DB.prepare('UPDATE account_agents SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)')
    .bind(now, agentId, now - 60_000).run();
}

export async function updateAgent(env: Env, userId: string, agentId: string, settings: AgentSettings): Promise<boolean> {
  const updated = await env.DB.prepare('UPDATE account_agents SET budget_micros = ?, allow_unknown_cost = ?, allow_delete = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(toMicros(settings.budgetUsd), settings.allowUnknownCost ? 1 : 0, settings.allowDelete ? 1 : 0, agentId, userId).run();
  return Boolean(updated.meta.changes);
}

/** The row stays, so jobs this agent started keep saying who started them. */
export async function revokeAgent(env: Env, userId: string, agentId: string, now = Date.now()): Promise<boolean> {
  const revoked = await env.DB.prepare('UPDATE account_agents SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(now, agentId, userId).run();
  if (!revoked.meta.changes) return false;
  await revokeUserGrants(env, userId, agentId);
  return true;
}

/**
 * Best effort, never throws. `revoked_at` (or a deleted account) is what
 * refuses the agent on its very next call; revoking the grant in KV only stops
 * its refresh token from minting new access tokens sooner than they expire.
 */
export async function revokeUserGrants(env: Env, userId: string, agentId?: string) {
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers) return;
  try {
    let cursor: string | undefined;
    do {
      const page = await helpers.listUserGrants(userId, cursor ? { cursor } : undefined);
      for (const grant of page.items) if (!agentId || grant.metadata?.agentId === agentId) await helpers.revokeGrant(grant.id, userId);
      cursor = page.cursor;
    } while (cursor);
  } catch { /* See above: the D1 row already refuses the agent. */ }
}
