import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/index';
import { cleanupAuthorizations } from '../src/mcp/auth';
import { createSession } from '../src/sessions';
import type { Env } from '../src/security';
import { agentEnv, connectProvider } from './agent-fixtures';
import { fakeOAuth } from './fake-oauth';

function setup() {
  const { db, env } = agentEnv({ CLOUD_GENERATION_PROVIDERS: 'kie,atlas' });
  const oauth = fakeOAuth();
  env.OAUTH_PROVIDER = oauth.helpers;
  return { db, env, oauth };
}
const signedIn = async (env: Env) => (await createSession(env, { subject: 'google-owner', email: 'owner@example.test', name: 'Owner' })).split(';')[0];
const worker = (env: Env, path: string, init: RequestInit = {}) => handleRequest(new Request(`http://localhost:8797${path}`, init), env);
const api = (env: Env, id: string, cookie: string, body?: unknown) => worker(env, `/api/account/agent-authorizations/${id}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { origin: env.APP_ORIGIN, cookie, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function begin(env: Env) {
  const response = await worker(env, '/oauth/authorize?client_id=client-1&response_type=code');
  const id = new URL(response.headers.get('Location')!).searchParams.get('request')!;
  const consentCookie = response.headers.get('Set-Cookie')!.split(';')[0];
  return { response, id, consentCookie };
}
const approve = { decision: 'approve', budgetUsd: 7.5, allowUnknownCost: true, allowDelete: false };

describe('agent consent', () => {
  it('refuses a malformed request with a page, not a redirect', async () => {
    const { env } = setup();
    const response = await worker(env, '/oauth/authorize');
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
  });

  it('parks the request and sends the browser to the consent page with the library\'s binding cookie', async () => {
    const { db, env } = setup();
    const { response, id } = await begin(env);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(`http://localhost:3097/connect-agent?request=${id}`);
    expect(response.headers.get('Set-Cookie')).toMatch(/^consent=/);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(db.prepare('SELECT client_name, redirect_host, decision FROM account_agent_authorizations').get()).toEqual({ client_name: 'Claude Code', redirect_host: '127.0.0.1', decision: null });
  });

  it('shows the request to the signed-in person with the providers a default grant refuses', async () => {
    const { db, env } = setup();
    connectProvider(db, 'kie');
    const { id } = await begin(env);
    expect((await api(env, id, '')).status).toBe(401);
    const view = (await (await api(env, id, await signedIn(env))).json()).authorization;
    expect(view).toMatchObject({ id, clientName: 'Claude Code', clientDomain: null, redirectHost: '127.0.0.1', redirectIsLoopback: true,
      defaults: { budgetUsd: 5, allowUnknownCost: false, allowDelete: false }, limits: { minUsd: 0.5, maxUsd: 500 } });
    expect(view.unknownPriceProviders).toEqual([{ label: 'Kie.ai', scope: 'all' }]);
  });

  it('approves into an agent with the chosen settings and hands the client its code', async () => {
    const { db, env, oauth } = setup();
    const { id, consentCookie } = await begin(env);
    const cookie = await signedIn(env);
    const decided = await api(env, id, cookie, approve);
    expect(await decided.json()).toEqual({ redirectTo: `http://localhost:8797/oauth/finish?request=${id}` });
    const finished = await worker(env, `/oauth/finish?request=${id}`, { headers: { cookie: consentCookie } });
    expect(finished.status).toBe(302);
    expect(finished.headers.get('Location')).toBe('http://127.0.0.1:6274/oauth/callback?code=code-1&state=state-1');
    const agent = db.prepare('SELECT * FROM account_agents').get() as Record<string, unknown>;
    expect(agent).toMatchObject({ user_id: 'owner', client_name: 'Claude Code', budget_micros: 7_500_000, allow_unknown_cost: 1, allow_delete: 0 });
    expect(oauth.completed[0]).toMatchObject({ userId: 'owner', scope: ['scene-assembly'], props: { userId: 'owner', agentId: agent.id }, metadata: { agentId: agent.id } });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_agent_authorizations').get()).toEqual({ n: 0 });
  });

  // Review focus 4: a double-clicked Approve, or a replayed finish link.
  it('records one decision and creates one agent however often it is replayed', async () => {
    const { db, env } = setup();
    const { id, consentCookie } = await begin(env);
    const cookie = await signedIn(env);
    expect((await api(env, id, cookie, approve)).status).toBe(200);
    const again = await api(env, id, cookie, approve);
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('already_decided');
    expect((await worker(env, `/oauth/finish?request=${id}`, { headers: { cookie: consentCookie } })).status).toBe(302);
    expect((await worker(env, `/oauth/finish?request=${id}`, { headers: { cookie: consentCookie } })).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_agents').get()).toEqual({ n: 1 });
  });

  it('does nothing when finished from a browser that did not start it', async () => {
    const { db, env } = setup();
    const { id } = await begin(env);
    await api(env, id, await signedIn(env), approve);
    const response = await worker(env, `/oauth/finish?request=${id}`, { headers: { cookie: 'consent=someone-else' } });
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/browser that opened this page/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_agents').get()).toEqual({ n: 0 });
  });

  it('sends a denial back to the client as access_denied', async () => {
    const { db, env } = setup();
    const { id, consentCookie } = await begin(env);
    await api(env, id, await signedIn(env), { decision: 'deny' });
    const response = await worker(env, `/oauth/finish?request=${id}`, { headers: { cookie: consentCookie } });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('error=access_denied');
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_agents').get()).toEqual({ n: 0 });
  });

  it('refuses an invalid limit, a cross-site decision, and an expired request', async () => {
    const { env } = setup();
    const { id } = await begin(env);
    const cookie = await signedIn(env);
    expect((await api(env, id, cookie, { ...approve, budgetUsd: 0.1 })).status).toBe(400);
    const crossSite = await worker(env, `/api/account/agent-authorizations/${id}`, { method: 'POST', headers: { origin: 'https://evil.example', cookie }, body: JSON.stringify(approve) });
    expect(crossSite.status).toBe(403);
    await cleanupAuthorizations(env, Date.now() + 11 * 60_000);
    expect((await api(env, id, cookie)).status).toBe(404);
  });
});
