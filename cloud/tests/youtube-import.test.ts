import { afterEach, describe, expect, it, vi } from 'vitest';
import { roundTenth } from '../../lib/youtube/clip';
import { handleRequest } from '../src/index';
import { importYouTubeClip } from '../src/youtube/import';
import { accountCall, agentEnv, OWNER, signIn } from './agent-fixtures';
import { CLIP_BYTES, clipOk, fakeImporter } from './youtube-fixtures';

const URL_ = 'https://youtu.be/aqz-KE-bpKQ?si=x';
const SEEDANCE = { provider: 'runware', modelId: 'bytedance:seedance@2.5' };
afterEach(() => vi.restoreAllMocks());

describe('importYouTubeClip', () => {
  it('stages the section as a ready upload for its owner', async () => {
    const importer = fakeImporter(() => clipOk());
    const { env, db } = agentEnv({ YOUTUBE_IMPORTER: importer.namespace });
    const clip = await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4, edit: SEEDANCE });
    expect(clip).toMatchObject({ mimeType: 'video/mp4', bytes: CLIP_BYTES.length, durationSeconds: 12.4, width: 1280, height: 720, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } });
    expect(importer.calls).toEqual([{ owner: OWNER, request: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 }, signal: undefined }]);
    expect(db.prepare('SELECT state, user_id, expected_bytes FROM account_uploads WHERE id=?').get(clip.uploadId)).toEqual({ state: 'ready', user_id: OWNER, expected_bytes: CLIP_BYTES.length });
  });
  it('accepts a probed length a few hundredths over and reports the requested length', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk({ durationSeconds: 30.04 })).namespace });
    expect((await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 30, edit: SEEDANCE })).durationSeconds).toBe(30);
  });
  it('refuses bad links and ranges before calling the importer', async () => {
    const importer = fakeImporter(r => clipOk({ durationSeconds: roundTenth(r.endSeconds - r.startSeconds) }));
    const { env } = agentEnv({ YOUTUBE_IMPORTER: importer.namespace });
    await expect(importYouTubeClip(env, OWNER, { url: 'https://vimeo.com/1', startSeconds: 0, endSeconds: 10 })).rejects.toMatchObject({ code: 'invalid_field', message: 'Paste a YouTube video or Shorts link.' });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 31, edit: SEEDANCE })).rejects.toMatchObject({ code: 'invalid_range' });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 2, edit: SEEDANCE })).rejects.toMatchObject({ code: 'invalid_range' });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 2 })).resolves.toBeDefined(); // catalog-wide floor is 1 s
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 10, edit: { provider: 'runware', modelId: 'runware:z-image@turbo' } })).rejects.toMatchObject({ code: 'invalid_field' });
    expect(importer.calls).toHaveLength(1);
  });
  it.each([
    [{ ok: false, code: 'range', detail: '' }, 'invalid_range', undefined],
    [{ ok: false, code: 'unavailable', reason: 'private', detail: '' }, 'source_unavailable', undefined],
    [{ ok: false, code: 'no_720p', detail: '' }, 'source_unavailable', undefined],
    [{ ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: 600 }, 'import_rate_limited', 600],
    [{ ok: false, code: 'busy', detail: '', retryAfterSeconds: 30 }, 'import_rate_limited', 30],
    [{ ok: false, code: 'refused', detail: '', retryAfterSeconds: 60 }, 'source_refused', 60],
    [{ ok: false, code: 'timeout', detail: '' }, 'source_refused', 60],
    [{ ok: false, code: 'unconfigured', detail: 'No container is configured.', retryAfterSeconds: 300 }, 'source_refused', 300],
  ] as const)('maps %o to %s', async (failure, code, retry) => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => failure).namespace });
    const error = await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 }).catch(e => e);
    expect(error).toMatchObject({ code });
    expect(error.retryAfterSeconds).toBe(retry);
  });
  it('names the reason a video is unavailable', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => ({ ok: false, code: 'unavailable', reason: 'age', detail: '' })).namespace });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 })).rejects.toThrow("This video can't be imported: it is age-restricted.");
  });
  it('never logs the proxy credentials yt-dlp echoes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => ({ ok: false, code: 'refused', detail: 'Unable to connect to proxy http://user:hunter2@proxy.example:8000 (timed out)' })).namespace });
    await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 }).catch(() => {});
    expect(JSON.stringify(warn.mock.calls)).not.toContain('hunter2');
  });
  it('tombstones the upload when the clip fails the model source bounds or the cut is off', async () => {
    for (const patch of [{ width: 640, height: 360 }, { durationSeconds: 11 }]) {
      const { env, db } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk(patch)).namespace });
      await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4, edit: SEEDANCE })).rejects.toMatchObject({ code: expect.stringMatching(/source_unavailable|source_refused/) });
      expect(db.prepare("SELECT COUNT(*) AS n FROM account_uploads WHERE state='ready'").get()).toEqual({ n: 0 });
    }
  });
  it('says import is unavailable, not that YouTube refused, when no container is attached', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => ({ ok: false, code: 'unconfigured', detail: 'No container is configured.', retryAfterSeconds: 300 })).namespace });
    const error = await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 }).catch(e => e);
    expect(error).toMatchObject({ code: 'source_refused', message: 'YouTube import is not available right now.', retryAfterSeconds: 300 });
  });
  it('pluralises the wait in the hourly-limit message', async () => {
    for (const [seconds, text] of [[45, '1 minute'], [60, '1 minute'], [61, '2 minutes'], [600, '10 minutes']] as const) {
      const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => ({ ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: seconds })).namespace });
      await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 })).rejects.toThrow(`Import limit reached. Try again in ${text}.`);
    }
  });
  it('answers source_refused when the importer Durable Object cannot be reached, and cancelled when the caller left', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = { getByName: () => ({ fetch: async () => { throw new Error('Durable Object reset because its code was updated.'); } }) } as unknown as DurableObjectNamespace;
    const { env } = agentEnv({ YOUTUBE_IMPORTER: broken });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 })).rejects.toMatchObject({ code: 'source_refused', message: 'YouTube refused the download. Try again in a few minutes.', retryAfterSeconds: 30 });
    expect(warn).toHaveBeenCalled();
    const cancel = new AbortController();
    const hangUp = { getByName: () => ({ fetch: async () => { cancel.abort(); throw new DOMException('The operation was aborted.', 'AbortError'); } }) } as unknown as DurableObjectNamespace;
    const { env: left } = agentEnv({ YOUTUBE_IMPORTER: hangUp });
    await expect(importYouTubeClip(left, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 }, cancel.signal)).rejects.toMatchObject({ code: 'source_refused', message: 'Import cancelled.', retryAfterSeconds: 5 });
  });
  it('answers source_refused with no importer bound', async () => {
    const { env } = agentEnv();
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 })).rejects.toMatchObject({ code: 'source_refused', message: 'YouTube import is not available right now.' });
  });
});

describe('POST /api/account/youtube-clips', () => {
  it('needs a session, imports, and hands back a working preview link for the owner only', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk()).namespace });
    const body = { url: URL_, startSeconds: 62, endSeconds: 74.4, edit: SEEDANCE };
    expect((await accountCall(env, 'youtube-clips', 'POST', '', body)).status).toBe(401);
    const response = await accountCall(env, 'youtube-clips', 'POST', await signIn(env), body);
    expect(response.status).toBe(201);
    const clip = await response.json() as { uploadId: string; previewUrl: string };
    const preview = await handleRequest(new Request(clip.previewUrl), env);
    expect(preview.status).toBe(200);
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(CLIP_BYTES);
  });
  it('returns the code and retry hint the browser shows', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => ({ ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: 600 })).namespace });
    const response = await accountCall(env, 'youtube-clips', 'POST', await signIn(env), { url: URL_, startSeconds: 62, endSeconds: 74.4 });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Import limit reached. Try again in 10 minutes.', code: 'import_rate_limited', retryAfterSeconds: 600 });
  });
  it('refuses malformed bodies', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk()).namespace });
    const cookie = await signIn(env);
    for (const bad of [{ url: URL_ }, { url: URL_, startSeconds: '1', endSeconds: 9 }, { url: URL_, startSeconds: 1, endSeconds: 9, edit: { provider: 1 } }]) {
      expect((await accountCall(env, 'youtube-clips', 'POST', cookie, bad)).status).toBe(400);
    }
  });
});
