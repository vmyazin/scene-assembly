// cloud/tests/reference-clip-limits.test.ts
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { saveConnection } from '../src/vault';
import { acceptJob } from '../src/jobs';
import { publicMedia, reserveUpload } from '../src/uploads';
import { aggregatorAdapter } from '../src/provider-adapters/aggregators';
import type { Env } from '../src/security';
import type { CloudJobRequest } from '../../lib/account/contracts';

let db: DatabaseSync;
let env: Env;

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function mp4(seconds: number): Uint8Array {
  const payload = new Uint8Array(100);
  const view = new DataView(payload.buffer);
  view.setUint32(12, 1000);
  view.setUint32(16, Math.round(seconds * 1000));
  const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
  return concat(ftyp, box('mdat', new Uint8Array(4)), box('moov', box('mvhd', payload)));
}

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)");
  env = {
    DB: adapter(db), ASSETS: memoryBucket().bucket, APP_ORIGIN: 'http://localhost:3097',
    PUBLIC_WORKER_ORIGIN: 'http://localhost:8797', CLOUD_GENERATION_PROVIDERS: 'runware,atlas',
    ACCOUNT_ENCRYPTION_VERSION: '1', ACCOUNT_ENCRYPTION_KEYS: JSON.stringify({ '1': btoa('x'.repeat(32)) }),
  };
  await saveConnection(env, 'owner', 'runware', { apiKey: 'local-test-secret' });
  await saveConnection(env, 'owner', 'atlas', { apiKey: 'atlas-test-secret' });
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

async function stage(bytes: Uint8Array, mime: string): Promise<string> {
  const upload = await reserveUpload(env, 'owner', bytes.length, mime);
  const response = await publicMedia(new Request(upload.url!, {
    method: 'PUT',
    headers: { Origin: env.APP_ORIGIN, 'Content-Type': mime },
    body: bytes,
  }), env);
  expect(response?.status).toBe(200);
  return upload.id;
}

function request(patch: Partial<CloudJobRequest>): CloudJobRequest {
  return {
    provider: 'atlas', modelId: 'bytedance/seedance-2.0-fast/reference-to-video', mediaType: 'video', inputMode: 'reference',
    prompt: 'Follow the clip', values: {}, referenceIds: [], ...patch,
  };
}

describe('reference clip limits before a job is reserved', () => {
  it('refuses an Atlas clip over that model\'s byte cap without reserving', async () => {
    const id = await stage(mp4(5), 'video/mp4');
    db.prepare('UPDATE account_uploads SET expected_bytes = ? WHERE id = ?').run(80_000_000, id);
    await expect(acceptJob(env, 'owner', 'atlas-clip-bytes-token', request({ referenceVideoIds: [id] }))).rejects.toThrow(/50 MB/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_jobs').get()).toEqual({ n: 0 });
  });

  it('refuses a clip longer than the model allows without reserving', async () => {
    const id = await stage(mp4(40), 'video/mp4');
    await expect(acceptJob(env, 'owner', 'atlas-clip-length-token', request({ referenceVideoIds: [id] }))).rejects.toThrow(/2–15 seconds/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_jobs').get()).toEqual({ n: 0 });
  });

  it('names WebM as an edit source when it is passed as a reference video', async () => {
    const id = await stage(new Uint8Array([1, 2, 3, 4]), 'video/webm');
    await expect(acceptJob(env, 'owner', 'webm-reference-token', request({
      provider: 'runware', modelId: 'bytedance:seedance@2.5', inputMode: 'text',
      values: { durationSeconds: 5, size: '480p · 16:9' }, referenceVideoIds: [id],
    }))).rejects.toThrow(/WebM is an edit source/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_jobs').get()).toEqual({ n: 0 });
  });

  it('deletes locally stored Runware media when creating the task throws', async () => {
    const id = await stage(mp4(5), 'video/mp4');
    const job = await acceptJob(env, 'owner', 'runware-clip-leak-token', request({
      provider: 'runware', modelId: 'bytedance:seedance@2.5', inputMode: 'text',
      values: { durationSeconds: 5, size: '480p · 16:9' }, referenceVideoIds: [id],
    }));
    const stored = '11111111-1111-4111-8111-111111111111';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ mediaUUID: stored }] }) })
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{}] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(aggregatorAdapter.submit(env, job)).rejects.toThrow(/create failed/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)[0]).toMatchObject({ operation: 'delete', media: stored });
  });
});
