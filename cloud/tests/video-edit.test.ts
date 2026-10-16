// cloud/tests/video-edit.test.ts
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob, finishJob } from '../src/jobs';
import { reserveUpload, publicMedia, cleanupUploads, inputUrls, storeUpload } from '../src/uploads';
import { validateRequest, adapterFor } from '../src/providers';
import { saveConnection } from '../src/vault';
import type { Env } from '../src/security';
import type { CloudJobRequest } from '../../lib/account/contracts';
let db:DatabaseSync,env:Env;
beforeEach(async()=>{
 db=new DatabaseSync(':memory:');db.exec(LOCAL_SCHEMA);db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','o','o@example.test','Owner',1),('other','b','b@example.test','Other',1)");
 env={DB:adapter(db),ASSETS:memoryBucket().bucket,APP_ORIGIN:'http://localhost:3151',PUBLIC_WORKER_ORIGIN:'http://localhost:8851',CLOUD_GENERATION_PROVIDERS:'runware',ACCOUNT_ENCRYPTION_VERSION:'1',ACCOUNT_ENCRYPTION_KEYS:JSON.stringify({'1':btoa('x'.repeat(32))})};
 await saveConnection(env,'owner','runware',{apiKey:'test-key'});
});
afterEach(()=>{vi.unstubAllGlobals();db.close();});
async function upload(owner='owner',mime='video/mp4'){
 const u=await reserveUpload(env,owner,3,mime);
 expect((await publicMedia(new Request(u.url,{method:'PUT',headers:{Origin:env.APP_ORIGIN,'Content-Type':mime},body:new Uint8Array([1,2,3])}),env))?.status).toBe(200);
 return u.id;
}
function request(sourceVideoId:string):CloudJobRequest{return {provider:'runware',modelId:'bytedance:seedance@2.5',inputMode:'edit',mediaType:'video',prompt:'Replace the background',referenceIds:[],sourceVideoId,values:{size:'720p'}};}
it('holds source video through dispatch, sends it in the right field, and releases it after completion',async()=>{
 env.APP_ORIGIN='https://studio.example.test';env.PUBLIC_WORKER_ORIGIN='https://media.example.test';
 const id=await upload();const r=validateRequest(env,request(id));
 const job=await acceptJob(env,'owner','edit-source-token',r);
 await cleanupUploads(env);expect(await inputUrls(env,job)).toHaveLength(1);
 const fetch=vi.fn().mockResolvedValue(Response.json({data:[{}]}));vi.stubGlobal('fetch',fetch);
 await adapterFor(env,'runware').submit(env,job);
 const [sent]=JSON.parse(fetch.mock.calls[0][1].body);
 expect(sent).toMatchObject({inputs:{video:expect.stringContaining('/media/')},settings:{operation:'edit'},duration:'auto',resolution:'720p'});
 expect(sent.inputs.referenceImages).toBeUndefined();
 await finishJob(env,job.id,'saved');await cleanupUploads(env);
 expect(db.prepare('SELECT id FROM account_uploads WHERE id=?').get(id)).toBeUndefined();
});
it('uploads local source bytes before inference instead of handing Runware a localhost URL',async()=>{
 const source=await upload(), image=await upload('owner','image/png');
 const job=await acceptJob(env,'owner','local-edit-source-token',{...request(source),referenceIds:[image]});
 const mediaUUID='bcb90f01-e81e-4aae-9b6c-ae94f7c64258';
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({data:[{mediaUUID}]})).mockResolvedValueOnce(Response.json({data:[{}]}));vi.stubGlobal('fetch',fetch);
 const submitted=await adapterFor(env,'runware').submit(env,job);
 expect(JSON.parse(fetch.mock.calls[0][1].body)[0]).toMatchObject({taskType:'mediaStorage',operation:'upload',media:'data:video/mp4;base64,AQID'});
 expect(JSON.parse(fetch.mock.calls[1][1].body)[0]).toMatchObject({taskUUID:job.id,inputs:{video:mediaUUID,referenceImages:['data:image/png;base64,AQID']}});
 expect(submitted.handle?.sourceMedia).toBe(mediaUUID);
 fetch.mockResolvedValueOnce(Response.json({data:[{videoURL:'https://output.example.test/edit.mp4'}]})).mockResolvedValueOnce(Response.json({data:[{}]}));
 await adapterFor(env,'runware').poll(env,job,submitted.handle!);
 expect(JSON.parse(fetch.mock.calls[3][1].body)[0]).toMatchObject({taskType:'mediaStorage',operation:'delete',media:mediaUUID});
});
it('rejects oversized local transfers before reserving a paid job',async()=>{
 const source=await upload();
 db.prepare('UPDATE account_uploads SET expected_bytes=12000001 WHERE id=?').run(source);
 await expect(acceptJob(env,'owner','local-edit-large-token',request(source))).rejects.toThrow(/Local background edits accept up to 12 MB/);
 expect(db.prepare('SELECT COUNT(*) AS n FROM account_jobs').get()).toMatchObject({n:0});
});
it('rejects another owner, an image in the source slot, and a video in an image slot',async()=>{
 const other=await upload('other');await expect(acceptJob(env,'owner','edit-other-token',request(other))).rejects.toThrow(/reference/i);
 const image=await upload('owner','image/png');await expect(acceptJob(env,'owner','edit-image-token',request(image))).rejects.toThrow(/roles/);
 const video=await upload();await expect(acceptJob(env,'owner','edit-video-slot-token',{...request(video),referenceIds:[video],sourceVideoId:undefined,inputMode:'reference'})).rejects.toThrow(/roles/);
});
it('validates mode, source and settings before reserving or submitting',()=>{
 const r=request('source');expect(validateRequest(env,r)).toEqual(r);
 for(const change of [{sourceVideoId:undefined},{provider:'atlas'},{values:{size:'720p',durationSeconds:5}},{values:{size:'4k'}},{referenceIds:Array(6).fill('image')}])expect(()=>validateRequest(env,{...r,...change})).toThrow();
 expect(validateRequest(env,{...r,values:{size:'1080p'}}).values).toEqual({size:'1080p'});
});

it.each([false,true])('submits P-Video-Edit cloud draft=%s with a scoped source URL',async draft=>{
 env.APP_ORIGIN='https://studio.example.test';env.PUBLIC_WORKER_ORIGIN='https://media.example.test';
 const source=await upload(),image=await upload('owner','image/png');
 const r={...request(source),modelId:'prunaai:p-video@edit',referenceIds:[image],values:{draft}};
 expect(validateRequest(env,r)).toEqual(r);
 const job=await acceptJob(env,'owner','pvideo-cloud-test-token',r);
 const fetch=vi.fn().mockResolvedValue(Response.json({data:[{}]}));vi.stubGlobal('fetch',fetch);
 await adapterFor(env,'runware').submit(env,job);
 const [task]=JSON.parse(fetch.mock.calls[0][1].body);
 expect(task).toEqual({taskType:'videoInference',taskUUID:job.id,model:r.modelId,positivePrompt:r.prompt,inputs:{video:expect.stringContaining('/media/'),referenceImages:[expect.stringContaining('/media/')]},settings:{draft},deliveryMethod:'async',includeCost:true,outputFormat:'MP4'});
});
it('rejects P-Video-Edit settings that would spend money on an invalid request',()=>{
 const r={...request('source'),modelId:'prunaai:p-video@edit',values:{}};
 expect(validateRequest(env,r)).toEqual(r);
 for(const change of [{values:{size:'480p'}},{values:{draft:'true'}},{values:{durationSeconds:5}},{referenceIds:Array(5).fill('image')}]) expect(()=>validateRequest(env,{...r,...change})).toThrow();
});

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
/** mvhd duration plus a tkhd frame, so the Worker can refuse a clip the vendor would. */
function mp4Clip(seconds: number, width: number, height: number): Uint8Array {
  const mvhd = new Uint8Array(100);
  const movie = new DataView(mvhd.buffer);
  movie.setUint32(12, 1000);
  movie.setUint32(16, Math.round(seconds * 1000));
  const tkhd = new Uint8Array(84);
  const track = new DataView(tkhd.buffer);
  track.setUint32(76, Math.round(width * 65536));
  track.setUint32(80, Math.round(height * 65536));
  return concat(
    box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])),
    box('mdat', new Uint8Array(4)),
    box('moov', concat(box('mvhd', mvhd), box('trak', box('tkhd', tkhd)))),
  );
}
async function stageClip(seconds: number, width: number, height: number) {
  const bytes = mp4Clip(seconds, width, height);
  return (await storeUpload(env, 'owner', bytes, bytes.length, 'video/mp4')).id;
}

it('refuses a Kling edit whose container misses the published duration or frame', async () => {
  env.CLOUD_GENERATION_PROVIDERS = 'runware,fal';
  await saveConnection(env, 'owner', 'fal', { apiKey: 'fal-key' });
  const falEdit = (sourceVideoId: string, modelId = 'kling-o1-edit'): CloudJobRequest => ({
    provider: 'fal', modelId, mediaType: 'video', inputMode: 'edit', prompt: 'Replace the coat',
    referenceIds: [], sourceVideoId, values: { keep_audio: false },
  });
  const unread = await upload();
  await expect(acceptJob(env, 'owner', 'kling-unread-token', validateRequest(env, falEdit(unread)))).rejects.toThrow(/could not be read/);
  const webm = await upload('owner', 'video/webm');
  await expect(acceptJob(env, 'owner', 'kling-webm-token', validateRequest(env, falEdit(webm)))).rejects.toThrow(/format/);
  const short = await stageClip(2, 1280, 720);
  await expect(acceptJob(env, 'owner', 'kling-short-token', validateRequest(env, falEdit(short)))).rejects.toThrow(/between 3 and 10.05/);
  const small = await stageClip(5, 640, 360);
  await expect(acceptJob(env, 'owner', 'kling-small-token', validateRequest(env, falEdit(small)))).rejects.toThrow(/720 and 2160/);
  const wide = await stageClip(5, 4000, 720);
  await expect(acceptJob(env, 'owner', 'kling-o3-wide-token', validateRequest(env, falEdit(wide, 'kling-o3-standard-edit')))).rejects.toThrow(/720 and 3840/);
  const ok = await stageClip(8, 1280, 720);
  const accepted = await acceptJob(env, 'owner', 'kling-ok-token-1', validateRequest(env, falEdit(ok)));
  expect(JSON.parse(accepted.request_json).values.sourceDurationSeconds).toBe(8);
  await expect(acceptJob(env, 'owner', 'kling-lie-token-1', validateRequest(env, { ...falEdit(ok), values: { keep_audio: false, sourceDurationSeconds: 0.5 } }))).rejects.toThrow(/priced from the file/);
  expect(db.prepare("SELECT COUNT(*) AS n FROM account_jobs WHERE state != 'failed'").get()).toMatchObject({ n: 1 });
});

it('refuses an Aleph source the provider would reject, and posts the local clip as a data URI', async () => {
  env.CLOUD_GENERATION_PROVIDERS = 'runware,comet';
  await saveConnection(env, 'owner', 'comet', { apiKey: 'comet-key' });
  const aleph = (sourceVideoId: string, values: CloudJobRequest['values'] = {}): CloudJobRequest => ({
    provider: 'comet', modelId: 'aleph2', mediaType: 'video', inputMode: 'edit', prompt: 'Replace the sky',
    referenceIds: [], sourceVideoId, values,
  });
  expect(() => validateRequest(env, { ...aleph('source'), prompt: 'x'.repeat(1001) })).toThrow(/1000/);
  expect(() => validateRequest(env, { ...aleph('source'), prompt: 'Swap in @Image1' })).toThrow(/cannot receive images/);
  expect(() => validateRequest(env, aleph('source', { aspectRatio: '5:4' }))).toThrow();
  expect(validateRequest(env, aleph('source', { aspectRatio: '16:9' })).values).toEqual({ aspectRatio: '16:9' });
  const long = await stageClip(31, 1280, 720);
  await expect(acceptJob(env, 'owner', 'aleph-long-token', validateRequest(env, aleph(long)))).rejects.toThrow(/up to 30/);
  const huge = await stageClip(5, 1280, 720);
  db.prepare('UPDATE account_uploads SET expected_bytes = ? WHERE id = ?').run(4_000_000, huge);
  await expect(acceptJob(env, 'owner', 'aleph-inline-token', validateRequest(env, aleph(huge)))).rejects.toThrow(/5 MB/);
  expect(db.prepare('SELECT COUNT(*) AS n FROM account_jobs').get()).toMatchObject({ n: 0 });
  const source = await stageClip(6, 1280, 720);
  const job = await acceptJob(env, 'owner', 'aleph-ok-token-1', validateRequest(env, aleph(source, { aspectRatio: '9:16' })));
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: 'task-aleph' }));
  vi.stubGlobal('fetch', fetch);
  const submitted = await adapterFor(env, 'comet').submit(env, job);
  expect(fetch.mock.calls[0][0]).toBe('https://api.cometapi.com/runwayml/v1/video_to_video');
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body).toMatchObject({ model: 'aleph2', promptText: 'Replace the sky', targetAspectRatio: '9:16' });
  expect(body.videoUri).toMatch(/^data:video\/mp4;base64,/);
  expect(submitted.handle).toMatchObject({ id: 'task-aleph', protocol: 'runway' });
  fetch.mockResolvedValueOnce(Response.json({ status: 'SUCCEEDED', output: ['https://cdn.example/edit.mp4'] }));
  const polled = await adapterFor(env, 'comet').poll(env, job, submitted.handle!);
  expect(polled).toMatchObject({ state: 'success' });
  expect(fetch.mock.calls[1][0]).toContain('/runwayml/v1/tasks/task-aleph');
  expect(JSON.parse(job.request_json).values.sourceDurationSeconds).toBe(6);
});

it('accepts a production Aleph edit larger than the inline image cap and prices it from the file', async () => {
  env.APP_ORIGIN = 'https://studio.example.test';
  env.PUBLIC_WORKER_ORIGIN = 'https://media.example.test';
  env.CLOUD_GENERATION_PROVIDERS = 'comet';
  await saveConnection(env, 'owner', 'comet', { apiKey: 'comet-key' });
  const source = await stageClip(6, 1280, 720);
  db.prepare('UPDATE account_uploads SET expected_bytes = ? WHERE id = ?').run(40_000_000, source);
  const request = validateRequest(env, {
    provider: 'comet', modelId: 'aleph2', mediaType: 'video', inputMode: 'edit', prompt: 'Replace the sky',
    referenceIds: [], sourceVideoId: source, values: {},
  });
  const job = await acceptJob(env, 'owner', 'aleph-prod-token-1', request);
  expect(JSON.parse(job.request_json).values.sourceDurationSeconds).toBe(6);
  expect(job.request_digest).not.toBe('');
});

function runwareEdit(modelId: string, sourceVideoId: string, values: CloudJobRequest['values'] = {}, referenceIds: string[] = []): CloudJobRequest {
  return { provider: 'runware', modelId, mediaType: 'video', inputMode: 'edit', prompt: 'Replace the sky', referenceIds, sourceVideoId, values };
}

it('refuses an Aleph 2.0 source outside the published limits and pins the images it accepts', async () => {
  env.APP_ORIGIN = 'https://studio.example.test';
  env.PUBLIC_WORKER_ORIGIN = 'https://media.example.test';
  const image = await upload('owner', 'image/png');
  const short = await stageClip(1, 1280, 720);
  await expect(acceptJob(env, 'owner', 'aleph20-short-token', validateRequest(env, runwareEdit('runway:aleph@2.0', short)))).rejects.toThrow(/between 2 and 30/);
  const wide = await stageClip(6, 2560, 1440);
  await expect(acceptJob(env, 'owner', 'aleph20-wide-token', validateRequest(env, runwareEdit('runway:aleph@2.0', wide)))).rejects.toThrow(/at most 1920/);
  const heavy = await stageClip(6, 1280, 720);
  db.prepare('UPDATE account_uploads SET expected_bytes = ? WHERE id = ?').run(32_000_001, heavy);
  await expect(acceptJob(env, 'owner', 'aleph20-heavy-token', validateRequest(env, runwareEdit('runway:aleph@2.0', heavy)))).rejects.toThrow(/32 MB/);
  const source = await stageClip(6, 1280, 720);
  await expect(acceptJob(env, 'owner', 'aleph20-late-token', validateRequest(env, runwareEdit('runway:aleph@2.0', source, { frameAnchors: 't:12' }, [image])))).rejects.toThrow(/inside the 6.00 s source/);
  const job = await acceptJob(env, 'owner', 'aleph20-ok-token', validateRequest(env, runwareEdit('runway:aleph@2.0', source, { frameAnchors: 'first' }, [image])));
  expect(JSON.parse(job.request_json).values.sourceDurationSeconds).toBe(6);
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
  vi.stubGlobal('fetch', fetch);
  await adapterFor(env, 'runware').submit(env, job);
  const [task] = JSON.parse(fetch.mock.calls[0][1].body);
  expect(task).toMatchObject({
    model: 'runway:aleph@2.0', positivePrompt: 'Replace the sky',
    inputs: { video: expect.stringContaining('/media/'), frameImages: [{ image: expect.stringContaining('/media/'), frame: 'first' }] },
  });
  expect(task).not.toHaveProperty('duration');
  expect(task).not.toHaveProperty('resolution');
  expect(task).not.toHaveProperty('settings');
});

it('submits Kling O1 with reference images and no invented duration or price inputs', async () => {
  env.APP_ORIGIN = 'https://studio.example.test';
  env.PUBLIC_WORKER_ORIGIN = 'https://media.example.test';
  const image = await upload('owner', 'image/png');
  const unread = await upload();
  expect(() => validateRequest(env, { ...runwareEdit('klingai:kling@o1', 'source'), prompt: 'A' })).toThrow(/at least 2/);
  const job = await acceptJob(env, 'owner', 'kling-o1-ok-token', validateRequest(env, runwareEdit('klingai:kling@o1', unread, { keepOriginalSound: false }, [image])));
  expect(JSON.parse(job.request_json).values.sourceDurationSeconds).toBeUndefined();
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
  vi.stubGlobal('fetch', fetch);
  await adapterFor(env, 'runware').submit(env, job);
  const [task] = JSON.parse(fetch.mock.calls[0][1].body);
  expect(task).toMatchObject({
    model: 'klingai:kling@o1',
    inputs: { video: expect.stringContaining('/media/'), referenceImages: [expect.stringContaining('/media/')] },
    providerSettings: { klingai: { keepOriginalSound: false } },
  });
  expect(task).not.toHaveProperty('duration');
  expect(task).not.toHaveProperty('resolution');
  const standard = validateRequest(env, runwareEdit('klingai:kling@o1-standard', unread, {}, [image]));
  expect(standard.modelId).toBe('klingai:kling@o1-standard');
});

it('refuses an Omni 4K source outside 3–15.5s or 8.29 MP and sends resolution 4k', async () => {
  env.APP_ORIGIN = 'https://studio.example.test';
  env.PUBLIC_WORKER_ORIGIN = 'https://media.example.test';
  const image = await upload('owner', 'image/png');
  const long = await stageClip(16, 1920, 1080);
  await expect(acceptJob(env, 'owner', 'kling-o3-long-token', validateRequest(env, runwareEdit('klingai:kling-video@o3-4k', long)))).rejects.toThrow(/15.5/);
  const small = await stageClip(6, 640, 360);
  await expect(acceptJob(env, 'owner', 'kling-o3-small-token', validateRequest(env, runwareEdit('klingai:kling-video@o3-4k', small)))).rejects.toThrow(/700 and 4553/);
  const source = await stageClip(6, 3840, 2160);
  const job = await acceptJob(env, 'owner', 'kling-o3-ok-token', validateRequest(env, runwareEdit('klingai:kling-video@o3-4k', source, {}, [image])));
  expect(JSON.parse(job.request_json).values.sourceDurationSeconds).toBe(6);
  const fetch = vi.fn().mockResolvedValue(Response.json({ data: [{}] }));
  vi.stubGlobal('fetch', fetch);
  await adapterFor(env, 'runware').submit(env, job);
  const [task] = JSON.parse(fetch.mock.calls[0][1].body);
  expect(task).toMatchObject({
    model: 'klingai:kling-video@o3-4k', resolution: '4k',
    inputs: { video: expect.stringContaining('/media/'), referenceImages: [expect.stringContaining('/media/')] },
    providerSettings: { klingai: { keepOriginalSound: true } },
  });
  expect(task).not.toHaveProperty('duration');
  expect(task).not.toHaveProperty('width');
});
