import { consume } from '../ingress';
import { isLocal, type Env } from '../security';

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
