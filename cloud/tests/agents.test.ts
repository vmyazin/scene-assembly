import { describe, expect, it } from 'vitest';
import { activeAgent, createAgent, parseAgentSettings, touchAgent } from '../src/mcp/agents';
import { agentEnv, OWNER, seedAgent, seedUser } from './agent-fixtures';

describe('agent settings', () => {
  it('accepts a limit inside the offered range, rounded to cents', () => {
    expect(parseAgentSettings({ budgetUsd: 4.999, allowUnknownCost: true, allowDelete: false })).toEqual({ budgetUsd: 5, allowUnknownCost: true, allowDelete: false });
  });
  it.each([0.49, 500.01, Number.NaN, '5'])('refuses a limit of %s', budgetUsd => {
    expect(() => parseAgentSettings({ budgetUsd, allowUnknownCost: false, allowDelete: false })).toThrow(expect.objectContaining({ code: 'invalid_budget' }));
  });
  it('refuses toggles that are not booleans', () => {
    expect(() => parseAgentSettings({ budgetUsd: 5, allowUnknownCost: 'yes', allowDelete: false })).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });
});

describe('agent rows', () => {
  it('stores the limit in micro-dollars and names an unnamed client', async () => {
    const { env } = agentEnv();
    const agent = await createAgent(env, { userId: OWNER, clientId: 'c', clientName: '   ', settings: { budgetUsd: 2.5, allowUnknownCost: false, allowDelete: true } });
    expect(agent).toMatchObject({ user_id: OWNER, client_name: 'Unnamed agent', budget_micros: 2_500_000, allow_unknown_cost: 0, allow_delete: 1, revoked_at: null });
  });

  it('finds an agent only for its owner, and never once revoked or orphaned', async () => {
    const { db, env } = agentEnv();
    seedUser(db, 'other');
    const agent = await seedAgent(env);
    expect(await activeAgent(env, agent.id, OWNER)).toMatchObject({ id: agent.id });
    expect(await activeAgent(env, agent.id, 'other')).toBeNull();
    db.prepare('UPDATE account_agents SET revoked_at = 1 WHERE id = ?').run(agent.id);
    expect(await activeAgent(env, agent.id, OWNER)).toBeNull();
    const second = await seedAgent(env);
    db.prepare('DELETE FROM account_users WHERE id = ?').run(OWNER);
    expect(await activeAgent(env, second.id, OWNER)).toBeNull();
  });

  it('records use at most once a minute', async () => {
    const { db, env } = agentEnv();
    const agent = await seedAgent(env);
    await touchAgent(env, agent.id, 100_000);
    await touchAgent(env, agent.id, 130_000);
    expect(db.prepare('SELECT last_used_at FROM account_agents').get()).toEqual({ last_used_at: 100_000 });
    await touchAgent(env, agent.id, 161_000);
    expect(db.prepare('SELECT last_used_at FROM account_agents').get()).toEqual({ last_used_at: 161_000 });
  });
});
