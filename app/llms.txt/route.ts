import { brand } from '@/lib/brand';

export const dynamic = 'force-static';

/** llmstxt.org: what this site is, and the Markdown an agent should read. */
export function GET() {
  const body = [
    `# ${brand.name}`,
    '',
    `> ${brand.description}`,
    '',
    `MCP server: ${brand.mcpUrl} (streamable HTTP, OAuth). Setup guide: ${brand.siteUrl}/docs/mcp.md`,
    '',
    '## Docs',
    '',
    `- [Connect an agent over MCP](${brand.siteUrl}/docs/mcp.md): connect an MCP client to your account, then generate images and video within a spend limit you set. Setup, every tool and every refusal code.`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
