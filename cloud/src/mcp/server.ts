import { McpServer, type CallToolResult, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import type * as z from 'zod';
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

/**
 * `registerTool` validates `tools/call` arguments against `inputSchema` itself,
 * before our callback ever runs, and on failure returns its own
 * `{ isError: true, content: [zod's raw text] }` with no `structuredContent` —
 * bypassing `runTool` entirely and breaking the rule that every refusal is
 * `{ code, message, retryable, … }`. This wrapper still publishes `tool.input`'s
 * real JSON Schema for `tools/list` (`~standard.jsonSchema`, unchanged) so an
 * agent still sees the true shape, but its `validate` always succeeds — the
 * real check happens in `runTool` via `tool.input.safeParse`, so a bad call
 * always gets a structured `invalid_field` refusal instead of the SDK's own text.
 */
function passthroughSchema(schema: z.ZodTypeAny): StandardSchemaWithJSON {
  const std = (schema as unknown as StandardSchemaWithJSON)['~standard'];
  return { '~standard': { version: 1, vendor: std.vendor, jsonSchema: std.jsonSchema, validate: (value: unknown) => ({ value }) } };
}

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'scene-assembly', version: '1.0.0' }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of TOOLS) {
    if (tool.available && !tool.available(ctx.agent)) continue;
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: passthroughSchema(tool.input), annotations: tool.annotations },
      args => runTool(ctx, tool, args));
  }
  return server;
}

/** The field named by the first issue in a failed `safeParse`, and the values
 *  it would have accepted when the issue carries them (e.g. an enum). */
function fieldRefusal(error: z.ZodError): CallToolResult {
  const issue = error.issues[0];
  const field = issue.path.length ? issue.path.map(String).join('.') : '(input)';
  const allowed = (issue as { values?: unknown[] }).values;
  return refusal('invalid_field', `"${field}": ${issue.message}`, { field, ...(allowed ? { allowed } : {}) }, false);
}

export async function runTool(ctx: ToolContext, tool: AnyTool, args: unknown): Promise<CallToolResult> {
  try {
    const limited = await consume(ctx.env, `agent:${ctx.agent.id}:${tool.kind}`, AGENT_RATE_LIMITS[tool.kind], ctx.now());
    if (limited) {
      return refusal('rate_limited', 'This agent is sending requests too quickly. Wait before trying again.', { retryAfterSeconds: Number(limited.headers.get('Retry-After') ?? 60) }, true);
    }
    const parsed = tool.input.safeParse(args);
    if (!parsed.success) return fieldRefusal(parsed.error);
    const output = await tool.run(ctx, parsed.data as never);
    return { content: [{ type: 'text', text: output.text }, ...(output.content ?? [])], structuredContent: output.structured };
  } catch (error) {
    return toRefusal(error);
  }
}
