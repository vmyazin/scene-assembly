import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/index';
import { createSession } from '../src/sessions';
import { deleteAccount } from '../src/lifecycle';
import { reserveCharge } from '../src/mcp/budget';
import type { Env } from '../src/security';
import { agentEnv, OWNER, seedAgent, seedUser } from './agent-fixtures';

async function signedIn(env: Env, subject = 'google-owner') {
  // createSession upserts by Google subject, so this signs in the fixture's OWNER.
  return (await createSession(env, { subject, email: 'owner@example.test', name: 'Owner' })).split(';')[0];
}
function call(env: Env, path: string, method = 'GET', cookie = '', body?: unknown) {
  return handleRequest(new Request(`http://localhost:8797/api/account/${path}`, {
    method, headers: { origin: env.APP_ORIGIN, cookie, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
}
function grantHelpers(grants: { id: string; userId: string; metadata: { agentId: string } }[]) {
  const revoked: string[] = [];
  return { revoked, helpers: {
    async listUserGrants(userId: string) { return { items: grants.filter(grant => grant.userId === userId) }; },
    async revokeGrant(id: string) { revoked.push(id); },
  } };
}

describe('connected agents routes', () => {
  it('needs a signed-in account', async () => {
    const { env } = agentEnv();
    expect((await call(env, 'agents')).status).toBe(401);
  });

  it('lists this account\'s live agents with their 24-hour use and the MCP URL', async () => {
    const { db, env } = agentEnv();
    seedUser(db, 'other');
    const agent = await seedAgent(env);
    await seedAgent(env, {}, 'other', 'Someone else');
    const gone = await seedAgent(env, {}, OWNER, 'Old laptop');
    db.prepare('UPDATE account_agents SET revoked_at = 1 WHERE id = ?').run(gone.id);
    await reserveCharge(env, agent, 'spent', { costUsd: 1.2, confidence: 'estimated' });
    const body = await (await call(env, 'agents', 'GET', await signedIn(env))).json();
    expect(body).toMatchObject({ accountId: OWNER, mcpUrl: 'http://localhost:8797/mcp', limits: { minUsd: 0.5, maxUsd: 500 } });
    expect(body.agents).toEqual([expect.objectContaining({ id: agent.id, name: 'Claude Code', budgetUsd: 5, usedUsd: 1.2, allowUnknownCost: false, allowDelete: false })]);
  });

  it('updates settings and refuses a limit outside the range', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    const cookie = await signedIn(env);
    const updated = await call(env, `agents/${agent.id}`, 'POST', cookie, { budgetUsd: 12, allowUnknownCost: true, allowDelete: true });
    expect(updated.status).toBe(200);
    expect((await updated.json()).agent).toMatchObject({ budgetUsd: 12, allowUnknownCost: true, allowDelete: true });
    const refused = await call(env, `agents/${agent.id}`, 'POST', cookie, { budgetUsd: 0.1, allowUnknownCost: false, allowDelete: false });
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe('invalid_budget');
  });

  it('refuses another account\'s agent', async () => {
    const { db, env } = agentEnv();
    seedUser(db, 'other');
    const theirs = await seedAgent(env, {}, 'other');
    expect((await call(env, `agents/${theirs.id}`, 'DELETE', await signedIn(env))).status).toBe(404);
  });

  it('disconnects an agent and revokes its grants, even when revocation fails', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    const { helpers, revoked } = grantHelpers([{ id: 'grant-1', userId: OWNER, metadata: { agentId: agent.id } }, { id: 'grant-2', userId: OWNER, metadata: { agentId: 'another' } }]);
    env.OAUTH_PROVIDER = helpers as never;
    expect((await call(env, `agents/${agent.id}`, 'DELETE', await signedIn(env))).status).toBe(200);
    expect(db.prepare('SELECT revoked_at FROM account_agents WHERE id = ?').get(agent.id)).not.toEqual({ revoked_at: null });
    expect(revoked).toEqual(['grant-1']);
    const second = await seedAgent(env);
    env.OAUTH_PROVIDER = { listUserGrants: vi.fn().mockRejectedValue(new Error('kv down')), revokeGrant: vi.fn() } as never;
    expect((await call(env, `agents/${second.id}`, 'DELETE', await signedIn(env))).status).toBe(200);
  });

  it('refuses a cross-site change', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    const response = await handleRequest(new Request(`http://localhost:8797/api/account/agents/${agent.id}`, { method: 'DELETE', headers: { origin: 'https://evil.example', cookie: await signedIn(env) } }), env);
    expect(response.status).toBe(403);
  });

  it('revokes every grant when the account is deleted', async () => {
    const { env } = agentEnv();
    const { helpers, revoked } = grantHelpers([{ id: 'g1', userId: OWNER, metadata: { agentId: 'a' } }, { id: 'g2', userId: OWNER, metadata: { agentId: 'b' } }]);
    env.OAUTH_PROVIDER = helpers as never;
    await deleteAccount(env, OWNER);
    expect(revoked.sort()).toEqual(['g1', 'g2']);
  });
});
