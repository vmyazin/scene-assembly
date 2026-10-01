import type * as z from 'zod';
import type { ContentBlock, ToolAnnotations } from '@modelcontextprotocol/server';
import type { AgentRow } from './agents';
import type { Env } from '../security';

/** Everything a tool may use. `now` and `sleep` are injected so a 25-second
 *  wait costs a test nothing. */
export interface ToolContext {
  env: Env;
  agent: AgentRow;
  now(): number;
  sleep(ms: number): Promise<void>;
}
/** Which per-agent rate bucket a call spends: see AGENT_RATE_LIMITS. */
export type ToolKind = 'read' | 'write' | 'submit';
export interface ToolOutput { structured: Record<string, unknown>; text: string; content?: ContentBlock[] }
export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject<Shape>;
  kind: ToolKind;
  annotations: ToolAnnotations;
  /** Registered only when this returns true, so an agent never sees a tool its grant forbids. */
  available?(agent: AgentRow): boolean;
  run(ctx: ToolContext, args: z.infer<z.ZodObject<Shape>>): Promise<ToolOutput>;
}
export type AnyTool = ToolDefinition<z.ZodRawShape>;
export function defineTool<Shape extends z.ZodRawShape>(tool: ToolDefinition<Shape>): AnyTool {
  return tool as unknown as AnyTool;
}
