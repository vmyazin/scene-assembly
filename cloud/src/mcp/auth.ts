import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { AgentAuthorizationView } from '../../../lib/account/contracts';
import { describeModels, type AgentProvider } from '../../../lib/account/model-schema';
import { unknownPriceProviders } from '../../../lib/spend/estimate';
import { consume } from '../ingress';
import { AccountError } from '../jobs';
import { enabledProviders } from '../providers';
import { isLocal, json, type Env } from '../security';
import { currentAccount } from '../sessions';
import { listConnections } from '../vault';
import { AGENT_BUDGET, createAgent, DEFAULT_AGENT_SETTINGS, parseAgentSettings, type AgentSettings } from './agents';

/** Open client registration is otherwise a free way to write to KV. */
export const REGISTRATIONS_PER_MINUTE = 20;

/** Used only when a local env has no MCP_ORIGIN at all (e.g. `wrangler dev` run directly,
 *  bypassing scripts/dev-account-services.mjs, which always writes one). */
const LOCAL_MCP_RESOURCE = 'http://localhost:8797/mcp';

/**
 * The canonical RFC 9728 resource identifier for `/mcp`, derived from `MCP_ORIGIN`. Pure
 * and free of the OAuth library so it can be unit-tested directly: the library's own
 * validation throws a raw `TypeError` for anything that isn't a canonical absolute HTTPS
 * URL (or HTTP on a loopback host) — a bad or missing `MCP_ORIGIN` would otherwise crash
 * every request behind entry.ts's `OAuthProvider`, not just agent traffic. `null` means
 * "not configured": entry.ts then serves only the library's own paths, refused with a
 * 503, and every other route keeps working exactly as if agents were never wired in.
 */
export function mcpResource(env: Env): string | null {
  const configured = env.MCP_ORIGIN;
  if (configured) {
    try {
      const url = new URL(configured);
      const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return `${url.origin}/mcp`;
    } catch { /* Neither a usable origin nor a local fallback candidate; fall through. */ }
  }
  return isLocal(env) ? LOCAL_MCP_RESOURCE : null;
}

/**
 * Applied by the entry wrapper before the OAuth library runs, because the
 * library's clientRegistrationCallback is not given `env`. Answers in the OAuth
 * error shape, since the caller is an OAuth client, not the app.
 */
export async function guardRegistration(request: Request, env: Env, now = Date.now()): Promise<Response | undefined> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/oauth/register') return undefined;
  const limited = await consume(env, `oauth-register:${request.headers.get('CF-Connecting-IP') ?? 'unknown'}`, REGISTRATIONS_PER_MINUTE, now);
  if (!limited) return undefined;
  return new Response(JSON.stringify({ error: 'too_many_requests', error_description: 'Too many client registrations from this address. Try again in a minute.' }), {
    status: 429, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': limited.headers.get('Retry-After') ?? '60' },
  });
}

/** The library's consent transaction lives 600 s; ours matches it. */
export const AUTHORIZATION_TTL_MS = 600_000;
const AGENT_SCOPE = ['scene-assembly'];
const EXPIRED = 'This connection request has expired or was already used. Start connecting again from your agent.';
const WRONG_BROWSER = 'Finish connecting in the browser that opened this page, then start again from your agent.';

interface AuthorizationRow {
  id: string; consent_handle: string; description_json: string; client_id: string; client_name: string; redirect_host: string;
  decision: 'approved' | 'denied' | null; user_id: string | null; settings_json: string | null; expires_at: number;
}

/** Plain text on purpose: every message is ours, and a text page cannot become markup. */
function page(status: number, message: string) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

/**
 * GET /oauth/authorize. Parks the request and sends the browser to the app,
 * where the person is signed in. The library's beginConsent cookie binds the
 * request to this browser: /oauth/finish only completes in the browser that
 * started it, which is what stops a link to someone else's pending request
 * from being approved by the wrong person.
 */
export async function authorize(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers || !env.MCP_ORIGIN) return page(503, 'Agent connections are not configured on this server.');
  let description: ConsentDescription, consent: { handle: string; headers: Headers }, authRequest;
  try {
    authRequest = await helpers.parseAuthRequest(request);
    description = await helpers.describeConsent(authRequest);
    consent = await helpers.beginConsent(authRequest);
  } catch {
    return page(400, 'This connection request is not valid. Start connecting again from your agent.');
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO account_agent_authorizations (id, consent_handle, description_json, client_id, client_name, redirect_host, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, consent.handle, JSON.stringify(description), description.clientId, description.clientName.trim().slice(0, 120) || 'Unnamed agent', description.redirectHost, now + AUTHORIZATION_TTL_MS).run();
  const headers = new Headers(consent.headers);
  headers.set('Location', `${env.APP_ORIGIN}/connect-agent?request=${id}`);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 303, headers });
}

async function authorizationView(env: Env, userId: string, row: AuthorizationRow): Promise<AgentAuthorizationView> {
  const description = JSON.parse(row.description_json) as ConsentDescription;
  const connected = (await listConnections(env, userId)).map(connection => (connection as { provider: string }).provider);
  const providers = enabledProviders(env).filter(provider => connected.includes(provider)) as AgentProvider[];
  return {
    id: row.id, clientName: row.client_name, clientDomain: description.clientDomain ?? null,
    redirectHost: row.redirect_host, redirectIsLoopback: description.redirectIsLoopback, expiresAt: row.expires_at,
    unknownPriceProviders: unknownPriceProviders(describeModels(providers)).map(({ label, scope }) => ({ label, scope })),
    defaults: DEFAULT_AGENT_SETTINGS, limits: { minUsd: AGENT_BUDGET.minUsd, maxUsd: AGENT_BUDGET.maxUsd },
  };
}

/** /api/account/agent-authorizations/:id, called by /connect-agent through the
 *  gateway, so the session cookie and the Origin check apply as to any write. */
export async function authorizationRoutes(request: Request, env: Env, now = Date.now()): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(/^\/api\/account\/agent-authorizations\/([a-zA-Z0-9-]+)$/);
  if (!match) return null;
  const account = await currentAccount(request, env);
  if (!account) return json({ error: 'Sign in to connect an agent.' }, 401);
  const row = await env.DB.prepare('SELECT * FROM account_agent_authorizations WHERE id = ? AND expires_at > ?').bind(match[1], now).first<AuthorizationRow>();
  if (request.method === 'GET') {
    if (!row || row.decision) return json({ error: EXPIRED, code: 'authorization_expired' }, 404);
    return json({ authorization: await authorizationView(env, account.id, row) });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!row) return json({ error: EXPIRED, code: 'authorization_expired' }, 404);
  let body: Record<string, unknown>;
  try { body = JSON.parse((await request.text()) || '{}'); } catch { return json({ error: 'Invalid request.' }, 400); }
  const decision = body.decision === 'approve' ? 'approved' : body.decision === 'deny' ? 'denied' : null;
  if (!decision) return json({ error: 'Choose Approve or Deny.', code: 'invalid_request' }, 400);
  let settings: AgentSettings | null = null;
  if (decision === 'approved') {
    try { settings = parseAgentSettings(body); }
    catch (error) { if (error instanceof AccountError) return json({ error: error.message, code: error.code }, error.status); throw error; }
  }
  const recorded = await env.DB.prepare('UPDATE account_agent_authorizations SET decision = ?, user_id = ?, settings_json = ? WHERE id = ? AND decision IS NULL AND expires_at > ?')
    .bind(decision, account.id, settings ? JSON.stringify(settings) : null, row.id, now).run();
  if (!recorded.meta.changes) return json({ error: 'This request was already answered.', code: 'already_decided' }, 409);
  return json({ redirectTo: `${env.MCP_ORIGIN}/oauth/finish?request=${row.id}` });
}

/**
 * GET /oauth/finish. Consumes the decided request, then lets the library check
 * the browser binding. Consumed first, so a link opened in the wrong browser
 * burns the request instead of leaving it to be tried again.
 */
export async function finish(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers) return page(503, 'Agent connections are not configured on this server.');
  const id = new URL(request.url).searchParams.get('request');
  if (!id || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) return page(400, EXPIRED);
  const row = await env.DB.prepare('DELETE FROM account_agent_authorizations WHERE id = ? AND decision IS NOT NULL AND expires_at > ? RETURNING *')
    .bind(id, now).first<AuthorizationRow>();
  if (!row || !row.user_id) return page(400, EXPIRED);
  if (row.decision === 'denied') {
    try {
      const denied = await helpers.denyConsent(request, row.consent_handle);
      return new Response(null, { status: 302, headers: denied.headers });
    } catch { return page(400, WRONG_BROWSER); }
  }
  let approved;
  try { approved = await helpers.approveConsent(request, row.consent_handle, { scope: AGENT_SCOPE }); }
  catch { return page(400, WRONG_BROWSER); }
  const settings = parseAgentSettings(JSON.parse(row.settings_json ?? '{}'));
  const agent = await createAgent(env, { userId: row.user_id, clientId: row.client_id, clientName: row.client_name, settings }, now);
  const { redirectTo } = await helpers.completeAuthorization({
    request: approved.request, userId: row.user_id, scope: AGENT_SCOPE,
    props: { userId: row.user_id, agentId: agent.id }, metadata: { agentId: agent.id, clientName: row.client_name },
  });
  const headers = new Headers(approved.headers);
  headers.set('Location', redirectTo);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers });
}

export async function cleanupAuthorizations(env: Env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM account_agent_authorizations WHERE expires_at <= ?').bind(now).run();
}
