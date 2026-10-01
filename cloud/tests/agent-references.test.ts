import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/index';
import { REFERENCE_USER_AGENT, checkReferenceUrl, fetchReference, sniffMime } from '../src/mcp/fetch-reference';
import { resolveReferences } from '../src/mcp/tools/references';
import { INPUT_TTL, reserveUpload } from '../src/uploads';
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
    ['https://localhost.:3097/x.png', /this service/], // trailing dot: same host to DNS, same Worker
    ['https://127.0.0.1/x.png', /hostname/],
    ['https://[::1]/x.png', /hostname/],
    ['not a url', /valid URL/],
  ])('refuses %s', (value, message) => {
    expect(() => checkReferenceUrl(value, env)).toThrow(message);
  });
  it('refuses the Worker and MCP hosts as well as the app', () => {
    const production = { ...env, APP_ORIGIN: 'https://sceneassembly.mzork.com', PUBLIC_WORKER_ORIGIN: 'https://w.example.workers.dev', MCP_ORIGIN: 'https://mcp-sceneassembly.smoxu.com' };
    for (const host of ['sceneassembly.mzork.com', 'w.example.workers.dev', 'mcp-sceneassembly.smoxu.com']) {
      expect(() => checkReferenceUrl(`https://${host}/media/download/x`, production)).toThrow(/this service/);
    }
    expect(checkReferenceUrl('https://images.example.com/a.png', production).hostname).toBe('images.example.com');
  });
  it('refuses a trailing-dot production host the same way', () => {
    const production = { ...env, APP_ORIGIN: 'https://sceneassembly.mzork.com', PUBLIC_WORKER_ORIGIN: 'https://w.example.workers.dev', MCP_ORIGIN: 'https://mcp-sceneassembly.smoxu.com' };
    expect(() => checkReferenceUrl('https://sceneassembly.mzork.com./x', production)).toThrow(/this service/);
  });
  it('refuses a sibling workers.dev preview or version host under the same account', () => {
    // A build/version URL (<build>-<worker>.<account>.workers.dev) runs the same Worker
    // as PUBLIC_WORKER_ORIGIN under that account's own subdomain.
    const production = { ...env, PUBLIC_WORKER_ORIGIN: 'https://abc123-scene-assembly-accounts.vasily-or-simon-account.workers.dev' };
    expect(() => checkReferenceUrl('https://other-build.vasily-or-simon-account.workers.dev/x.png', production)).toThrow(/this service/);
    expect(() => checkReferenceUrl('https://vasily-or-simon-account.workers.dev/x.png', production)).toThrow(/this service/);
    // A domain that merely contains the suffix as a substring is a different host and stays allowed.
    expect(checkReferenceUrl('https://vasily-or-simon-account.workers.dev.evil.example/x.png', production).hostname).toBe('vasily-or-simon-account.workers.dev.evil.example');
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

  it('sends no cookies or credentials, and identifies itself', async () => {
    const { env } = agentEnv();
    const fetchMock = vi.fn().mockResolvedValue(file(PNG));
    vi.stubGlobal('fetch', fetchMock);
    await fetchReference(env, 'https://example.com/cat.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(init).toMatchObject({ redirect: 'manual' });
    expect(init.headers).toEqual({ Accept: 'image/*, video/*', 'User-Agent': REFERENCE_USER_AGENT });
  });

  it('re-checks every redirect and stops after three', async () => {
    const { env } = agentEnv();
    const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirect('https://localhost:3097/media/download/secret')));
    await expect(fetchReference(env, 'https://example.com/a.png')).rejects.toThrow(/this service/);
    const alwaysRedirects = vi.fn().mockResolvedValue(redirect('https://example.com/again'));
    vi.stubGlobal('fetch', alwaysRedirects);
    await expect(fetchReference(env, 'https://example.com/a.png')).rejects.toThrow(/redirected too many times/);
    expect(alwaysRedirects).toHaveBeenCalledTimes(4); // the original request plus 3 redirects
  });

  it('follows exactly three redirects to a success', async () => {
    const { env } = agentEnv();
    const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirect('https://example.com/hop-1'))
      .mockResolvedValueOnce(redirect('https://example.com/hop-2'))
      .mockResolvedValueOnce(redirect('https://example.com/hop-3'))
      .mockResolvedValueOnce(file(PNG));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchReference(env, 'https://example.com/start.png');
    expect(result.mimeType).toBe('image/png');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('refuses a redirect that downgrades to plain http', async () => {
    const { env } = agentEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://example.com/a.png' } })));
    await expect(fetchReference(env, 'https://example.com/a.png')).rejects.toThrow(/https/);
  });

  it('refuses a redirect with no Location', async () => {
    const { env } = agentEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 302 })));
    await expect(fetchReference(env, 'https://example.com/a.png')).rejects.toThrow(/redirected without saying where/);
  });

  it('resolves a relative Location against the current URL', async () => {
    const { env } = agentEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next.png' } }))
      .mockResolvedValueOnce(file(PNG));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchReference(env, 'https://example.com/dir/a.png');
    expect(result.mimeType).toBe('image/png');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://example.com/next.png');
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

  it('streams a large file through rather than buffering it, and refuses one just over the cap', async () => {
    const { env } = agentEnv();
    const chunk = new Uint8Array(1_000_000);
    chunk.set(PNG);
    let sent = 0;
    const totalChunks = 21; // 21 MB, just over the 20 MB image cap
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= totalChunks) { controller.close(); return; }
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const client = await connectAgent(env, await seedAgent(env));
    const result = structured<{ code: string; message: string }>(await client.callTool({ name: 'add_reference', arguments: { url: 'https://example.com/big.png' } }));
    expect(result).toMatchObject({ code: 'reference_fetch_failed', message: expect.stringContaining('up to 20 MB') });
    expect(sent).toBeLessThan(totalChunks + 2); // the stream stopped once the cap tripped, not after buffering everything
  });

  it('hands out a PUT link that works without an Origin, while browser links still need one', async () => {
    const { db, env } = agentEnv();
    const client = await connectAgent(env, await seedAgent(env));
    const result = structured<{ uploadId: string; putUrl: string; putExpiresAt: number; expiresAt: number }>(await client.callTool({ name: 'add_reference', arguments: { upload: { mimeType: 'image/png', bytes: PNG.length } } }));
    expect(result.putUrl).toMatch(/^http:\/\/localhost:8797\/media\/agent-upload\//);
    expect(result.expiresAt).toBeGreaterThan(result.putExpiresAt); // the input's 24h lifetime, not the short PUT link
    const put = await handleRequest(new Request(result.putUrl, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }), env);
    expect(put.status).toBe(200);
    expect(db.prepare('SELECT state FROM account_uploads WHERE id = ?').get(result.uploadId)).toEqual({ state: 'ready' });
    const browser = await reserveUpload(env, OWNER, PNG.length, 'image/png');
    expect((await handleRequest(new Request(browser.url!, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }), env)).status).toBe(403);
  });

  it('reports the reservation\'s own expiry for the PUT branch, not one recomputed from the tool clock', async () => {
    // A skewed ctx.now() must not leak into expiresAt: reserveUpload timestamps the
    // row with its own real clock, independent of whatever clock the tool call used.
    const { env } = agentEnv();
    const skewedNow = () => Date.now() + 50_000_000_000;
    const client = await connectAgent(env, await seedAgent(env), { now: skewedNow, sleep: async () => {} });
    const result = structured<{ expiresAt: number }>(await client.callTool({ name: 'add_reference', arguments: { upload: { mimeType: 'image/png', bytes: PNG.length } } }));
    expect(Math.abs(result.expiresAt - (Date.now() + INPUT_TTL))).toBeLessThan(5_000);
  });

  it('refuses a browser upload token presented at the agent-upload path', async () => {
    const { env } = agentEnv();
    const browser = await reserveUpload(env, OWNER, PNG.length, 'image/png');
    const swapped = browser.url!.replace('/media/upload/', '/media/agent-upload/');
    const response = await handleRequest(new Request(swapped, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }), env);
    expect(response.status).toBe(404);
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
    const { referenceIds, copiedIds } = await resolveReferences(context, [{ assetId: 'asset-1' }]);
    expect(referenceIds).toHaveLength(1);
    expect(copiedIds).toEqual(referenceIds);
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

  it('leaves no ready copies when a later reference in the same call fails', async () => {
    const { db, objects, context } = await ctx();
    objects.set(seedAsset(db, { id: 'asset-1', jobId: null, bytes: PNG.length }), { bytes: PNG, contentType: 'image/png' });
    await expect(resolveReferences(context, [{ assetId: 'asset-1' }, { assetId: 'missing' }])).rejects.toMatchObject({ code: 'reference_unavailable' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM account_uploads WHERE state='ready'").get()).toEqual({ n: 0 });
  });

  it('passes staged upload ids through untouched', async () => {
    const { context } = await ctx();
    expect(await resolveReferences(context, [{ uploadId: 'u-1' }], { uploadId: 'u-2' })).toEqual({ referenceIds: ['u-1'], sourceVideoId: 'u-2', copiedIds: [] });
  });
});
