import { describe, expect, it } from 'vitest';
import { AUTHORIZE_STARTS_PER_MINUTE, FINISHES_PER_MINUTE, REGISTRATIONS_PER_MINUTE, guardRegistration } from '../src/mcp/auth';
import { agentEnv } from './agent-fixtures';

const T0 = 1_800_000_000_000;
const register = (method = 'POST', path = '/oauth/register', ip = '203.0.113.7') =>
  new Request(`http://localhost:8797${path}`, { method, headers: { 'CF-Connecting-IP': ip } });
const browserGet = (path: string, ip = '203.0.113.7') =>
  new Request(`http://localhost:8797${path}`, { headers: { 'CF-Connecting-IP': ip } });

describe('client registration limit', () => {
  it('lets 20 registrations a minute through from one address, then answers as OAuth does', async () => {
    const { env } = agentEnv();
    for (let index = 0; index < REGISTRATIONS_PER_MINUTE; index++) expect(await guardRegistration(register(), env, T0)).toBeUndefined();
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

// Fix round 1, finding 2: /oauth/authorize and /oauth/finish are unauthenticated
// GETs that each write to D1 (a parked row, or an agent + a grant), so they get
// the same per-IP guard as registration — in their own buckets, answered in plain
// text since a browser navigates to them directly rather than an OAuth client.
describe('oauth entry rate limits', () => {
  it('lets 30 authorize starts a minute through from one address, then answers 429 in plain text', async () => {
    const { env } = agentEnv();
    for (let index = 0; index < AUTHORIZE_STARTS_PER_MINUTE; index++) expect(await guardRegistration(browserGet('/oauth/authorize?client_id=c'), env, T0)).toBeUndefined();
    const refused = await guardRegistration(browserGet('/oauth/authorize?client_id=c'), env, T0);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get('Content-Type')).toContain('text/plain');
    expect(refused?.headers.get('Retry-After')).toBeTruthy();
    expect(await guardRegistration(browserGet('/oauth/authorize?client_id=c', '198.51.100.1'), env, T0)).toBeUndefined();
  });

  it('lets 30 finishes a minute through from one address, then answers 429 in plain text', async () => {
    const { env } = agentEnv();
    for (let index = 0; index < FINISHES_PER_MINUTE; index++) expect(await guardRegistration(browserGet('/oauth/finish?request=x'), env, T0)).toBeUndefined();
    const refused = await guardRegistration(browserGet('/oauth/finish?request=x'), env, T0);
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get('Content-Type')).toContain('text/plain');
    expect(refused?.headers.get('Retry-After')).toBeTruthy();
    expect(await guardRegistration(browserGet('/oauth/finish?request=x', '198.51.100.1'), env, T0)).toBeUndefined();
  });

  it('keeps registration, authorize and finish in separate buckets for the same address', async () => {
    const { env } = agentEnv();
    const ip = '203.0.113.9';
    for (let index = 0; index < AUTHORIZE_STARTS_PER_MINUTE; index++) expect(await guardRegistration(browserGet('/oauth/authorize?client_id=c', ip), env, T0)).toBeUndefined();
    expect((await guardRegistration(browserGet('/oauth/authorize?client_id=c', ip), env, T0))?.status).toBe(429);
    // The same address, spent on authorize, is untouched on finish and registration.
    expect(await guardRegistration(browserGet('/oauth/finish?request=x', ip), env, T0)).toBeUndefined();
    expect(await guardRegistration(register('POST', '/oauth/register', ip), env, T0)).toBeUndefined();
  });
});
