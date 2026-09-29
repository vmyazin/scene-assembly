import { readFileSync } from 'node:fs';
import path from 'node:path';
import { brand } from '@/lib/brand';

/** The guide's source, next to the page that renders it. */
export const MCP_GUIDE_PATH = path.join(process.cwd(), 'app/docs/mcp/guide.md');

const PLACEHOLDERS: Record<string, string> = {
  MCP_URL: brand.mcpUrl,
  SITE_URL: brand.siteUrl,
};

/**
 * Writes the real URLs into the guide. Throws on anything left in braces, so a
 * misspelt placeholder fails the build instead of being published for agents
 * to copy.
 */
export function fillGuidePlaceholders(source: string): string {
  const filled = source.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, name: string) => {
    const value = PLACEHOLDERS[name];
    if (value === undefined) throw new Error(`Unknown placeholder ${placeholder} in the MCP guide.`);
    return value;
  });
  const leftover = /\{\{[^}]*\}\}?/.exec(filled);
  if (leftover) throw new Error(`Unfilled placeholder ${leftover[0]} in the MCP guide.`);
  return filled;
}

/**
 * The MCP setup guide as Markdown, with its URLs filled in. The page at
 * /docs/mcp renders it and /docs/mcp.md serves it as it is; both are static,
 * so this runs at build time.
 */
export function readMcpGuide(): string {
  return fillGuidePlaceholders(readFileSync(MCP_GUIDE_PATH, 'utf8'));
}
