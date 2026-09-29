import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { AgentAuthorizationView } from '../../../lib/account/contracts';
import { describeModels, type AgentProvider } from '../../../lib/account/model-schema';
import { unknownPriceProviders } from '../../../lib/spend/estimate';
import { consume } from '../ingress';
import { AccountError } from '../jobs';
import { enabledProviders } from '../providers';
import { hash, isLocal, json, randomToken, type Env } from '../security';
import { currentAccount } from '../sessions';
import { listConnections } from '../vault';
import { AGENT_BUDGET, createAgent, DEFAULT_AGENT_SETTINGS, normalizeClientName, parseAgentSettings, type AgentSettings } from './agents';

/** Open client registration is otherwise a free way to write to KV. */
export const REGISTRATIONS_PER_MINUTE = 20;
/** `/oauth/authorize` is an unauthenticated GET that inserts a D1 row; `/oauth/finish`
 *  is an unauthenticated GET that deletes one and, on approval, creates an agent and a
 *  grant. Both need their own per-IP ceiling for the same reason registration does. */
export const AUTHORIZE_STARTS_PER_MINUTE = 30;
export const FINISHES_PER_MINUTE = 30;

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
 * The origin `/mcp` is served from: `mcpResource` without its path, with the same
 * local fallback and the same `null` for "not configured". Every URL this Worker
 * builds on the MCP host — the `/oauth/finish` redirect, the 401's metadata link —
 * starts here rather than at the raw `MCP_ORIGIN`, so a trailing slash or a path in
 * that var can never make one of them disagree with the resource the library
 * advertises.
 */
export function mcpOrigin(env: Env): string | null {
  const resource = mcpResource(env);
  return resource ? new URL(resource).origin : null;
}

/** Plain text: unlike `/oauth/register` (an OAuth client), `/oauth/authorize` and
 *  `/oauth/finish` are pages a browser navigates to directly. */
function tooManyRequests(retryAfter: string) {
  return new Response('Too many requests. Try again in a minute.', {
    status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': retryAfter },
  });
}

/**
 * Applied by the entry wrapper before the OAuth library runs, for every route
 * that writes to D1 or KV on an unauthenticated request: registering a client
 * (the library's `clientRegistrationCallback` is not given `env`, so it can't
 * guard itself), starting a consent (`authorize` inserts a row per GET), and
 * finishing one (`finish` deletes a row and, on approval, creates an agent and a
 * grant, per GET). Each gets its own per-IP bucket, so a burst on one path never
 * spends another's budget. Registration answers in the OAuth error shape, since
 * its caller is an OAuth client; the other two answer in plain text, since their
 * caller is a browser tab.
 */
export async function guardRegistration(request: Request, env: Env, now = Date.now()): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (request.method === 'POST' && path === '/oauth/register') {
    const limited = await consume(env, `oauth-register:${ip}`, REGISTRATIONS_PER_MINUTE, now);
    if (!limited) return undefined;
    return new Response(JSON.stringify({ error: 'too_many_requests', error_description: 'Too many client registrations from this address. Try again in a minute.' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': limited.headers.get('Retry-After') ?? '60' },
    });
  }
  if (request.method === 'GET' && path === '/oauth/authorize') {
    const limited = await consume(env, `oauth-authorize:${ip}`, AUTHORIZE_STARTS_PER_MINUTE, now);
    return limited ? tooManyRequests(limited.headers.get('Retry-After') ?? '60') : undefined;
  }
  if (request.method === 'GET' && path === '/oauth/finish') {
    const limited = await consume(env, `oauth-finish:${ip}`, FINISHES_PER_MINUTE, now);
    return limited ? tooManyRequests(limited.headers.get('Retry-After') ?? '60') : undefined;
  }
  return undefined;
}

/** The library's consent transaction lives 600 s; ours matches it. */
export const AUTHORIZATION_TTL_MS = 600_000;

/** The token lifetimes entry.ts hands the OAuth provider, in its unit (seconds).
 *  They live here, not in entry.ts, because entry.ts loads the library — and
 *  `cloudflare:workers` with it — which the scheduled cleanup below, index.ts and
 *  their tests cannot import. */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
/** Counted from the code exchange and never extended: no `refreshTokenIdleTTL` is
 *  set, so rotating the refresh token keeps the grant's first expiry (spec
 *  follow-up 17). */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 86_400;
/** How long the library keeps a completed authorization's code redeemable (a
 *  fixed 600 s in `completeAuthorization`; not configurable). The refresh
 *  token's 30 days start at the exchange, so up to this long after the agent row. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 600;
const AGENT_SCOPE = ['scene-assembly'];
const EXPIRED = 'This connection request has expired or was already used. Start connecting again from your agent.';
const WRONG_BROWSER = 'Finish connecting in the browser that opened this page, then start again from your agent.';
const CONNECT_FAILED = 'Connecting this agent failed. Start connecting again from your agent.';
const NOT_CONFIGURED = 'Agent connections are not configured on this server.';

interface AuthorizationRow {
  id: string; consent_handle: string; description_json: string; client_id: string; client_name: string; redirect_host: string;
  decision: 'approved' | 'denied' | null; user_id: string | null; settings_json: string | null; finish_hash: string | null; expires_at: number;
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
  if (!helpers || !mcpResource(env)) return page(503, NOT_CONFIGURED);
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
    .bind(id, consent.handle, JSON.stringify(description), description.clientId, normalizeClientName(description.clientName), description.redirectHost, now + AUTHORIZATION_TTL_MS).run();
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
  // Checked before the decision is recorded: a decision with no finish link to
  // follow would strand the request until it expires.
  const origin = mcpOrigin(env);
  if (!origin) return json({ error: NOT_CONFIGURED }, 503);
  let settings: AgentSettings | null = null;
  if (decision === 'approved') {
    try { settings = parseAgentSettings(body); }
    catch (error) { if (error instanceof AccountError) return json({ error: error.message, code: error.code }, error.status); throw error; }
  }
  // The finish secret is returned only in this response, to the signed-in approver's
  // own browser — only D1 keeps the hash. Completing the connection then needs both
  // this secret and the library's binding cookie from the browser that started it, so
  // neither the starter nor a bystander who only has one of the two can redeem it.
  const secret = randomToken();
  const recorded = await env.DB.prepare('UPDATE account_agent_authorizations SET decision = ?, user_id = ?, settings_json = ?, finish_hash = ? WHERE id = ? AND decision IS NULL AND expires_at > ?')
    .bind(decision, account.id, settings ? JSON.stringify(settings) : null, await hash(secret), row.id, now).run();
  if (!recorded.meta.changes) return json({ error: 'This request was already answered.', code: 'already_decided' }, 409);
  return json({ redirectTo: `${origin}/oauth/finish?request=${row.id}&t=${secret}` });
}

/**
 * GET /oauth/finish?request=<id>&t=<secret>. A wrong or missing secret leaves
 * the pending request untouched and usable: a missing one is refused before any
 * query, and the consuming `DELETE` requires a matching `finish_hash`, so
 * guessing at someone else's `?request=` id cannot cancel their approval. The
 * correct secret consumes the request, and only then does the library check the
 * browser binding — so if that correct-secret link is opened in a browser
 * without the binding cookie, the request is consumed and the approval fails,
 * and the person starts over from their agent.
 *
 * The binding cookie alone proves which browser *started* the request, not
 * which one *approved* it — `/oauth/finish` cannot see the session cookie
 * (`__Host-sa_session` is host-only on `APP_ORIGIN`, a different origin), so
 * nothing here otherwise distinguishes the approving person from anyone who
 * gets sent the starter's `?request=` link while the decision is still
 * pending. `t` is the fix: a secret returned only in the POST response to the
 * signed-in approver's own browser, checked here against `finish_hash` before
 * the row is even read as a candidate. Completing a connection therefore needs
 * both the secret (proves who approved it) and the cookie (proves this is the
 * browser that started it) — neither alone is enough.
 */
export async function finish(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers) return page(503, NOT_CONFIGURED);
  const params = new URL(request.url).searchParams;
  const id = params.get('request');
  const t = params.get('t');
  if (!id || !/^[a-zA-Z0-9-]{1,64}$/.test(id) || !t) return page(400, EXPIRED);
  const row = await env.DB.prepare('DELETE FROM account_agent_authorizations WHERE id = ? AND decision IS NOT NULL AND finish_hash = ? AND expires_at > ? RETURNING *')
    .bind(id, await hash(t), now).first<AuthorizationRow>();
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
  // Consent is spent past this point: approveConsent already burned the library's
  // handle. A failure below must not surface as the gateway's generic JSON, and
  // must not leave an agent behind with no grant able to reach it.
  let agentId: string | undefined;
  try {
    const settings = parseAgentSettings(JSON.parse(row.settings_json ?? '{}'));
    const agent = await createAgent(env, { userId: row.user_id, clientId: row.client_id, clientName: row.client_name, settings }, now);
    agentId = agent.id;
    const { redirectTo } = await helpers.completeAuthorization({
      request: approved.request, userId: row.user_id, scope: AGENT_SCOPE,
      props: { userId: row.user_id, agentId: agent.id }, metadata: { agentId: agent.id, clientName: row.client_name },
    });
    const headers = new Headers(approved.headers);
    headers.set('Location', redirectTo);
    headers.set('Cache-Control', 'no-store');
    return new Response(null, { status: 302, headers });
  } catch {
    // Best effort: the page below is returned either way, so a second failure here
    // (D1 unavailable, say) must not replace the honest text with the gateway's 503.
    if (agentId) await env.DB.prepare('DELETE FROM account_agents WHERE id = ?').bind(agentId).run().catch(() => {});
    return page(500, CONNECT_FAILED);
  }
}

export async function cleanupAuthorizations(env: Env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM account_agent_authorizations WHERE expires_at <= ?').bind(now).run();
}

/**
 * Retires every agent no token can reach any more. `/oauth/finish` makes the row
 * and the grant together; the client exchanges the code within
 * AUTHORIZATION_CODE_TTL, its refresh token lapses REFRESH_TOKEN_TTL after that,
 * and the last access token minted just before then lapses ACCESS_TOKEN_TTL
 * later. Past all three the row only looks connected — and since every reconnect
 * makes a new row, each month would otherwise leave one more on the panel.
 * `revoked_at` hides it exactly as a Disconnect does; the row is never deleted,
 * so "via <name>" on the jobs and assets it started still resolves.
 */
export async function retireUnreachableAgents(env: Env, now = Date.now()) {
  const reachableFor = (AUTHORIZATION_CODE_TTL_SECONDS + REFRESH_TOKEN_TTL_SECONDS + ACCESS_TOKEN_TTL_SECONDS) * 1000;
  await env.DB.prepare('UPDATE account_agents SET revoked_at = ? WHERE revoked_at IS NULL AND created_at < ?').bind(now, now - reachableFor).run();
}
