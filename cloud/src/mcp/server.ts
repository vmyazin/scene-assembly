import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { consume } from '../ingress';
import { refusal, toRefusal } from './errors';
import type { AnyTool, ToolContext } from './tool';
import { TOOLS } from './tools';

/** Per agent per minute. Submissions are the ones that cost money. */
export const AGENT_RATE_LIMITS = { read: 300, write: 60, submit: 10 } as const;

export const SERVER_INSTRUCTIONS = [
  'Scene Assembly generates images and video with the provider keys connected to this person\'s account and saves every result to their library.',
  'Work in this order: list_models (pass provider and modelId to see a model\'s settings), estimate_cost, generate with an idempotencyKey you reuse when retrying the same request, get_job with waitSeconds until the job is saved, then view_asset to look at an image.',
  'Every job is charged against a spend limit the person set for this agent. A budget_exceeded refusal includes roomAt, when enough room frees up: tell the person rather than retrying sooner.',
  'Download links expire after a few minutes and work for anyone holding them. Do not share them.',
].join('\n');

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'scene-assembly', version: '1.0.0' }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of TOOLS) {
    if (tool.available && !tool.available(ctx.agent)) continue;
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
      args => runTool(ctx, tool, args));
  }
  return server;
}

export async function runTool(ctx: ToolContext, tool: AnyTool, args: unknown): Promise<CallToolResult> {
  const limited = await consume(ctx.env, `agent:${ctx.agent.id}:${tool.kind}`, AGENT_RATE_LIMITS[tool.kind], ctx.now());
  if (limited) {
    return refusal('rate_limited', 'This agent is sending requests too quickly. Wait before trying again.', { retryAfterSeconds: Number(limited.headers.get('Retry-After') ?? 60) }, true);
  }
  try {
    const output = await tool.run(ctx, args as never);
    return { content: [{ type: 'text', text: output.text }, ...(output.content ?? [])], structuredContent: output.structured };
  } catch (error) {
    return toRefusal(error);
  }
}
