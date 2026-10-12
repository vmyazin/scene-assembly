import { DatabaseSync } from 'node:sqlite';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob, finishJob } from '../src/jobs';
import { reserveUpload, publicMedia, cleanupUploads, inputUrls } from '../src/uploads';
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
