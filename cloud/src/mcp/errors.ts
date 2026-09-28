import type { CallToolResult } from '@modelcontextprotocol/server';
import { isRetryableStatus } from '../../../lib/providers/route-error';
import { AccountError } from '../jobs';

/** A refusal an agent can act on. Everything in `extra` reaches the model as structured data. */
export class ToolError extends Error {
  constructor(public code: string, message: string, public extra: Record<string, unknown> = {}, public retryable = false) {
    super(message);
  }
}

/** A tool result, not a protocol error, so the model reads the sentence. */
export function refusal(code: string, message: string, extra: Record<string, unknown> = {}, retryable = false): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }], structuredContent: { code, message, retryable, ...extra } };
}

/** Never serializes a raw error: provider and library messages can carry
 *  credentials, the same rule handleRequest keeps for OAuth. */
export function toRefusal(error: unknown): CallToolResult {
  if (error instanceof ToolError) return refusal(error.code, error.message, error.extra, error.retryable);
  if (error instanceof AccountError) return refusal(error.code, error.message, {}, isRetryableStatus(error.status));
  return refusal('internal_error', 'Scene Assembly could not complete this request. Try again shortly.', {}, true);
}
