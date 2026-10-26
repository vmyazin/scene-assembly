import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudJobRequest } from '../../lib/account/contracts';
import { findModelDescriptor, sampleRequest } from '../../lib/account/model-schema';
import { buildAccountSpendEntry } from '../../lib/spend/account';
import { acceptJob } from '../src/jobs';
import { adapterFor, validateRequest } from '../src/providers';
import { LOCAL_SCHEMA } from '../src/schema';
import type { Env } from '../src/security';
import { storeUpload } from '../src/uploads';
import { saveConnection } from '../src/vault';
import { memoryBucket } from './bucket';
import { adapter } from './database';

let db: DatabaseSync;
let env: Env;

beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)");
  env = {
    DB: adapter(db), ASSETS: memoryBucket().bucket,
    APP_ORIGIN: 'https://studio.example.test', PUBLIC_WORKER_ORIGIN: 'https://media.example.test',
    CLOUD_GENERATION_PROVIDERS: 'atlas', ACCOUNT_ENCRYPTION_VERSION: '1',
    ACCOUNT_ENCRYPTION_KEYS: JSON.stringify({ '1': btoa('x'.repeat(32)) }),
  };
  await saveConnection(env, 'owner', 'atlas', { apiKey: 'atlas-test-secret' });
});

afterEach(() => { vi.unstubAllGlobals(); db.close(); });

const modelId = (mode: string) => `kwaivgi/kling-v4.0/${mode}`;
const images = (count: number) => Array.from({ length: count }, (_, index) => `image-${index}`);
function generation(mode: CloudJobRequest['inputMode'], count = 0): CloudJobRequest {
  const endpoint = mode === 'text' ? 'text-to-video' : mode === 'reference' ? 'reference-to-video' : 'image-to-video';
  return {
    provider: 'atlas', modelId: modelId(endpoint), mediaType: 'video', inputMode: mode,
    prompt: 'A lighthouse above the sea', referenceIds: images(count),
    values: { size: '720p', durationSeconds: 5 },
  };
}

describe('Atlas Kling 4.0 account contract', () => {
  it('describes ten ordered image frames, two bookends, and ten image references', () => {
    const image = findModelDescriptor('atlas', modelId('image-to-video'), 'video')!;
    expect(image.modes.find(mode => mode.mode === 'image')?.references).toEqual({ min: 1, max: 10 });
    expect(image.modes.find(mode => mode.mode === 'frames')?.references).toEqual({ min: 2, max: 2 });
    for (const mode of image.modes) {
      expect(mode.fields.some(field => field.key === 'aspectRatio')).toBe(false);
      expect(() => validateRequest(env, {
        ...generation(mode.mode, mode.mode === 'frames' ? 2 : 1),
        values: { size: '720p', durationSeconds: 5, aspectRatio: '16:9' },
      })).toThrow(/not an aspect ratio/);
    }
    const reference = findModelDescriptor('atlas', modelId('reference-to-video'), 'video')!;
    expect(reference.modes[0].references).toEqual({ min: 1, max: 10 });
    // Fifteen is the vendor's mixed-media total, not its image-array limit.
    expect(() => validateRequest(env, generation('image', 10))).not.toThrow();
    expect(() => validateRequest(env, generation('reference', 10))).not.toThrow();
    expect(() => validateRequest(env, generation('image', 11))).toThrow(/up to 10/);
    expect(() => validateRequest(env, generation('reference', 15))).toThrow(/up to 10/);
    expect(() => validateRequest(env, generation('frames', 3))).toThrow(/exactly two/);
    expect(() => validateRequest(env, { ...generation('reference', 1), referenceVideoIds: ['clip'] })).toThrow(/reference video/);
  });

  it('refuses unsupported generation sizes and durations before a job can reserve', () => {
    const request = generation('text');
    expect(() => validateRequest(env, { ...request, values: { size: '1080p', durationSeconds: 30 } })).not.toThrow();
    for (const values of [
      { size: '4K', durationSeconds: 5 },
      { size: '720p', durationSeconds: 2 },
      { size: '720p', durationSeconds: 31 },
      { size: '720p', durationSeconds: 5.5 },
    ]) expect(() => validateRequest(env, { ...request, values })).toThrow();
    expect(() => validateRequest(env, { ...request, prompt: 'a'.repeat(11_001) })).toThrow(/11,000/);
  });

  it('sends all ten scoped frame addresses in order without dropping the middle eight', async () => {
    const referenceIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      referenceIds.push((await storeUpload(env, 'owner', new Uint8Array([index]), 1, 'image/png')).id);
    }
    const request = validateRequest(env, { ...generation('image'), referenceIds });
    const job = await acceptJob(env, 'owner', 'kling-four-keyframes-token', request);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { id: 'kling-four-task' } }));
    vi.stubGlobal('fetch', fetchMock);
    await adapterFor(env, 'atlas').submit(env, job);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: request.modelId, duration: 5, resolution: '720p' });
    expect(body.image).toContain('/media/');
    expect(body.middle_images).toHaveLength(8);
    expect(body.last_image).toContain('/media/');
    expect(new Set([body.image, ...body.middle_images, body.last_image]).size).toBe(10);
    expect(body.reference_images).toBeUndefined();
  });

  it('sends the edit output duration independently of source duration and leaves unverified pricing unknown', async () => {
    const bytes = mp4Clip(6, 1280, 720);
    const sourceVideoId = (await storeUpload(env, 'owner', bytes, bytes.length, 'video/mp4')).id;
    const image = (await storeUpload(env, 'owner', new Uint8Array([1]), 1, 'image/png')).id;
    const request = editRequest(sourceVideoId, [image]);
    const descriptor = findModelDescriptor('atlas', request.modelId, 'video')!;
    expect(() => validateRequest(env, sampleRequest(descriptor, descriptor.modes[0]))).not.toThrow();
    const job = await acceptJob(env, 'owner', 'kling-four-edit-token', validateRequest(env, request));
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { id: 'kling-four-edit' } }));
    vi.stubGlobal('fetch', fetchMock);
    await adapterFor(env, 'atlas').submit(env, job);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: request.modelId, duration: 10, resolution: '1080p' });
    expect(body.video).toContain('/media/');
    expect(body.reference_images).toHaveLength(1);
    expect(body.reference_images[0]).not.toBe(body.video);
    expect(body.images).toBeUndefined();
    expect(body.keep_original_sound).toBeUndefined();
    expect(body.aspect_ratio).toBeUndefined();
    expect(buildAccountSpendEntry({ jobId: job.id, request, result: { sources: [{ url: 'https://example.test/edit.mp4' }] }, at: 1 }))
      .toMatchObject({ costUsd: null, confidence: 'unknown' });
  });

  it('checks edit source limits before reserving even without a verified edit rate', async () => {
    for (const [seconds, width, height] of [[2, 1280, 720], [31, 1280, 720], [5, 640, 360]]) {
      const bytes = mp4Clip(seconds, width, height);
      const source = (await storeUpload(env, 'owner', bytes, bytes.length, 'video/mp4')).id;
      await expect(acceptJob(env, 'owner', `kling-four-invalid-${seconds}-${width}`, validateRequest(env, editRequest(source))))
        .rejects.toThrow(/between 3 and 30|700 and 4553/);
    }
    const unread = (await storeUpload(env, 'owner', new Uint8Array([1]), 1, 'video/mp4')).id;
    await expect(acceptJob(env, 'owner', 'kling-four-unreadable-source', validateRequest(env, editRequest(unread))))
      .rejects.toThrow(/could not be read/);
    const bytes = mp4Clip(6, 1280, 720);
    const oversized = (await storeUpload(env, 'owner', bytes, bytes.length, 'video/mp4')).id;
    db.prepare('UPDATE account_uploads SET expected_bytes = ? WHERE id = ?').run(200_000_001, oversized);
    await expect(acceptJob(env, 'owner', 'kling-four-app-size-cap', validateRequest(env, editRequest(oversized))))
      .rejects.toThrow(/200 MB/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM account_jobs').get()).toMatchObject({ count: 0 });
    for (const outputDuration of [2, 31, 5.5]) {
      expect(() => validateRequest(env, { ...editRequest('source'), values: { size: '720p', outputDuration } })).toThrow();
    }
    expect(() => validateRequest(env, { ...editRequest('source'), prompt: 'a'.repeat(11_001) })).toThrow(/11000|11,000/);
  });
});

function editRequest(sourceVideoId: string, referenceIds: string[] = []): CloudJobRequest {
  return {
    provider: 'atlas', modelId: modelId('video-edit'), mediaType: 'video', inputMode: 'edit',
    prompt: 'Change the coat in @video_1 using @image_1', sourceVideoId, referenceIds,
    values: { size: '1080p', outputDuration: 10 },
  };
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(Array.from(type, char => char.charCodeAt(0)), 4);
  bytes.set(payload, 8);
  return bytes;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function mp4Clip(seconds: number, width: number, height: number): Uint8Array {
  const mvhd = new Uint8Array(100), tkhd = new Uint8Array(84);
  const movie = new DataView(mvhd.buffer), track = new DataView(tkhd.buffer);
  movie.setUint32(12, 1000);
  movie.setUint32(16, Math.round(seconds * 1000));
  track.setUint32(76, width * 65536);
  track.setUint32(80, height * 65536);
  return concat(box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])), box('mdat', new Uint8Array(4)), box('moov', concat(box('mvhd', mvhd), box('trak', box('tkhd', tkhd)))));
}
