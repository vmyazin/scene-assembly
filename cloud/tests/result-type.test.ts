import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob } from '../src/jobs';
import { captureResult } from '../src/assets';
import type { Env } from '../src/security';

// A provider's storage decides the Content-Type, not the provider: Atlas's bucket
// serves finished JPEGs as application/octet-stream (seen on a live Nano Banana
// edit, 2026-09-29), and the result was refused although the bytes were fine.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2]);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

let db: DatabaseSync, env: Env;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)");
  env = { DB: adapter(db), ASSETS: memoryBucket().bucket, APP_ORIGIN: 'http://localhost:3097' };
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

const imageJob = (token: string) => acceptJob(env, 'owner', `result-type-${token}`, { provider: 'local-test', modelId: 'fixture', mediaType: 'image', inputMode: 'text', prompt: 'Type test', values: {}, referenceIds: [] });
/** Serves `bytes` in two chunks, so the type has to be read across a chunk boundary. */
const serve = (bytes: Uint8Array, contentType: string | null) => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.subarray(0, 2)); controller.enqueue(bytes.subarray(2)); controller.close(); } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: contentType ? { 'Content-Type': contentType } : {} })));
};
const stored = (jobId: string) => db.prepare('SELECT mime_type, bytes FROM account_assets WHERE job_id=?').get(jobId) as { mime_type: string; bytes: number } | undefined;

describe('a result whose Content-Type does not name its format', () => {
  it('saves a JPEG served as application/octet-stream under its real type, byte for byte', async () => {
    const job = await imageJob('octet-jpeg');
    serve(JPEG, 'application/octet-stream');
    await captureResult(env, job, { sources: [{ url: 'https://atlas-media.oss-us-west-1.aliyuncs.com/out.jpg' }] });
    expect(stored(job.id)).toEqual({ mime_type: 'image/jpeg', bytes: JPEG.byteLength });
    const object = await env.ASSETS!.get(`accounts/owner/jobs/${job.id}/0`);
    expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(JPEG);
  });

  it('reads the format from the bytes when there is no Content-Type at all', async () => {
    const job = await imageJob('no-type-png');
    serve(PNG, null);
    await captureResult(env, job, { sources: [{ url: 'https://fal.media/out' }] });
    expect(stored(job.id)?.mime_type).toBe('image/png');
  });

  it('still refuses bytes that are not an image the job asked for', async () => {
    const job = await imageJob('octet-video');
    serve(WEBM, 'application/octet-stream');
    await expect(captureResult(env, job, { sources: [{ url: 'https://fal.media/out' }] })).rejects.toMatchObject({ code: 'result_type' });
    expect(stored(job.id)).toBeUndefined();
  });

  it('still refuses an error page, whatever its label', async () => {
    const job = await imageJob('html-page');
    serve(new TextEncoder().encode('<html><body>Access denied</body></html>'), 'text/html');
    await expect(captureResult(env, job, { sources: [{ url: 'https://fal.media/out' }] })).rejects.toMatchObject({ code: 'result_type' });
    expect(stored(job.id)).toBeUndefined();
  });

  it('keeps trusting a Content-Type that already names an image', async () => {
    const job = await imageJob('labelled-png');
    serve(PNG, 'image/png; charset=binary');
    await captureResult(env, job, { sources: [{ url: 'https://fal.media/out.png' }] });
    expect(stored(job.id)?.mime_type).toBe('image/png');
  });
});
