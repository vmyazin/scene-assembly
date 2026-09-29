import { readMcpGuide } from '@/lib/docs/mcp-guide';

// Read at build time, so the file never has to be traced into a function.
export const dynamic = 'force-static';

/** The setup guide as Markdown, for agents: the same source /docs/mcp renders. */
export function GET() {
  return new Response(readMcpGuide(), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}
