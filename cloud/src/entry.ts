import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { ensureLocalSchema, handleRequest, runScheduledMaintenance } from './index';
import { ACCESS_TOKEN_TTL_SECONDS, guardRegistration, mcpResource, REFRESH_TOKEN_TTL_SECONDS } from './mcp/auth';
import { mcpApiHandler } from './mcp/handler';
import { json, type Env } from './security';
export { GenerationWorkflow } from './workflow';

/**
 * Paths the OAuth library itself answers. When `mcpResource` finds no usable
 * `MCP_ORIGIN` (see below), only these get the "not configured" 503 — every
 * other route, including the app's own /oauth/authorize and /oauth/finish
 * consent pages, reaches `handleRequest` exactly as if agents were never
 * wired in.
 */
function isOAuthLibraryPath(pathname: string): boolean {
  return pathname === '/mcp' || pathname === '/oauth/register' || pathname === '/oauth/token' || pathname.startsWith('/.well-known/oauth-');
}

/**
 * One `OAuthProvider` per distinct resource string, built once and reused —
 * not per request. `mcpResource(env)` already validated the string, so the
 * library's own constructor-time validation (a raw `TypeError` for anything
 * that isn't a canonical absolute HTTPS URL, or HTTP on a loopback host)
 * never fires here; memoizing just avoids repeating that validation, and the
 * library's own `resolveConsent`/token helpers, on every request. `env` is
 * never captured by the provider itself — the library passes it fresh into
 * every `.fetch()` call — so reusing the object across requests is safe even
 * though bindings and secrets differ per invocation.
 */
const providers = new Map<string, OAuthProvider<Env>>();
function providerFor(resource: string): OAuthProvider<Env> {
  let provider = providers.get(resource);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: mcpApiHandler,
      defaultHandler: { fetch: (request, env) => handleRequest(request, env as Env) },
      authorizeEndpoint: '/oauth/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['scene-assembly'],
      // The scheduled cleanup reads the same two constants to retire agent rows
      // no token can reach any more (retireUnreachableAgents).
      accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
      // Off for now: enabling this flips global_fetch_strictly_public for every outbound
      // fetch this Worker makes, which needs its own decision. Every client registers
      // through DCR and shows as unverified until that decision is made (design doc
      // follow-up 15).
      clientIdMetadataDocumentEnabled: false,
      resourceMetadata: { resource },
    });
    providers.set(resource, provider);
  }
  return provider;
}

const NOT_CONFIGURED = () => json({ error: 'Agent connections are not configured.' }, 503);
/** Same wording and shape as handleRequest's own catch-all, for the same reason: never
 *  serialize an OAuth error, since a vendor or library payload may carry credentials. */
const UNAVAILABLE = () => json({ error: 'Account service is temporarily unavailable. Guest generation is still available.' }, 503);

/**
 * OAuth 2.1 for agents (docs/claude/specs/2026-09-28-agent-mcp-design.md).
 * The library answers /mcp (with a validated token), /oauth/register,
 * /oauth/token and the .well-known metadata. Everything else — every existing
 * /api/account and /media route, and the consent pages /oauth/authorize and
 * /oauth/finish — reaches handleRequest exactly as before.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      await ensureLocalSchema(env);
      const registrationLimited = await guardRegistration(request, env);
      if (registrationLimited) return registrationLimited;
      const resource = mcpResource(env);
      if (!resource) return isOAuthLibraryPath(new URL(request.url).pathname) ? NOT_CONFIGURED() : handleRequest(request, env);
      return await providerFor(resource).fetch(request, env, ctx);
    } catch {
      return UNAVAILABLE();
    }
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await runScheduledMaintenance(env);
  },
} satisfies ExportedHandler<Env>;
