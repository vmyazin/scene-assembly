import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { serveMcp } from '../src/mcp/handler';
import { runTool } from '../src/mcp/server';
import { defineTool, type ToolContext } from '../src/mcp/tool';
import { agentEnv, connectProvider, OWNER, seedAgent } from './agent-fixtures';
import { connectAgent, structured } from './mcp-harness';

const enabled = { CLOUD_GENERATION_PROVIDERS: 'fal,atlas,gemini,runware' };
const post = (body: string) => new Request('http://mcp.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body });

describe('the MCP endpoint', () => {
  it('refuses a token whose agent is unknown or revoked', async () => {
    const { db, env } = agentEnv();
    expect((await serveMcp(post('{}'), env, { userId: OWNER, agentId: 'missing' })).status).toBe(401);
    const agent = await seedAgent(env);
    db.prepare('UPDATE account_agents SET revoked_at = 1').run();
    const refused = await serveMcp(post('{}'), env, { userId: OWNER, agentId: agent.id });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('WWW-Authenticate')).toContain('invalid_token');
  });

  it('refuses a body over 64 KB', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    expect((await serveMcp(post('x'.repeat(70_000)), env, { userId: OWNER, agentId: agent.id })).status).toBe(413);
  });

  it('lists its tools with descriptions and read-only hints', async () => {
    const { env } = agentEnv(enabled);
    const client = await connectAgent(env, await seedAgent(env));
    const { tools } = await client.listTools();
    for (const name of ['list_models', 'estimate_cost']) {
      const tool = tools.find(candidate => candidate.name === name)!;
      expect(tool.description!.length).toBeGreaterThan(40);
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });
});

describe('list_models', () => {
  it('offers only providers that are both enabled and connected, compactly', async () => {
    const { db, env } = agentEnv(enabled);
    connectProvider(db, 'fal');
    connectProvider(db, 'kie'); // connected, not enabled
    const client = await connectAgent(env, await seedAgent(env));
    const result = structured<{ models: Record<string, unknown>[]; connectedProviders: string[] }>(await client.callTool({ name: 'list_models', arguments: {} }));
    expect(result.connectedProviders).toEqual(['fal']);
    expect(result.models.every(model => model.provider === 'fal')).toBe(true);
    expect(result.models[0]).toHaveProperty('inputModes');
    expect(result.models[0]).not.toHaveProperty('modes');
  });

  it('describes one model\'s settings when asked for it', async () => {
    const { db, env } = agentEnv(enabled);
    connectProvider(db, 'fal');
    const client = await connectAgent(env, await seedAgent(env));
    const result = structured<{ models: { modes: { mode: string; fields: { key: string }[] }[] }[] }>(await client.callTool({ name: 'list_models', arguments: { provider: 'fal', modelId: 'veo-3-1' } }));
    expect(result.models).toHaveLength(1);
    expect(result.models[0].modes.find(mode => mode.mode === 'text')!.fields.map(field => field.key)).toContain('duration');
  });

  it('tells the agent what the person must do when nothing is connected', async () => {
    const { env } = agentEnv(enabled);
    const client = await connectAgent(env, await seedAgent(env));
    const result = await client.callTool({ name: 'list_models', arguments: {} });
    expect(JSON.stringify(result.content)).toMatch(/connect a provider key/i);
  });
});

describe('estimate_cost', () => {
  const flux = { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell', mediaType: 'image', inputMode: 'text', prompt: 'a red kite' };

  it('prices a request against the agent\'s limit', async () => {
    const { db, env } = agentEnv(enabled);
    connectProvider(db, 'atlas');
    const client = await connectAgent(env, await seedAgent(env));
    const result = await client.callTool({ name: 'estimate_cost', arguments: flux });
    expect(result.isError).toBeFalsy();
    expect(structured(result)).toMatchObject({ costUsd: expect.closeTo(0.003, 6), confidence: 'estimated', allowed: true, budget: { limitUsd: 5, usedUsd: 0 } });
  });

  it('writes in the defaults generate will use', async () => {
    const { db, env } = agentEnv(enabled);
    connectProvider(db, 'fal');
    const client = await connectAgent(env, await seedAgent(env));
    const result = structured<{ values: Record<string, unknown> }>(await client.callTool({ name: 'estimate_cost', arguments: { provider: 'fal', modelId: 'veo-3-1', mediaType: 'video', inputMode: 'text', prompt: 'waves' } }));
    expect(result.values).toHaveProperty('duration');
  });

  it('reports that a default grant cannot run an unpriced model', async () => {
    const { db, env } = agentEnv(enabled);
    connectProvider(db, 'runware');
    const client = await connectAgent(env, await seedAgent(env));
    const result = await client.callTool({ name: 'estimate_cost', arguments: { provider: 'runware', modelId: 'runware:z-image@turbo', mediaType: 'image', inputMode: 'text', prompt: 'x' } });
    expect(result.isError).toBeFalsy();
    expect(structured(result)).toMatchObject({ costUsd: null, confidence: 'unknown', allowed: false, refusal: 'cost_unknown' });
  });

  it('names the field that is wrong and what it accepts', async () => {
    const { db, env } = agentEnv(enabled);
    connectProvider(db, 'atlas');
    const client = await connectAgent(env, await seedAgent(env));
    const result = await client.callTool({ name: 'estimate_cost', arguments: { provider: 'atlas', modelId: 'bytedance/seedance-2.0-fast/text-to-video', mediaType: 'video', inputMode: 'text', prompt: 'x', values: { size: '9000p' } } });
    expect(result.isError).toBe(true);
    expect(structured(result)).toMatchObject({ code: 'invalid_field', field: 'size', allowed: expect.arrayContaining(['720p']) });
  });

  it('says when the provider is not connected', async () => {
    const { env } = agentEnv(enabled);
    const client = await connectAgent(env, await seedAgent(env));
    const result = await client.callTool({ name: 'estimate_cost', arguments: { provider: 'gemini', modelId: 'gemini-3-pro-image-preview', mediaType: 'image', inputMode: 'text', prompt: 'x' } });
    expect(structured(result)).toMatchObject({ code: 'connection_required', retryable: false });
  });
});

describe('runTool', () => {
  async function context(): Promise<ToolContext> {
    const { env } = agentEnv();
    return { env, agent: await seedAgent(env), now: () => 1_800_000_000_000, sleep: async () => {} };
  }

  it('limits how fast an agent can submit, and says when to retry', async () => {
    const ctx = await context();
    const submit = defineTool({ name: 't', title: 't', description: 't', kind: 'submit', annotations: {}, input: z.object({}), async run() { return { structured: {}, text: 'ok' }; } });
    for (let index = 0; index < 10; index++) expect((await runTool(ctx, submit, {})).isError).toBeFalsy();
    const limited = await runTool(ctx, submit, {});
    expect(limited.structuredContent).toMatchObject({ code: 'rate_limited', retryable: true, retryAfterSeconds: expect.any(Number) });
  });

  it('never repeats an unexpected error\'s text', async () => {
    const ctx = await context();
    const leaky = defineTool({ name: 'l', title: 'l', description: 'l', kind: 'read', annotations: {}, input: z.object({}), async run() { throw new Error('upstream said key=sk-live-123'); } });
    const result = await runTool(ctx, leaky, {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sk-live-123');
    expect(result.structuredContent).toMatchObject({ code: 'internal_error', retryable: true });
  });
});
