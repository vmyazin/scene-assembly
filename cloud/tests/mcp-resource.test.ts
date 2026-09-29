import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mcpResource } from '../src/mcp/auth';
import { agentEnv } from './agent-fixtures';

// Read the deployed configuration the same way tests/providers-config.test.ts does: a
// wrangler.jsonc value dropped from `vars` would otherwise only fail once deployed.
function configuredVars(path: string): Record<string, string> {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return JSON.parse(source.replace(/^\s*\/\/.*$/gm, '')).vars;
}

const PROD_APP_ORIGIN = 'https://sceneassembly.mzork.com';

describe('mcpResource', () => {
  it('derives the canonical /mcp resource from each checked-in MCP_ORIGIN', () => {
    for (const path of ['../wrangler.jsonc', '../wrangler.preview.jsonc']) {
      const vars = configuredVars(path);
      const { env } = agentEnv({ APP_ORIGIN: vars.APP_ORIGIN, MCP_ORIGIN: vars.MCP_ORIGIN });
      expect(mcpResource(env)).toBe(`${new URL(vars.MCP_ORIGIN).origin}/mcp`);
    }
  });

  it('normalizes a trailing slash and an uppercase host', () => {
    const { env } = agentEnv({ APP_ORIGIN: PROD_APP_ORIGIN, MCP_ORIGIN: 'HTTPS://MCP.Example.COM/' });
    expect(mcpResource(env)).toBe('https://mcp.example.com/mcp');
  });

  it('refuses an unset, empty, or non-loopback http origin in production', () => {
    const base = { APP_ORIGIN: PROD_APP_ORIGIN };
    expect(mcpResource(agentEnv({ ...base, MCP_ORIGIN: undefined }).env)).toBeNull();
    expect(mcpResource(agentEnv({ ...base, MCP_ORIGIN: '' }).env)).toBeNull();
    expect(mcpResource(agentEnv({ ...base, MCP_ORIGIN: 'http://example.com' }).env)).toBeNull();
  });

  it('falls back to a localhost resource when a local env has no MCP_ORIGIN', () => {
    const { env } = agentEnv({ MCP_ORIGIN: undefined });
    expect(mcpResource(env)).toBe('http://localhost:8797/mcp');
  });
});
