import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudJobRequest } from '../../lib/account/contracts';
import { runScheduledMaintenance } from '../src/index';
import { listJobs } from '../src/job-routes';
import { acceptJob } from '../src/jobs';
import { listAgents } from '../src/mcp/agent-routes';
import { activeAgent, createAgent, normalizeClientName, parseAgentSettings, touchAgent } from '../src/mcp/agents';
import { ACCESS_TOKEN_TTL_SECONDS, AUTHORIZATION_CODE_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, retireUnreachableAgents } from '../src/mcp/auth';
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

// Every reconnect makes a new row, and refresh tokens are fixed at 30 days from
// the code exchange (spec follow-up 17), so without this each month's stale row
// would sit on the panel looking connected forever.
describe('retiring agents no token can reach', () => {
  const settings = { budgetUsd: 5, allowUnknownCost: false, allowDelete: false };
  const connectedAt = 1_800_000_000_000;
  // The code can be exchanged up to its lifetime after the row is made; the
  // refresh token's 30 days start there, and the last access token it mints
  // outlives it by one access-token lifetime.
  const reachableFor = (AUTHORIZATION_CODE_TTL_SECONDS + REFRESH_TOKEN_TTL_SECONDS + ACCESS_TOKEN_TTL_SECONDS) * 1000;
  const request: CloudJobRequest = { provider: 'local-test', modelId: 'local-test', mediaType: 'image', inputMode: 'text', prompt: 'a kite', values: {}, referenceIds: [] };
  afterEach(() => { vi.useRealTimers(); });

  it('keeps an agent while a token could still reach it, then retires it without deleting it', async () => {
    const { db, env } = agentEnv();
    const agent = await createAgent(env, { userId: OWNER, clientId: 'c', clientName: 'Claude Code', settings }, connectedAt);
    await acceptJob(env, OWNER, 'retire-token-0000001', request, agent.id);
    await retireUnreachableAgents(env, connectedAt + reachableFor);
    expect(await activeAgent(env, agent.id, OWNER)).not.toBeNull();
    await retireUnreachableAgents(env, connectedAt + reachableFor + 1);
    expect(await activeAgent(env, agent.id, OWNER)).toBeNull();
    expect(db.prepare('SELECT client_name, revoked_at FROM account_agents WHERE id = ?').get(agent.id)).toEqual({ client_name: 'Claude Code', revoked_at: connectedAt + reachableFor + 1 });
    expect(await listAgents(env, OWNER, connectedAt + reachableFor + 1)).toEqual([]);
    // The row stays, so the work it started still says who started it.
    const [job] = await listJobs(env, OWNER, { states: null, limit: 10 });
    expect(job.startedBy).toEqual({ agentId: agent.id, name: 'Claude Code' });
  });

  it('leaves a disconnected agent\'s own disconnect time alone', async () => {
    const { db, env } = agentEnv();
    const agent = await createAgent(env, { userId: OWNER, clientId: 'c', clientName: 'Claude Code', settings }, connectedAt);
    db.prepare('UPDATE account_agents SET revoked_at = ? WHERE id = ?').run(connectedAt + 5, agent.id);
    await retireUnreachableAgents(env, connectedAt + reachableFor + 1);
    expect(db.prepare('SELECT revoked_at FROM account_agents WHERE id = ?').get(agent.id)).toEqual({ revoked_at: connectedAt + 5 });
  });

  it('runs with the scheduled maintenance', async () => {
    const { db, env } = agentEnv();
    const stale = await createAgent(env, { userId: OWNER, clientId: 'c', clientName: 'Old laptop', settings }, connectedAt);
    const fresh = await createAgent(env, { userId: OWNER, clientId: 'c', clientName: 'Claude Code', settings }, connectedAt + 29 * 86_400_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(connectedAt + reachableFor + 60_000);
    await runScheduledMaintenance(env);
    expect(db.prepare('SELECT revoked_at FROM account_agents WHERE id = ?').get(stale.id)).toEqual({ revoked_at: connectedAt + reachableFor + 60_000 });
    expect(db.prepare('SELECT revoked_at FROM account_agents WHERE id = ?').get(fresh.id)).toEqual({ revoked_at: null });
  });
});
