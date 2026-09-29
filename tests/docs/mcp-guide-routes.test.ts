// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { GET as markdownGuide, dynamic as markdownDynamic } from '@/app/docs/mcp.md/route';
import { GET as llmsTxt, dynamic as llmsDynamic } from '@/app/llms.txt/route';
import sitemap from '@/app/sitemap';
import { brand } from '@/lib/brand';
import { fillGuidePlaceholders, readMcpGuide } from '@/lib/docs/mcp-guide';

describe('the MCP guide source', () => {
  it('fills in the MCP URL and the site URL and leaves no placeholder behind', () => {
    const guide = readMcpGuide();
    expect(guide).toContain(brand.mcpUrl);
    expect(guide).toContain(`${brand.siteUrl}/account`);
    expect(guide).not.toContain('{{');
  });

  it('refuses a placeholder it does not know, rather than publishing it', () => {
    expect(fillGuidePlaceholders('Connect to {{MCP_URL}} from {{SITE_URL}}.')).toBe(`Connect to ${brand.mcpUrl} from ${brand.siteUrl}.`);
    expect(() => fillGuidePlaceholders('See {{DOCS_URL}}.')).toThrow('{{DOCS_URL}}');
  });
});

describe('the guide for agents', () => {
  it('serves the Markdown at /docs/mcp.md', async () => {
    const response = await markdownGuide();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('https://mcp-sceneassembly.smoxu.com/mcp');
    expect(body).toBe(readMcpGuide());
  });

  it('lists the Markdown guide in /llms.txt', async () => {
    const response = await llmsTxt();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const body = await response.text();
    expect(body.startsWith('# Scene Assembly\n')).toBe(true);
    expect(body).toContain(`> ${brand.description}`);
    expect(body).toContain(`MCP server: ${brand.mcpUrl}`);
    expect(body).toContain('## Docs');
    expect(body).toContain('- [Connect an agent over MCP](https://sceneassembly.mzork.com/docs/mcp.md): ');
  });

  // Read at build time, so neither route depends on the file being traced
  // into a serverless function at runtime.
  it('prerenders both routes', () => {
    expect(markdownDynamic).toBe('force-static');
    expect(llmsDynamic).toBe('force-static');
  });
});

describe('the sitemap', () => {
  it('lists the setup guide', () => {
    expect(sitemap().map(entry => entry.url)).toContain('https://sceneassembly.mzork.com/docs/mcp');
  });
});
