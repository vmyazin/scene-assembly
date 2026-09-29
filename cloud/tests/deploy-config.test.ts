import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Parsed the way providers-config.test.ts parses it: whole-line comments stripped.
const config = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));

describe('agent MCP deployment configuration', () => {
  it('points production at a real OAuth namespace, the Images binding and an https MCP origin', () => {
    const production = config('wrangler.jsonc');
    expect(production.kv_namespaces).toEqual([{ binding: 'OAUTH_KV', id: expect.stringMatching(/^[0-9a-f]{32}$/) }]);
    expect(production.images).toEqual({ binding: 'IMAGES' });
    expect(production.vars.MCP_ORIGIN).toMatch(/^https:\/\/[^/]+$/);
  });

  it('serves a custom MCP domain without switching off workers.dev, which media links and the app gateway use', () => {
    const production = config('wrangler.jsonc');
    const host = new URL(production.vars.MCP_ORIGIN).hostname;
    if (host.endsWith('.workers.dev')) return;
    expect(production.routes).toEqual(expect.arrayContaining([{ pattern: host, custom_domain: true }]));
    expect(production.workers_dev).toBe(true);
  });

  it('gives the preview Worker its own namespace', () => {
    const preview = config('wrangler.preview.jsonc');
    expect(preview.kv_namespaces[0].id).toMatch(/^[0-9a-f]{32}$/);
    expect(preview.kv_namespaces[0].id).not.toBe(config('wrangler.jsonc').kv_namespaces[0].id);
  });
});
