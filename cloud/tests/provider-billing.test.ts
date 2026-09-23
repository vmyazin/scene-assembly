import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { handleRequest } from '../src/index';
import type { Env } from '../src/security';

let db: DatabaseSync, env: Env, cookie: string;
async function call(path: string, method = 'GET', body?: unknown, cookies = cookie) {
  return handleRequest(new Request(`http://localhost:8797/api/account/${path}`, {
    method, headers: { origin: env.APP_ORIGIN, cookie: cookies },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
}
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  env = { DB: adapter(db), APP_ORIGIN: 'http://localhost:3097', DEV_ACCOUNT_EMAIL: 'creator@example.test', ACCOUNT_ENCRYPTION_KEYS: JSON.stringify({ '1': Buffer.alloc(32, 1).toString('base64') }), ACCOUNT_ENCRYPTION_VERSION: '1' };
  const login = await call('local-sign-in', 'POST', {}, '');
  cookie = login.headers.getSetCookie()[0].split(';')[0];
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });

describe('saved provider billing', () => {
  it('requires a session and reads only the current owner connection without exposing its key', async () => {
    expect((await call('provider-billing', 'GET', undefined, '')).status).toBe(401);
    await call('connections', 'POST', { provider: 'kie', apiKey: 'owner-secret-key' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: 200, data: 1700 }));
    const response = await call('provider-billing');
    const responseText = await response.text();
    expect(response.status).toBe(200);
    expect(responseText).toContain('1700');
    expect(responseText).not.toContain('owner-secret-key');
    expect((fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer owner-secret-key' });
    env.DEV_ACCOUNT_EMAIL = 'other@example.test';
    const otherLogin = await call('local-sign-in', 'POST', {}, '');
    const other = otherLogin.headers.getSetCookie()[0].split(';')[0];
    expect(await (await call('provider-billing', 'GET', undefined, other)).json()).toEqual({ results: [] });
  });
});
