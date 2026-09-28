import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/index';
import { checkReferenceUrl, fetchReference, sniffMime } from '../src/mcp/fetch-reference';
import { resolveReferences } from '../src/mcp/tools/references';
import { reserveUpload } from '../src/uploads';
import { agentEnv, OWNER, seedAgent, seedAsset, seedUser } from './agent-fixtures';
import { connectAgent, structured } from './mcp-harness';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const file = (bytes: Uint8Array, headers: Record<string, string> = {}) => new Response(bytes, { status: 200, headers });
afterEach(() => vi.unstubAllGlobals());

describe('reference URLs', () => {
  const { env } = agentEnv();
  it.each([
    ['http://example.com/a.png', /https/],
    ['https://user:pw@example.com/a.png', /credentials/],
    ['https://localhost:3097/x.png', /this service/],
    ['https://127.0.0.1/x.png', /hostname/],
    ['https://[::1]/x.png', /hostname/],
    ['not a url', /valid URL/],
  ])('refuses %s', (value, message) => {
    expect(() => checkReferenceUrl(value, env)).toThrow(message);
  });
  it('refuses the Worker and MCP hosts as well as the app', () => {
    const production = { ...env, APP_ORIGIN: 'https://sceneassembly.mzork.com', PUBLIC_WORKER_ORIGIN: 'https://w.example.workers.dev', MCP_ORIGIN: 'https://mcp.sceneassembly.mzork.com' };
    for (const host of ['sceneassembly.mzork.com', 'w.example.workers.dev', 'mcp.sceneassembly.mzork.com']) {
      expect(() => checkReferenceUrl(`https://${host}/media/download/x`, production)).toThrow(/this service/);
    }
    expect(checkReferenceUrl('https://images.example.com/a.png', production).hostname).toBe('images.example.com');
  });
});

describe('fetching a reference', () => {
  it('decides the type from the bytes, not the header', async () => {
    const { env } = agentEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(file(new TextEncoder().encode('<html>'), { 'content-type': 'image/png' })));
    await expect(fetchReference(env, 'https://example.com/a.png')).rejects.toThrow(/not a PNG, JPEG/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(file(PNG, { 'content-type': 'text/plain' })));
    expect(await fetchReference(env, 'https://example.com/a')).toMatchObject({ mimeType: 'image/png' });
  });

  it('re-checks every redirect and stops after three', async () => {
    const { env } = agentEnv();
    const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect('https://localhost:3097/media/download/secret')));
    await expect(fetchReference(env, 'https://example.com/a.png')).rejects.toThrow(/this service/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect('https://example.com/again')));
    await expect(fetchReference(env, 'https://example.com/a.png')).rejects.toThrow(/redirected too many times/);
  });

  it('stops reading at the size cap', async () => {
    const { env } = agentEnv();
    const chunk = new Uint8Array(1_000_000);
    chunk.set(PNG);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { sent += 1; controller.enqueue(chunk); if (sent > 200) controller.close(); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    await expect(fetchReference(env, 'https://example.com/big.png')).rejects.toThrow(/up to 100 MB/);
    expect(sent).toBeLessThan(110);
  });

  it('knows the formats it accepts', () => {
    expect(sniffMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video/webm');
    expect(sniffMime(new TextEncoder().encode('\0\0\0\u0018ftypisom'))).toBe('video/mp4');
    expect(sniffMime(new TextEncoder().encode('\0\0\0\u0018ftypqt  '))).toBeNull();
    expect(sniffMime(new TextEncoder().encode('\0\0\0\u0018ftypavif'))).toBe('image/avif');
  });
});

describe('add_reference', () => {
  it('stages a URL as a ready input', async () => {
    const { db, env, objects } = agentEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(file(PNG)));
    const client = await connectAgent(env, await seedAgent(env));
    const result = structured<{ uploadId: string; mimeType: string }>(await client.callTool({ name: 'add_reference', arguments: { url: 'https://example.com/cat.png' } }));
    expect(result.mimeType).toBe('image/png');
    expect(db.prepare('SELECT state, mime_type FROM account_uploads WHERE id = ?').get(result.uploadId)).toEqual({ state: 'ready', mime_type: 'image/png' });
    expect(objects.get(`accounts/${OWNER}/inputs/${result.uploadId}`)?.contentType).toBe('image/png');
  });

  it('hands out a PUT link that works without an Origin, while browser links still need one', async () => {
    const { db, env } = agentEnv();
    const client = await connectAgent(env, await seedAgent(env));
    const result = structured<{ uploadId: string; putUrl: string }>(await client.callTool({ name: 'add_reference', arguments: { upload: { mimeType: 'image/png', bytes: PNG.length } } }));
    expect(result.putUrl).toMatch(/^http:\/\/localhost:8797\/media\/agent-upload\//);
    const put = await handleRequest(new Request(result.putUrl, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }), env);
    expect(put.status).toBe(200);
    expect(db.prepare('SELECT state FROM account_uploads WHERE id = ?').get(result.uploadId)).toEqual({ state: 'ready' });
    const browser = await reserveUpload(env, OWNER, PNG.length, 'image/png');
    expect((await handleRequest(new Request(browser.url!, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }), env)).status).toBe(403);
  });

  it('asks for exactly one of url or upload', async () => {
    const { env } = agentEnv();
    const client = await connectAgent(env, await seedAgent(env));
    expect(structured(await client.callTool({ name: 'add_reference', arguments: {} }))).toMatchObject({ code: 'invalid_field' });
  });
});

describe('library assets as references', () => {
  async function ctx() {
    const setup = agentEnv();
    return { ...setup, context: { env: setup.env, agent: await seedAgent(setup.env), now: () => Date.now(), sleep: async () => {} } };
  }

  it('copies this account\'s asset into a fresh input', async () => {
    const { db, objects, context } = await ctx();
    objects.set(seedAsset(db, { id: 'asset-1', jobId: null, bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    const { referenceIds } = await resolveReferences(context, [{ assetId: 'asset-1' }]);
    expect(referenceIds).toHaveLength(1);
    expect(objects.get(`accounts/${OWNER}/inputs/${referenceIds[0]}`)?.bytes).toEqual(PNG);
  });

  // Review focus 2.
  it('refuses another account\'s asset and an expired temporary one', async () => {
    const { db, objects, context } = await ctx();
    seedUser(db, 'other');
    objects.set(seedAsset(db, { id: 'theirs', jobId: null, userId: 'other', bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    objects.set(seedAsset(db, { id: 'expired', jobId: null, bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    db.prepare("INSERT INTO account_asset_retention (asset_id, expires_at) VALUES ('expired', 1)").run();
    for (const assetId of ['theirs', 'expired', 'missing']) {
      await expect(resolveReferences(context, [{ assetId }])).rejects.toMatchObject({ code: 'reference_unavailable' });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_uploads').get()).toEqual({ n: 0 });
  });

  it('passes staged upload ids through untouched', async () => {
    const { context } = await ctx();
    expect(await resolveReferences(context, [{ uploadId: 'u-1' }], { uploadId: 'u-2' })).toEqual({ referenceIds: ['u-1'], sourceVideoId: 'u-2' });
  });
});
