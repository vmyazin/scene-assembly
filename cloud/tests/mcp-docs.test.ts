import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { brand } from '../../lib/brand';
import { withResourceDocumentation } from '../src/mcp/docs';
import { serverInstructions } from '../src/mcp/server';
import { TOOLS } from '../src/mcp/tools';
import { agentEnv, seedAgent } from './agent-fixtures';
import { connectAgent } from './mcp-harness';

/**
 * The public setup guide (app/docs/mcp/guide.md) is written by hand, so these
 * tests are what keep it honest: a tool or a refusal code added to the server
 * without a line in the guide fails here rather than surprising an agent that
 * read the guide and was told the list was complete.
 */
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const guide = source('../../app/docs/mcp/guide.md');

// Parsed the way deploy-config.test.ts parses it: whole-line comments stripped.
const productionVars = JSON.parse(source('../wrangler.jsonc').replace(/^\s*\/\/.*$/gm, '')).vars as Record<string, string>;

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Every `.ts` file under cloud/src/mcp, as an absolute path. */
const mcpFiles = (readdirSync(join(SRC, 'mcp'), { recursive: true }) as string[])
  .filter(file => file.endsWith('.ts'))
  .map(file => join(SRC, 'mcp', file));

/** MCP files that answer the person's browser (consent, the Connected agents
 *  panel), not a tool call. They are not scanned whole; a function in them that
 *  a tool path imports (handler.ts uses activeAgent, mcpOrigin) still is. */
const ACCOUNT_SIDE = new Set(['agents.ts', 'agent-routes.ts', 'auth.ts'].map(file => join(SRC, 'mcp', file)));

interface Found { codes: Set<string>; dynamic: string[]; reached: Set<string> }

/**
 * The codes one piece of source creates:
 * - `new ToolError('<code>'` and `refusal('<code>'`, the MCP layer's own;
 * - `new AccountError(<message>, <status>, '<code>')`, whose code is the last
 *   argument on the same line.
 * A constructor whose code is not a string literal is recorded in `dynamic`, so
 * the test fails rather than miss a code it cannot read. The one allowed is
 * `toRefusal` passing an error's own code through.
 */
function scan(text: string, where: string, found: Found) {
  for (const match of text.matchAll(/(?<!function )\b(?:new ToolError|refusal)\(\s*([^)\s][^,)]*)/g)) {
    const literal = /^'([a-z][a-z_]*)'$/.exec(match[1].trim());
    if (literal) found.codes.add(literal[1]);
    else if (match[1].trim() !== 'error.code') found.dynamic.push(`${where}: ${match[0]}`);
  }
  for (const match of text.matchAll(/new AccountError\(/g)) {
    const line = text.slice(match.index, text.indexOf('\n', match.index) === -1 ? undefined : text.indexOf('\n', match.index));
    const literal = /,\s*'([a-z][a-z_]*)'\s*\)/.exec(line);
    if (literal) found.codes.add(literal[1]);
    else found.dynamic.push(`${where}: ${line.slice(0, 80)}`);
  }
}

const TOP_LEVEL = /^(?:export |(?:async )?function |const |let |class |interface |type |\/\*\*|\/\/)/m;

/** One module's top-level functions and consts, by name, with their source. */
function declarations(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of text.matchAll(/^(?:export )?(?:(?:async )?function\*? |const )([A-Za-z_$][\w$]*)/gm)) {
    const rest = text.slice(match.index + match[0].length);
    const end = TOP_LEVEL.exec(rest);
    map.set(match[1], rest.slice(0, end ? end.index : undefined));
  }
  return map;
}

/** Named value imports (not `import type`, not `type X`) that resolve to a module under cloud/src. */
function imports(file: string, text: string): Map<string, { module: string; name: string }> {
  const map = new Map<string, { module: string; name: string }>();
  for (const match of text.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(\.[^']*)'/gm)) {
    if (match[1]) continue;
    const base = resolve(dirname(file), match[3]);
    const target = [`${base}.ts`, join(base, 'index.ts')].find(candidate => existsSync(candidate));
    if (!target || !target.startsWith(SRC)) continue;
    for (const spec of match[2].split(',').map(part => part.trim()).filter(Boolean)) {
      if (spec.startsWith('type ')) continue;
      const [name, local = name] = spec.split(/\s+as\s+/);
      map.set(local, { module: target, name });
    }
  }
  return map;
}

/**
 * Every refusal code an agent can receive. Starts from the whole of every MCP
 * file (the tools, the server, the error helpers), then follows each value it
 * imports from the Worker, and from there every function those call, in their
 * own module or through their own imports. An `AccountError` anywhere on those
 * paths reaches the agent unchanged through `toRefusal`, so a code added to any
 * function a tool can reach (deleteAsset, writeOutput, …) is collected with no
 * list to update. It errs toward collecting: an object such as a provider
 * adapter is scanned whole once anything reaches it (resumeJob does, through
 * `recover`), so a few codes that come mostly from the Workflow are listed too.
 * What it leaves out is what nothing on these paths names: the rest of the
 * Workflow, and routes only the browser calls.
 */
function refusalCodes(): Found {
  const found: Found = { codes: new Set(), dynamic: [], reached: new Set() };
  const texts = new Map<string, string>();
  const read = (file: string) => texts.get(file) ?? texts.set(file, readFileSync(file, 'utf8')).get(file)!;
  const visited = new Set<string>();
  const queue: { module: string; body: string; where: string }[] = [];
  const follow = (module: string, body: string) => {
    const text = read(module);
    const local = declarations(text);
    const imported = imports(module, text);
    for (const identifier of new Set(body.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
      const target = local.has(identifier) ? { module, name: identifier } : imported.get(identifier);
      if (!target) continue;
      const key = `${target.module}#${target.name}`;
      if (visited.has(key)) continue;
      visited.add(key);
      found.reached.add(key.slice(SRC.length));
      const source = declarations(read(target.module)).get(target.name);
      if (source !== undefined) queue.push({ module: target.module, body: source, where: key.slice(SRC.length) });
    }
  };
  for (const file of mcpFiles) {
    if (ACCOUNT_SIDE.has(file)) continue;
    scan(read(file), file.slice(SRC.length), found);
    follow(file, read(file));
  }
  while (queue.length) {
    const next = queue.shift()!;
    scan(next.body, next.where, found);
    follow(next.module, next.body);
  }
  return found;
}

describe('the MCP setup guide', () => {
  it('names every tool the server offers', () => {
    const missing = TOOLS.map(tool => tool.name).filter(name => !guide.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it('documents every refusal code a tool can return', () => {
    const { codes, dynamic, reached } = refusalCodes();
    expect(dynamic).toEqual([]);
    // Functions a tool reaches only through another function, or that no hand
    // list used to name: a new code in any of them must be collected too.
    for (const path of ['assets.ts#deleteAsset', 'assets.ts#writeOutput', 'job-routes.ts#resumeJob', 'provider-adapters/queued.ts#validateQueuedRequest', 'provider-billing.ts#readAccountBilling', 'media.ts#mediaAccess']) {
      expect(reached).toContain(path);
    }
    // A scanner that silently found nothing would pass the check below.
    for (const known of ['budget_exceeded', 'cost_unknown', 'rate_limited', 'invalid_field', 'internal_error', 'request_in_progress', 'connection_required', 'active_jobs', 'input_capacity', 'reference_fetch_failed', 'resume_exhausted', 'invalid_settings']) {
      expect(codes).toContain(known);
    }
    const missing = [...codes].filter(code => !guide.includes(`\`${code}\``)).sort();
    expect(missing).toEqual([]);
  });

  it('gives the production MCP URL that the Worker serves', () => {
    expect(brand.mcpUrl).toBe(`${productionVars.MCP_ORIGIN}/mcp`);
  });
});

describe('pointers to the guide', () => {
  const libraryMetadata = () => new Response(JSON.stringify({ resource: 'https://mcp-sceneassembly.mzork.com/mcp', resource_name: 'Scene Assembly' }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
  const metadataRequest = (method = 'GET') => new Request('https://mcp-sceneassembly.mzork.com/.well-known/oauth-protected-resource/mcp', { method });
  const production = () => agentEnv({ APP_ORIGIN: 'https://sceneassembly.mzork.com', MCP_ORIGIN: 'https://mcp-sceneassembly.mzork.com' }).env;

  it('adds resource_documentation to the protected-resource metadata, keeping status and headers', async () => {
    const response = await withResourceDocumentation(metadataRequest(), libraryMetadata(), production());
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json()).toEqual({
      resource: 'https://mcp-sceneassembly.mzork.com/mcp',
      resource_name: 'Scene Assembly',
      resource_documentation: 'https://sceneassembly.mzork.com/docs/mcp',
    });
  });

  it('leaves every other response alone', async () => {
    const env = production();
    const other = libraryMetadata();
    expect(await withResourceDocumentation(new Request('https://mcp-sceneassembly.mzork.com/.well-known/oauth-authorization-server'), other, env)).toBe(other);
    const head = libraryMetadata();
    expect(await withResourceDocumentation(metadataRequest('HEAD'), head, env)).toBe(head);
    const missing = new Response(null, { status: 404 });
    expect(await withResourceDocumentation(metadataRequest(), missing, env)).toBe(missing);
    const unset = libraryMetadata();
    expect(await withResourceDocumentation(metadataRequest(), unset, { ...env, APP_ORIGIN: '' })).toBe(unset);
    const lookalike = libraryMetadata();
    expect(await withResourceDocumentation(new Request('https://mcp-sceneassembly.mzork.com/.well-known/oauth-protected-resource-other'), lookalike, env)).toBe(lookalike);
    const text = new Response('{}', { headers: { 'Content-Type': 'text/plain' } });
    expect(await withResourceDocumentation(metadataRequest(), text, env)).toBe(text);
    const array = new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    expect(await withResourceDocumentation(metadataRequest(), array, env)).toBe(array);
    const broken = new Response('{', { headers: { 'Content-Type': 'application/json' } });
    expect(await withResourceDocumentation(metadataRequest(), broken, env)).toBe(broken);
  });

  it('names the Markdown guide in the server instructions when APP_ORIGIN is set', async () => {
    expect(serverInstructions(production())).toContain('Setup, every tool and every refusal code: https://sceneassembly.mzork.com/docs/mcp.md');
    expect(serverInstructions({ ...production(), APP_ORIGIN: '' })).not.toContain('/docs/mcp.md');

    // And the server an agent connects to actually sends them.
    const { env } = agentEnv();
    const client = await connectAgent(env, await seedAgent(env));
    expect(client.getInstructions()).toContain('Setup, every tool and every refusal code: http://localhost:3097/docs/mcp.md');
  });
});
