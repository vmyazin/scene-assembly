import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/mcp/tools';
import { reserveCharge } from '../src/mcp/budget';
import { agentEnv, seedAgent, seedAsset } from './agent-fixtures';
import { connectAgent, structured } from './mcp-harness';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const images = (transform: () => Promise<Uint8Array>) => ({
  input: () => ({ transform() { return this; }, output: async () => { const bytes = await transform(); return { response: () => new Response(bytes), contentType: () => 'image/webp' }; } }),
}) as never;

describe('library tools', () => {
  it('lists assets with the agent that made them', async () => {
    const { db, env } = agentEnv();
    seedAsset(db, { id: 'a1', jobId: null });
    const result = structured<{ assets: { id: string }[]; counts: { all: number } }>(await (await connectAgent(env, await seedAgent(env))).callTool({ name: 'list_assets', arguments: {} }));
    expect(result.assets.map(asset => asset.id)).toEqual(['a1']);
    expect(result.counts.all).toBe(1);
  });

  it('shows an image inline as a small WebP, with its download link', async () => {
    const { db, env, objects } = agentEnv({ IMAGES: images(async () => Uint8Array.from([1, 2, 3])) });
    objects.set(seedAsset(db, { id: 'img', jobId: null }), { bytes: PNG, contentType: 'image/png' });
    const result = await (await connectAgent(env, await seedAgent(env))).callTool({ name: 'view_asset', arguments: { assetId: 'img' } });
    expect(result.content).toEqual(expect.arrayContaining([
      { type: 'image', data: 'AQID', mimeType: 'image/webp' },
      expect.objectContaining({ type: 'resource_link', name: 'img' }),
    ]));
  });

  // Review focus 5.
  it('falls back to the download link when the preview cannot be made', async () => {
    const { db, env, objects } = agentEnv({ IMAGES: images(async () => { throw new Error('9412: not an image'); }) });
    objects.set(seedAsset(db, { id: 'odd', jobId: null }), { bytes: PNG, contentType: 'image/png' });
    const result = await (await connectAgent(env, await seedAgent(env))).callTool({ name: 'view_asset', arguments: { assetId: 'odd' } });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'resource_link' })]));
    expect((result.content as { type: string }[]).some(block => block.type === 'image')).toBe(false);
  });

  it('only offers delete to an agent allowed to delete', async () => {
    const { db, env } = agentEnv();
    seedAsset(db, { id: 'doomed', jobId: null });
    const cautious = await connectAgent(env, await seedAgent(env));
    expect((await cautious.listTools()).tools.map(tool => tool.name)).not.toContain('delete_asset');
    const trusted = await connectAgent(env, await seedAgent(env, { allowDelete: true }, undefined, 'Trusted'));
    expect((await trusted.callTool({ name: 'delete_asset', arguments: { assetId: 'doomed' } })).isError).toBeFalsy();
    expect(db.prepare("SELECT deleted FROM account_assets WHERE id = 'doomed'").get()).toEqual({ deleted: 1 });
  });

  it('reports account spend and this agent\'s budget', async () => {
    const { env } = agentEnv();
    const agent = await seedAgent(env);
    await reserveCharge(env, agent, 'spent', { costUsd: 1.5, confidence: 'estimated' });
    const result = structured(await (await connectAgent(env, agent)).callTool({ name: 'get_spend', arguments: { entries: 5 } }));
    expect(result).toMatchObject({ budget: { limitUsd: 5, usedUsd: 1.5, remainingUsd: 3.5 }, totals: { runs: 0 }, entries: [] });
  });
});

describe('the whole tool list', () => {
  it('describes every tool and marks what it can do', () => {
    const names = TOOLS.map(tool => tool.name);
    expect(names).toEqual(['list_models', 'estimate_cost', 'add_reference', 'generate', 'get_job', 'list_jobs', 'cancel_job', 'resume_job', 'dismiss_job', 'list_assets', 'view_asset', 'delete_asset', 'get_spend']);
    for (const tool of TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(60);
      expect(tool.annotations.readOnlyHint, tool.name).toBe(tool.kind === 'read');
    }
    for (const name of ['delete_asset', 'cancel_job', 'dismiss_job']) expect(TOOLS.find(tool => tool.name === name)!.annotations.destructiveHint, name).toBe(true);
    for (const name of ['generate', 'resume_job', 'add_reference']) expect(TOOLS.find(tool => tool.name === name)!.annotations.openWorldHint, name).toBe(true);
    expect(TOOLS.find(tool => tool.name === 'generate')!.kind).toBe('submit');
  });
});
