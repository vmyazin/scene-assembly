import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { BodyTooLargeError, boundedBody } from '../ingress';
import type { Env } from '../security';
import { activeAgent, touchAgent } from './agents';
import { createServer } from './server';
import type { ToolContext } from './tool';

export const MCP_BODY_LIMIT = 65_536;
/** What an access token carries, and nothing else (encrypted by the OAuth library). */
export interface AgentProps { userId: string; agentId: string }
export interface ServeOptions { now?: () => number; sleep?: (ms: number) => Promise<void> }

function unauthorized() {
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'This agent is no longer connected. Connect it again from the agent.' }), {
    status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'WWW-Authenticate': 'Bearer error="invalid_token"' },
  });
}

/**
 * One MCP request from one agent. The token was already validated by the OAuth
 * library; the D1 row is checked again here because it — not the grant in KV —
 * is what a disconnect or an account deletion changes.
 */
export async function serveMcp(request: Request, env: Env, props: AgentProps | undefined, options: ServeOptions = {}): Promise<Response> {
  if (!props?.agentId || !props.userId) return unauthorized();
  const agent = await activeAgent(env, props.agentId, props.userId);
  if (!agent) return unauthorized();
  if (request.method === 'POST') {
    try {
      request = new Request(request.url, { method: 'POST', headers: request.headers, body: await boundedBody(request, MCP_BODY_LIMIT) });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return new Response(JSON.stringify({ error: 'Request is too large.' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
      throw error;
    }
  }
  const now = options.now ?? Date.now;
  await touchAgent(env, agent.id, now());
  const ctx: ToolContext = { env, agent, now, sleep: options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))) };
  const handler = createMcpHandler(() => createServer(ctx), { legacy: 'stateless' });
  const authInfo: AuthInfo = { token: 'redacted', clientId: agent.client_id, scopes: ['scene-assembly'], extra: { agentId: agent.id } };
  return handler.fetch(request, { authInfo });
}

/**
 * The OAuth library's apiHandler: it puts the token's props on ctx.props. The
 * library types that as `unknown` (OAuthProviderOptions is not generic over
 * Props), so the cast happens here rather than in the parameter type — typing
 * the parameter itself as `ExecutionContext & { props?: AgentProps }` fails
 * the library's own contravariant check against `ExecutionContext<unknown>`.
 */
export const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return serveMcp(request, env, ctx.props as AgentProps | undefined);
  },
};
