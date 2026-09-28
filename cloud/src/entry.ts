import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { ensureLocalSchema, handleRequest, runScheduledMaintenance } from './index';
import { guardRegistration } from './mcp/auth';
import { mcpApiHandler } from './mcp/handler';
import type { Env } from './security';
export { GenerationWorkflow } from './workflow';

/**
 * OAuth 2.1 for agents (docs/claude/specs/2026-09-28-agent-mcp-design.md).
 * The library answers /mcp (with a validated token), /oauth/register,
 * /oauth/token and the .well-known metadata. Everything else — every existing
 * /api/account and /media route, and the consent pages /oauth/authorize and
 * /oauth/finish — reaches handleRequest exactly as before.
 *
 * Built per request, not once at module scope: the installed 1.2.1 types
 * (newer than the design doc anticipated) require `resourceMetadata.resource`,
 * a canonical absolute URL that differs by environment (MCP_ORIGIN — prod,
 * preview and local all point elsewhere), and `env` only exists inside
 * `fetch()`. The constructor does synchronous field assignment and
 * validation, no I/O, so building it per request adds no real cost.
 */
function buildProvider(env: Env) {
  return new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: mcpApiHandler,
    defaultHandler: { fetch: (request, env) => handleRequest(request, env as Env) },
    authorizeEndpoint: '/oauth/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: ['scene-assembly'],
    accessTokenTTL: 3600,
    refreshTokenTTL: 30 * 86_400,
    // A client identified by an https URL (as Claude.ai is) shows a verified domain on consent.
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: { resource: `${env.MCP_ORIGIN ?? 'http://localhost:8797'}/mcp` },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    await ensureLocalSchema(env);
    return (await guardRegistration(request, env)) ?? buildProvider(env).fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledController, env: Env) {
    await runScheduledMaintenance(env);
  },
} satisfies ExportedHandler<Env>;
