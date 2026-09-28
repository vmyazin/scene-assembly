import type { ConnectedAgent } from '../../../lib/account/contracts';
import { AccountError } from '../jobs';
import { currentAccount } from '../sessions';
import { json, type Env } from '../security';
import { AGENT_BUDGET, parseAgentSettings, revokeAgent, updateAgent, type AgentRow } from './agents';
import { budgetStatus } from './budget';

export function mcpUrl(env: Env): string | null {
  return env.MCP_ORIGIN ? `${env.MCP_ORIGIN}/mcp` : null;
}

export async function listAgents(env: Env, userId: string, now = Date.now()): Promise<ConnectedAgent[]> {
  const rows = await env.DB.prepare('SELECT * FROM account_agents WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC').bind(userId).all<AgentRow>();
  return Promise.all(rows.results.map(async row => {
    const status = await budgetStatus(env, row, now);
    return {
      id: row.id, name: row.client_name, connectedAt: row.created_at, lastUsedAt: row.last_used_at,
      budgetUsd: status.limitUsd, usedUsd: status.usedUsd,
      allowUnknownCost: row.allow_unknown_cost === 1, allowDelete: row.allow_delete === 1,
    };
  }));
}

export async function agentRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!/^\/api\/account\/agents(\/|$)/.test(path)) return null;
  const account = await currentAccount(request, env);
  if (!account) return json({ error: 'Sign in to manage connected agents.' }, 401);
  try {
    if (path === '/api/account/agents' && request.method === 'GET') {
      return json({ accountId: account.id, mcpUrl: mcpUrl(env), limits: { minUsd: AGENT_BUDGET.minUsd, maxUsd: AGENT_BUDGET.maxUsd }, agents: await listAgents(env, account.id) });
    }
    const match = path.match(/^\/api\/account\/agents\/([a-zA-Z0-9-]+)$/);
    if (match && request.method === 'POST') {
      const settings = parseAgentSettings(JSON.parse((await request.text()) || '{}'));
      if (!await updateAgent(env, account.id, match[1], settings)) return json({ error: 'Agent not found.' }, 404);
      return json({ agent: (await listAgents(env, account.id)).find(agent => agent.id === match[1]) });
    }
    if (match && request.method === 'DELETE') {
      if (!await revokeAgent(env, account.id, match[1])) return json({ error: 'Agent not found.' }, 404);
      return json({ ok: true });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error instanceof AccountError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof SyntaxError) return json({ error: 'Invalid request.' }, 400);
    throw error;
  }
}
