import { describe, expect, it } from 'vitest';
import { activeAgent, createAgent, normalizeClientName, parseAgentSettings, touchAgent } from '../src/mcp/agents';
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

// A client names itself at registration, and that name is shown on the consent
// page and as "via <name>" on jobs. React escapes markup, but a bidi override
// (U+202E and friends) would still let a name render as something it is not.
describe('client names', () => {
  it('drops a right-to-left override and the other control and format characters', () => {
    expect(normalizeClientName('Claude\u202E edoC')).toBe('Claude edoC');
    expect(normalizeClientName('\u2066Claude\u2069 Code\u200B\u0007')).toBe('Claude Code');
  });
  it('collapses runs of whitespace, including tabs and newlines, and trims', () => {
    expect(normalizeClientName('  Claude\n\t  Code \u202E ')).toBe('Claude Code');
  });
  it('names a client whose name was only control characters, or nothing', () => {
    expect(normalizeClientName('\u202E\u0000\u2066\u200F')).toBe('Unnamed agent');
    expect(normalizeClientName('   ')).toBe('Unnamed agent');
    expect(normalizeClientName(undefined)).toBe('Unnamed agent');
  });
  it('keeps at most 120 characters', () => {
    expect(normalizeClientName('a'.repeat(200))).toBe('a'.repeat(120));
  });
});

describe('agent rows', () => {
  it('stores the limit in micro-dollars and names an unnamed client', async () => {
    const { env } = agentEnv();
    const agent = await createAgent(env, { userId: OWNER, clientId: 'c', clientName: '   ', settings: { budgetUsd: 2.5, allowUnknownCost: false, allowDelete: true } });
    expect(agent).toMatchObject({ user_id: OWNER, client_name: 'Unnamed agent', budget_micros: 2_500_000, allow_unknown_cost: 0, allow_delete: 1, revoked_at: null });
  });

  it('stores the client name without bidi overrides', async () => {
    const { env } = agentEnv();
    const agent = await createAgent(env, { userId: OWNER, clientId: 'c', clientName: 'Claude\u202E edoC', settings: { budgetUsd: 5, allowUnknownCost: false, allowDelete: false } });
    expect(agent.client_name).toBe('Claude edoC');
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
