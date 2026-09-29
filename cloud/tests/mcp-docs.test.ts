import { readdirSync, readFileSync } from 'node:fs';
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

/** Every `.ts` file under cloud/src/mcp, relative to that folder. */
const mcpFiles = (readdirSync(new URL('../src/mcp/', import.meta.url), { recursive: true }) as string[])
  .filter(file => file.endsWith('.ts'))
  .map(file => file.replaceAll('\\', '/'));

/** `ToolError('<code>'` and `refusal('<code>'`: the codes the MCP layer writes itself. */
function toolCodes(text: string): string[] {
  return [...text.matchAll(/\b(?:ToolError|refusal)\(\s*'([a-z][a-z_]*)'/g)].map(match => match[1]);
}

/** `new AccountError(<message>, <status>, '<code>')`: the code is always the last
 *  argument, so it is the first `, '<code>')` after each constructor. */
function accountCodes(text: string): string[] {
  const codes: string[] = [];
  for (const start of text.matchAll(/new AccountError\(/g)) {
    const code = /,\s*'([a-z][a-z_]*)'\s*\)/.exec(text.slice(start.index));
    if (code) codes.push(code[1]);
  }
  return codes;
}

/** The source of one top-level function, up to the next top-level declaration. */
function functionSource(text: string, name: string): string {
  const start = new RegExp(`^(?:export )?(?:async )?function ${name}\\b`, 'm').exec(text);
  if (!start) throw new Error(`${name} not found`);
  const rest = text.slice(start.index + start[0].length);
  const end = /^(?:export |(?:async )?function |const |\/\*\*)/m.exec(rest);
  return rest.slice(0, end ? end.index : undefined);
}

/**
 * The Worker functions a tool calls whose `AccountError`s reach the agent
 * unchanged through `toRefusal`. Scanned function by function rather than file
 * by file, because the same files also hold the Workflow's own failures
 * (`result_size`, `staged_missing`, …), which land on a job's failureReason and
 * are never a tool's refusal. A tool that starts calling another function needs
 * that function added here.
 */
const PASSED_THROUGH: Record<string, string[]> = {
  '../src/jobs.ts': ['acceptJob', 'cancelQueuedJob', 'dismissAttentionJob'],
  '../src/job-routes.ts': ['resumeJob', 'listJobs', 'listAssets'],
  '../src/providers.ts': ['adapterFor', 'validateRequest'],
  '../src/provider-adapters/queued.ts': ['validateQueuedRequest'],
  '../src/provider-adapters/aggregators.ts': ['validateAggregatorRequest'],
  '../src/provider-adapters/synchronous.ts': ['validateSynchronousRequest'],
  '../src/uploads.ts': ['reserveUpload', 'storeUpload', 'storeStreamedUpload', 'copyAssetToUpload'],
  '../src/spend.ts': ['listSpend'],
};

/** MCP files that answer the person's browser (consent, the Connected agents
 *  panel), not a tool call: their AccountErrors never reach an agent. */
const ACCOUNT_SIDE = new Set(['agents.ts', 'agent-routes.ts', 'auth.ts']);

function refusalCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of mcpFiles) {
    const text = source(`../src/mcp/${file}`);
    for (const code of toolCodes(text)) codes.add(code);
    if (!ACCOUNT_SIDE.has(file)) for (const code of accountCodes(text)) codes.add(code);
  }
  for (const [file, names] of Object.entries(PASSED_THROUGH)) {
    const text = source(file);
    for (const name of names) for (const code of accountCodes(functionSource(text, name))) codes.add(code);
  }
  return codes;
}

describe('the MCP setup guide', () => {
  it('names every tool the server offers', () => {
    const missing = TOOLS.map(tool => tool.name).filter(name => !guide.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it('documents every refusal code a tool can return', () => {
    const codes = refusalCodes();
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
