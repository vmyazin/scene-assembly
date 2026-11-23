// cloud/tests/ideogram-4-6.test.ts
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { LOCAL_SCHEMA } from '../src/schema';
import { saveConnection } from '../src/vault';
import { acceptJob } from '../src/jobs';
import { adapterFor, validateRequest } from '../src/providers';
import type { Env } from '../src/security';
import type { CloudJobRequest } from '../../lib/account/contracts';
import { ATLAS_SEEDANCE_25_FLASH_MODELS, ATLAS_SEEDANCE_25_FLASH_PROMOTION, HEYGEN_VIDEO_MODEL, HEYGEN_VIDEO_PROMOTION } from '../../lib/providers/model-promotions';
import { agentEnv, connectProvider, seedAgent } from './agent-fixtures';
import { connectAgent, structured } from './mcp-harness';

const IDEOGRAM = 'ideogram:4.6@0';
const PRECISE = 'ideogram:4.6@precise-edit';

let db: DatabaseSync, env: Env;
const text: CloudJobRequest = { provider: 'runware', modelId: IDEOGRAM, mediaType: 'image', inputMode: 'text', prompt: 'A poster that says OPEN LATE', values: { aspectRatio: '16:9', resolution: '4K', quality: 'low' }, referenceIds: [] };
const edit: CloudJobRequest = { provider: 'runware', modelId: PRECISE, mediaType: 'image', inputMode: 'image', prompt: 'Make the jacket cobalt blue', values: { quality: 'high' }, referenceIds: ['source'] };

beforeEach(async () => {
  db = new DatabaseSync(':memory:'); db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)");
  env = { DB: adapter(db), APP_ORIGIN: 'http://localhost:3097', CLOUD_GENERATION_PROVIDERS: 'runware,atlas', ACCOUNT_ENCRYPTION_VERSION: '1', ACCOUNT_ENCRYPTION_KEYS: JSON.stringify({ '1': btoa('x'.repeat(32)) }) };
  await saveConnection(env, 'owner', 'runware', { apiKey: 'local-test-secret' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close(); });

describe('Ideogram 4.6 background jobs', () => {
  it('accepts the published tiers and qualities, in both modes', () => {
    expect(validateRequest(env, text)).toEqual(text);
    for (const quality of ['very_low', 'low', 'medium', 'high']) {
      expect(() => validateRequest(env, { ...text, values: { aspectRatio: '1:1', resolution: '2K', quality } })).not.toThrow();
    }
    for (const quality of ['low', 'medium', 'high']) {
      expect(() => validateRequest(env, { ...text, values: { resolution: '4K', quality } })).not.toThrow();
    }
    expect(() => validateRequest(env, { ...text, values: {} })).not.toThrow();
    expect(() => validateRequest(env, { ...text, inputMode: 'image', referenceIds: ['a', 'b', 'c', 'd', 'e'] })).not.toThrow();
  });

  it('names what was wrong with a tier, a quality or a count it does not publish', () => {
    expect(() => validateRequest(env, { ...text, values: { resolution: '1K' } })).toThrow(/"1K" is not a resolution Ideogram 4\.6 publishes/);
    expect(() => validateRequest(env, { ...text, values: { quality: 'max' } })).toThrow(/"max" is not a quality Ideogram 4\.6 publishes/);
    // Very low renders at most 4.19 MP.
    expect(() => validateRequest(env, { ...text, values: { resolution: '4K', quality: 'very_low' } })).toThrow(/very low quality at 2K only/);
    expect(() => validateRequest(env, { ...text, values: { magicPrompt: 'on' } })).toThrow(/"magicPrompt" is not a setting this provider accepts/);
    expect(() => validateRequest(env, { ...text, values: { background: 'transparent' } })).toThrow(/background/);
    expect(() => validateRequest(env, { ...text, inputMode: 'image', referenceIds: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow(/up to 5 input images/);
    expect(() => validateRequest(env, { ...text, prompt: 'x'.repeat(10_001) })).toThrow(/up to 10,000 characters/);
  });

  it('holds Precise Edit to an image, a quality and nothing else', () => {
    expect(validateRequest(env, edit)).toEqual(edit);
    expect(() => validateRequest(env, { ...edit, referenceIds: ['source', 'a', 'b', 'c', 'd'] })).not.toThrow();
    expect(() => validateRequest(env, { ...edit, values: { quality: 'very_low' } })).not.toThrow();
    expect(() => validateRequest(env, { ...edit, inputMode: 'text', referenceIds: [] })).toThrow(/does not offer text input/);
    expect(() => validateRequest(env, { ...edit, referenceIds: [] })).toThrow(/needs at least one image/);
    expect(() => validateRequest(env, { ...edit, values: { aspectRatio: '16:9' } })).toThrow(/not an aspect ratio Ideogram 4\.6 Precise Edit publishes/);
    expect(() => validateRequest(env, { ...edit, values: { resolution: '4K' } })).toThrow(/not a resolution Ideogram 4\.6 Precise Edit publishes/);
    expect(() => validateRequest(env, { ...edit, referenceIds: ['source', 'a', 'b', 'c', 'd', 'e'] })).toThrow(/up to 5 input images/);
  });

  it('keeps the older Runware image models at four references and no tier or quality', () => {
    const flux: CloudJobRequest = { provider: 'runware', modelId: 'runware:400@1', mediaType: 'image', inputMode: 'image', prompt: 'Compose', values: {}, referenceIds: ['a', 'b', 'c', 'd'] };
    expect(() => validateRequest(env, flux)).not.toThrow();
    expect(() => validateRequest(env, { ...flux, referenceIds: ['a', 'b', 'c', 'd', 'e'] })).toThrow(/up to 4 input images/);
    expect(() => validateRequest(env, { ...flux, values: { quality: 'low' } })).toThrow(/"low" is not a quality/);
    expect(() => validateRequest(env, { ...flux, values: { resolution: '2K' } })).toThrow(/"2K" is not a resolution/);
  });

  it('submits generation with the tier’s pixels and settings.quality', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const job = await acceptJob(env, 'owner', 'ideogram-4-6-cloud-token', text);
    const { handle } = await adapterFor(env, 'runware').submit(env, job);
    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(task).toMatchObject({ taskType: 'imageInference', taskUUID: handle!.id, model: IDEOGRAM, width: 4096, height: 2304, settings: { quality: 'low' }, deliveryMethod: 'async', includeCost: true });
    expect(task.inputs).toBeUndefined();
    expect(JSON.stringify(task)).not.toMatch(/magicPrompt/);
  });

  it('submits the defaults when an agent names neither tier nor quality', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const job = await acceptJob(env, 'owner', 'ideogram-default-token', { ...text, values: {} });
    await adapterFor(env, 'runware').submit(env, job);
    const [task] = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(task).toMatchObject({ width: 2048, height: 2048, settings: { quality: 'medium' } });
  });
});

describe('Ideogram 4.6 over MCP', () => {
  const enabled = { CLOUD_GENERATION_PROVIDERS: 'fal,atlas,gemini,runware' };
  type Listed = { models: { modelId: string; label: string; price?: string; inputModes?: string[]; modes?: { mode: string; fields: { key: string; default?: unknown; options?: { value: unknown }[] }[]; references?: { min: number; max: number } }[] }[] };

  it('lists both models and describes their settings', async () => {
    const agent = agentEnv(enabled);
    connectProvider(agent.db, 'runware');
    const client = await connectAgent(agent.env, await seedAgent(agent.env));
    // With no filter the list is compact: ids, labels and input modes.
    const all = structured<Listed>(await client.callTool({ name: 'list_models', arguments: {} }));
    expect(all.models.find(model => model.modelId === IDEOGRAM)).toMatchObject({ label: 'Ideogram 4.6', inputModes: ['text', 'image'] });
    expect(all.models.find(model => model.modelId === PRECISE)).toMatchObject({ label: 'Ideogram 4.6 Precise Edit', inputModes: ['image'] });

    const one = structured<Listed>(await client.callTool({ name: 'list_models', arguments: { provider: 'runware', modelId: IDEOGRAM } }));
    const textMode = one.models[0].modes!.find(mode => mode.mode === 'text')!;
    expect(textMode.fields.map(field => field.key)).toEqual(['aspectRatio', 'resolution', 'quality']);
    expect(textMode.fields.find(field => field.key === 'quality')).toMatchObject({ default: 'medium' });
    expect(textMode.fields.find(field => field.key === 'quality')!.options!.map(option => option.value)).toEqual(['very_low', 'low', 'medium', 'high']);

    const precise = structured<Listed>(await client.callTool({ name: 'list_models', arguments: { provider: 'runware', modelId: PRECISE } }));
    expect(precise.models[0].modes!.map(mode => mode.mode)).toEqual(['image']);
    expect(precise.models[0].modes![0].fields.map(field => field.key)).toEqual(['quality']);
    expect(precise.models[0].modes![0].references).toEqual({ min: 1, max: 5 });
  });

  it('leaves the estimate unknown, like every Runware job: the charge is reported after the run', async () => {
    const agent = agentEnv(enabled);
    connectProvider(agent.db, 'runware');
    const client = await connectAgent(agent.env, await seedAgent(agent.env));
    const result = await client.callTool({ name: 'estimate_cost', arguments: { provider: 'runware', modelId: IDEOGRAM, mediaType: 'image', inputMode: 'text', prompt: 'A sign', values: { quality: 'low' } } });
    expect(result.isError).toBeFalsy();
    expect(structured(result)).toMatchObject({ costUsd: null, confidence: 'unknown', refusal: 'cost_unknown' });
    expect(structured<{ values: Record<string, unknown> }>(result).values).toMatchObject({ quality: 'low', resolution: '2K' });
  });
});

describe('the dated sales, as a long-lived Worker sees them', () => {
  const enabled = { CLOUD_GENERATION_PROVIDERS: 'atlas,runware' };
  type Listed = { models: { modelId: string; price?: string; note?: string }[] };
  const flash = { provider: 'atlas', modelId: ATLAS_SEEDANCE_25_FLASH_MODELS[0], mediaType: 'video', inputMode: 'text', prompt: 'A lighthouse', values: { size: '720p', durationSeconds: 8 } };

  it('lists and estimates Atlas Seedance 2.5 Flash on sale until its end, then at list, in one process', async () => {
    const end = ATLAS_SEEDANCE_25_FLASH_PROMOTION.endsAt;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(end - 1);
    const agent = agentEnv(enabled);
    connectProvider(agent.db, 'atlas');
    const client = await connectAgent(agent.env, await seedAgent(agent.env));
    const price = async () => structured<Listed>(await client.callTool({ name: 'list_models', arguments: { provider: 'atlas', modelId: flash.modelId } })).models[0].price;
    const cost = async () => structured<{ costUsd: number }>(await client.callTool({ name: 'estimate_cost', arguments: flash })).costUsd;

    expect(await price()).toBe('$0.0734 / s @ 480p · $0.1589 @ 720p');
    expect(await cost()).toBeCloseTo(0.1589 * 8, 8);
    clock.mockReturnValue(end);
    expect(await price()).toMatch(/^\$0\.113 .*\$0\.2445/);
    expect(await cost()).toBeCloseTo(0.2445 * 8, 8);
  });

  it('lists HeyGen Video 1.0 on sale until 2026-11-30 23:00 UTC, then at list, in one process', async () => {
    const end = HEYGEN_VIDEO_PROMOTION.endsAt;
    expect(new Date(end).toISOString()).toBe('2026-11-30T23:00:00.000Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(end - 1);
    const agent = agentEnv(enabled);
    connectProvider(agent.db, 'runware');
    const client = await connectAgent(agent.env, await seedAgent(agent.env));
    const listed = async () => structured<Listed>(await client.callTool({ name: 'list_models', arguments: { provider: 'runware', modelId: HEYGEN_VIDEO_MODEL } })).models[0];

    expect((await listed()).price).toBe('$0.01 / s @ 480p · $0.018 @ 768p · $0.05 @ 1080p and 2K');
    expect((await listed()).note).toMatch(/50% off through Nov 30/);
    clock.mockReturnValue(end);
    expect((await listed()).price).toBe('$0.02 / s @ 480p · $0.036 @ 768p · $0.10 @ 1080p and 2K');
    expect((await listed()).note ?? '').not.toMatch(/50% off/);
  });
});
