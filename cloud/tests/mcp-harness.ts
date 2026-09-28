import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { serveMcp, type ServeOptions } from '../src/mcp/handler';
import type { AgentRow } from '../src/mcp/agents';
import type { Env } from '../src/security';

/** A real MCP client wired straight into serveMcp: no network, no OAuth, the
 *  same protocol handling an agent's client performs. */
export async function connectAgent(env: Env, agent: Pick<AgentRow, 'id' | 'user_id'>, options: ServeOptions = {}) {
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
    fetch: (url, init) => serveMcp(new Request(url, init), env, { userId: agent.user_id, agentId: agent.id }, options),
  });
  const client = new Client({ name: 'scene-assembly-tests', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

export function structured<T = Record<string, unknown>>(result: { structuredContent?: unknown }): T {
  return result.structuredContent as T;
}

/** A clock the tools read and a sleep that advances it, so waits take no real time. */
export function fakeTime(start = 1_800_000_000_000, onSleep?: (now: number) => void) {
  let now = start;
  return {
    options: { now: () => now, sleep: async (ms: number) => { now += ms; onSleep?.(now); } } satisfies ServeOptions,
    advance(ms: number) { now += ms; },
  };
}
