// cloud/tests/seedance-draft.test.ts
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob } from '../src/jobs';
import { adapterFor, validateRequest } from '../src/providers';
import { saveConnection } from '../src/vault';
import type { Env } from '../src/security';
import type { CloudJobRequest } from '../../lib/account/contracts';

let db: DatabaseSync, env: Env;
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(LOCAL_SCHEMA);
  db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','o','o@example.test','Owner',1)");
  env = {
    DB: adapter(db), ASSETS: memoryBucket().bucket, APP_ORIGIN: 'https://studio.example.test', PUBLIC_WORKER_ORIGIN: 'https://media.example.test',
    CLOUD_GENERATION_PROVIDERS: 'runware', ACCOUNT_ENCRYPTION_VERSION: '1', ACCOUNT_ENCRYPTION_KEYS: JSON.stringify({ '1': btoa('x'.repeat(32)) }),
  };
  await saveConnection(env, 'owner', 'runware', { apiKey: 'test-key' });
});
afterEach(() => { vi.unstubAllGlobals(); db.close(); });

const base = (values: CloudJobRequest['values'], inputMode: CloudJobRequest['inputMode'] = 'text'): CloudJobRequest => ({
  provider: 'runware', modelId: 'bytedance:seedance@2.5', mediaType: 'video', inputMode, prompt: 'A lighthouse at dusk',
  values, referenceIds: [],
});

it('submits a text draft with settings.draft and does not send that flag when it is off', async () => {
  const request = validateRequest(env, base({ draft: true, size: '480p · 16:9', durationSeconds: 5 }));
  const job = await acceptJob(env, 'owner', 'seedance-draft-token', request);
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
  vi.stubGlobal('fetch', fetch);
  await adapterFor(env, 'runware').submit(env, job);
  const [task] = JSON.parse(fetch.mock.calls[0][1].body);
  expect(task).toMatchObject({ positivePrompt: 'A lighthouse at dusk', width: 854, height: 480, settings: { draft: true } });
  expect(() => validateRequest(env, base({ draft: true, size: '720p · 16:9', durationSeconds: 5 }))).toThrow(/480p/);
});

it('finalizes from the stored draft id and does not send the library prompt', async () => {
  const request = validateRequest(env, base({ finalize: true, draftId: 'draft-1', durationSeconds: 5 }));
  expect(request.prompt).toBe('A lighthouse at dusk');
  const job = await acceptJob(env, 'owner', 'seedance-finalize-token', request);
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
  vi.stubGlobal('fetch', fetch);
  await adapterFor(env, 'runware').submit(env, job);
  const [task] = JSON.parse(fetch.mock.calls[0][1].body);
  expect(task).toMatchObject({ taskUUID: job.id, resolution: '1080p', inputs: { draftId: 'draft-1' } });
  expect(task).not.toHaveProperty('positivePrompt');
  expect(task).not.toHaveProperty('settings');
  expect(task.inputs).not.toHaveProperty('video');
  expect(() => validateRequest(env, { ...request, referenceIds: ['image'] })).toThrow(/media/);
  expect(() => validateRequest(env, { ...request, values: { finalize: true, draftId: 'draft-1', durationSeconds: 5, size: '1080p' } })).toThrow(/size/);
});
