import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { handleRequest } from '../src/index';
import { cookieName, hash, returnPath, type Env } from '../src/security';
import { googleIdentity } from '../src/google';
import { createSession } from '../src/sessions';
import { bootstrapLocalSchema } from '../src/schema';
vi.mock('../src/google', async importOriginal => ({ ...await importOriginal<object>(), googleIdentity: vi.fn() }));

let db: DatabaseSync;
let env: Env;

function request(path: string, method = 'GET', cookies = '', body = '{}', origin = env.APP_ORIGIN) {
  return handleRequest(new Request(`http://localhost:8791/api/account/${path}`, { method, headers: { origin, cookie: cookies }, ...(method === 'POST' ? { body } : {}) }), env);
}
function cookies(response: Response) { return response.headers.getSetCookie().map(v => v.split(';')[0]).join('; '); }
beforeEach(() => { db = new DatabaseSync(':memory:'); env = { DB: adapter(db), APP_ORIGIN: 'http://localhost:3091', DEV_ACCOUNT_EMAIL: 'creator@example.test', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' }; vi.mocked(googleIdentity).mockReset(); });
afterEach(() => db.close());

describe('account boundary', () => {
  it('upgrades pre-avatar local users without losing records and can bootstrap again', async () => {
    db.exec("CREATE TABLE account_users (id TEXT PRIMARY KEY, google_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL); INSERT INTO account_users VALUES ('existing', 'subject', 'existing@example.test', 'Existing', 1)");
    const responses = await Promise.all([request('session'), request('session')]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    await bootstrapLocalSchema(env.DB);
    expect(db.prepare('SELECT id, picture, relaxed_consent_at, relaxed_policy_version FROM account_users').get()).toEqual({ id: 'existing', picture: null, relaxed_consent_at: null, relaxed_policy_version: null });
  });
  it('persists, refreshes and clears the Google photo for the same subject', async () => {
    await request('session');
    const identity = { subject: 'photo-owner', email: 'photo@example.test', name: 'Photo', picture: 'https://lh3.googleusercontent.com/a/first' };
    const session = (await createSession(env, identity)).split(';')[0];
    const first = (await (await request('session', 'GET', session)).json()).account;
    expect(first.picture).toBe(identity.picture);
    await createSession(env, { ...identity, picture: 'https://lh3.googleusercontent.com/a/updated' });
    const updated = (await (await request('session', 'GET', session)).json()).account;
    expect(updated.id).toBe(first.id);
    expect(updated.picture).toBe('https://lh3.googleusercontent.com/a/updated');
    await createSession(env, { ...identity, picture: null });
    expect((await (await request('session', 'GET', session)).json()).account.picture).toBeNull();
  });
  it('bootstraps empty local storage; sessions persist and sign-out revokes', async () => {
    expect((await (await request('session')).json()).account).toBeNull();
    const login = await request('local-sign-in', 'POST');
    const sessionCookie = cookies(login);
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');
    const account = (await (await request('session', 'GET', sessionCookie)).json()).account;
    expect(account.email).toBe('creator@example.test');
    const rawToken = sessionCookie.split('=')[1];
    expect(db.prepare('SELECT token_hash FROM account_sessions').get()?.token_hash).toBe(await hash(rawToken));
    await request('sign-out', 'POST', sessionCookie);
    expect((await (await request('session', 'GET', sessionCookie)).json()).account).toBeNull();
  });
  it('blocks cross-origin mutations, even when a browser sends cookies', async () => {
    expect((await request('local-sign-in', 'POST', '', '{}', 'https://evil.test')).status).toBe(403);
    expect((await request('sign-in/google', 'POST', '', '{}', '')).status).toBe(403);
  });
  it('never enables local identity for a production origin', async () => {
    env.APP_ORIGIN = 'https://sceneassembly.mzork.com';
    expect((await request('local-sign-in', 'POST')).status).toBe(404);
    expect(cookieName(env, 'session')).toBe('__Host-sa_session');
  });
  it('rejects expired and ambiguous cookies', async () => {
    const login = await request('local-sign-in', 'POST');
    const cookie = cookies(login);
    expect((await (await request('session', 'GET', `${cookie}; ${cookie}`)).json()).account).toBeNull();
    db.exec('UPDATE account_sessions SET expires_at = 0');
    expect((await (await request('session', 'GET', cookie)).json()).account).toBeNull();
  });
  it('binds callback state to its browser and consumes it once', async () => {
    const start = await request('sign-in/google', 'POST', '', JSON.stringify({ returnTo: '/sign-up' }));
    const url = new URL((await start.json()).url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('nonce')).toBeTruthy();
    const callback = `callback/google?state=${url.searchParams.get('state')}&code=code`;
    const invalid = await request(callback);
    expect(invalid.headers.get('location')).toContain('signin-failed');
    expect(googleIdentity).not.toHaveBeenCalled();
    vi.mocked(googleIdentity).mockResolvedValue({ subject: 'google-user-1', email: 'one@example.test', name: 'One' });
    const result = await request(callback, 'GET', cookies(start));
    expect(result.headers.get('location')).toBe('http://localhost:3091/sign-up');
    expect((await (await request('session', 'GET', cookies(result))).json()).account.email).toBe('one@example.test');
    expect((await request(callback, 'GET', cookies(start))).headers.get('location')).toContain('signin-failed');
    expect(googleIdentity).toHaveBeenCalledTimes(1);
  });
  it('fails closed when Google rejects the token and never exposes its error', async () => {
    const start = await request('sign-in/google', 'POST');
    const url = new URL((await start.json()).url);
    vi.mocked(googleIdentity).mockRejectedValue(new Error('secret vendor payload'));
    const result = await request(`callback/google?state=${url.searchParams.get('state')}&code=x`, 'GET', cookies(start));
    expect(result.headers.get('location')).toContain('signin-failed');
    expect(await result.text()).not.toContain('secret');
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_sessions').get()?.n).toBe(0);
  });
  it('uses provider subject for identity and keeps independent sessions isolated', async () => {
    async function login(subject: string) {
      const start = await request('sign-in/google', 'POST');
      const url = new URL((await start.json()).url);
      vi.mocked(googleIdentity).mockResolvedValue({ subject, email: 'same@example.test', name: subject });
      return cookies(await request(`callback/google?state=${url.searchParams.get('state')}&code=x`, 'GET', cookies(start)));
    }
    const a = await login('a'), b = await login('b');
    const accountA = (await (await request('session', 'GET', a)).json()).account;
    const accountB = (await (await request('session', 'GET', b)).json()).account;
    expect(accountA.id).not.toBe(accountB.id);
    await request('sign-out', 'POST', a);
    expect((await (await request('session', 'GET', b)).json()).account.id).toBe(accountB.id);
  });
  it('rejects requests tied to a stale account identity',async()=>{
    const login=await request('local-sign-in','POST');
    const response=await handleRequest(new Request('http://localhost:8791/api/account/jobs',{headers:{cookie:cookies(login),'x-account-id':'another-owner'}}),env);
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('creator@example.test');
  });
  it('only permits local return destinations', () => {
    for (const input of ['https://evil.test', '//evil.test', '/\\evil.test', '/api/account/sign-out', '/\n/evil.test']) expect(returnPath(input)).toBe('/');
    expect(returnPath('/sign-up?from=studio')).toBe('/sign-up?from=studio');
  });
});
