import { consume } from '../ingress';
import type { Env } from '../security';

/** Open client registration is otherwise a free way to write to KV. */
export const REGISTRATIONS_PER_MINUTE = 20;

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
