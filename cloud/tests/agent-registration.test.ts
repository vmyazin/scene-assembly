import { describe, expect, it } from 'vitest';
import { guardRegistration } from '../src/mcp/auth';
import { agentEnv } from './agent-fixtures';

const T0 = 1_800_000_000_000;
const register = (method = 'POST', path = '/oauth/register', ip = '203.0.113.7') =>
  new Request(`http://localhost:8797${path}`, { method, headers: { 'CF-Connecting-IP': ip } });

describe('client registration limit', () => {
  it('lets 20 registrations a minute through from one address, then answers as OAuth does', async () => {
    const { env } = agentEnv();
    for (let index = 0; index < 20; index++) expect(await guardRegistration(register(), env, T0)).toBeUndefined();
    const refused = await guardRegistration(register(), env, T0);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get('Retry-After')).toBeTruthy();
    expect(await refused?.json()).toMatchObject({ error: 'too_many_requests' });
    expect(await guardRegistration(register('POST', '/oauth/register', '198.51.100.1'), env, T0)).toBeUndefined();
  });

  it('counts only registrations', async () => {
    const { db, env } = agentEnv();
    expect(await guardRegistration(register('GET'), env, T0)).toBeUndefined();
    expect(await guardRegistration(register('POST', '/oauth/token'), env, T0)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_ingress_limits').get()).toEqual({ n: 0 });
  });
});
