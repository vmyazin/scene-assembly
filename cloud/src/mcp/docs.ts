import type { Env } from '../security';

/**
 * The public setup guide, served by the Next app: HTML at `/docs/mcp` for people,
 * Markdown at `/docs/mcp.md` for agents. `null` when `APP_ORIGIN` is unset or not a
 * URL, so nothing points an agent at a guide this deployment cannot serve.
 */
export function mcpGuideUrl(env: Env, format: 'html' | 'markdown' = 'html'): string | null {
  if (!env.APP_ORIGIN) return null;
  try {
    return `${new URL(env.APP_ORIGIN).origin}/docs/mcp${format === 'markdown' ? '.md' : ''}`;
  } catch {
    return null;
  }
}

const PROTECTED_RESOURCE_METADATA = '/.well-known/oauth-protected-resource';

/**
 * Adds RFC 9728's `resource_documentation` to the OAuth library's
 * protected-resource metadata. The library (1.2.1) builds that document from a
 * fixed list of fields and drops anything else passed in `resourceMetadata`, so
 * the field is added to its response here instead. Everything else about the
 * response is kept, CORS headers included, and any response this does not
 * recognise (another path, a HEAD, an error, a body that is not JSON) is
 * returned as it came.
 */
export async function withResourceDocumentation(request: Request, response: Response, env: Env): Promise<Response> {
  if (request.method !== 'GET' || response.status !== 200) return response;
  const path = new URL(request.url).pathname;
  if (path !== PROTECTED_RESOURCE_METADATA && !path.startsWith(`${PROTECTED_RESOURCE_METADATA}/`)) return response;
  if (!response.headers.get('Content-Type')?.startsWith('application/json')) return response;
  const documentation = mcpGuideUrl(env);
  if (!documentation) return response;
  let metadata: unknown;
  try {
    metadata = await response.clone().json();
  } catch {
    return response;
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length'); // the body grows; let the runtime measure it
  return new Response(JSON.stringify({ ...metadata, resource_documentation: documentation }), { status: response.status, statusText: response.statusText, headers });
}
