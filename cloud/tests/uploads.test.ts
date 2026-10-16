import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { acceptJob, finishJob } from '../src/jobs';
import { MAX_PENDING_INPUTS, cleanupUploads, inputUrls, publicMedia, reserveUpload } from '../src/uploads';
import { mediaAccess } from '../src/media';
import { captureResult, deleteAsset, writeOutput } from '../src/assets';
import type { Env } from '../src/security';
let db:DatabaseSync,env:Env;
beforeEach(()=>{
  db=new DatabaseSync(':memory:');db.exec(LOCAL_SCHEMA);db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1),('other','google2','other@example.test','Other',1)");
  env={DB:adapter(db),ASSETS:memoryBucket().bucket,APP_ORIGIN:'http://localhost:3097',PUBLIC_WORKER_ORIGIN:'http://localhost:8797'};
});
afterEach(()=>{vi.restoreAllMocks();db.close();});
const uploadRequest=(url:string,bytes=new Uint8Array([1,2,3]),origin=env.APP_ORIGIN)=>new Request(url,{method:'PUT',headers:{Origin:origin,'Content-Type':'image/png'},body:bytes});
async function ready(){const upload=await reserveUpload(env,'owner',3,'image/png');expect((await publicMedia(uploadRequest(upload.url),env))?.status).toBe(200);return upload;}
const request=(ids:string[])=>({provider:'local-test' as const,modelId:'local-test',mediaType:'image' as const,inputMode:'image' as const,prompt:'Reference test',values:{},referenceIds:ids});
describe('an input outlives only the job that needed it',()=>{
  it('frees the slot once its job has finished, without waiting for the TTL',async()=>{
    // The reported blockage: every background image-to-video run consumed one
    // per-user slot and never gave it back, so a day's work wedged the account
    // with "Temporary input storage is full" - while the asset quota it is
    // nothing to do with sat at 62.7 MB of 1 GB. The ceiling is 80 so one Luma
    // edit can stage a source plus 64 keyframes.
    for(let index=0;index<MAX_PENDING_INPUTS;index+=1){
      const upload=await ready();
      const job=await acceptJob(env,'owner',`finished-input-slot-token-${index}`,request([upload.id]));
      await finishJob(env,job.id,'saved',null);
    }
    await expect(reserveUpload(env,'owner',3,'image/png')).rejects.toThrow(/still in use/);

    await cleanupUploads(env);

    await expect(reserveUpload(env,'owner',3,'image/png')).resolves.toBeTruthy();
  });

  it('keeps an input while its job is still live',async()=>{
    const upload=await ready();
    await acceptJob(env,'owner','live-job-still-running-token',request([upload.id]));

    await cleanupUploads(env);

    // Still resolvable: the workflow reads these at dispatch.
    const row=db.prepare("SELECT state FROM account_uploads WHERE id=?").get(upload.id) as {state:string};
    expect(row.state).toBe('ready');
  });

  it('leaves a reservation that no job has claimed to its own expiry',async()=>{
    // Reserve-then-PUT is two calls. Reclaiming an unattached row the moment it
    // appears would delete the reservation between them.
    const upload=await reserveUpload(env,'owner',3,'image/png');

    await cleanupUploads(env);

    const row=db.prepare("SELECT state FROM account_uploads WHERE id=?").get(upload.id) as {state:string};
    expect(row.state).toBe('pending');
  });
});

describe('private reference staging',()=>{
  it('bounds temporary reservations atomically and rejects mismatched bytes',async()=>{
    const uploads=await Promise.allSettled(Array.from({length:13},()=>reserveUpload(env,'owner',20_000_000,'image/png')));
    expect(uploads.filter(r=>r.status==='fulfilled')).toHaveLength(12);
    await expect(reserveUpload(env,'owner',20_000_001,'image/png')).rejects.toThrow();
    const small=await reserveUpload(env,'other',2,'image/png');
    expect((await publicMedia(uploadRequest(small.url),env))?.status).toBe(400);
    expect(db.prepare('SELECT state FROM account_uploads WHERE id=?').get(small.id)?.state).toBe('pending');
  });
  it('requires the upload capability, exact origin and type, and never replaces a ready file',async()=>{
    const upload=await reserveUpload(env,'owner',3,'image/png');
    expect((await publicMedia(uploadRequest(upload.url,undefined,'https://other.test'),env))?.status).toBe(403);
    expect((await publicMedia(new Request(upload.url,{method:'PUT',headers:{Origin:env.APP_ORIGIN,'Content-Type':'text/html'},body:'bad'}),env))?.status).toBe(400);
    expect((await publicMedia(uploadRequest(upload.url),env))?.status).toBe(200);
    expect((await publicMedia(uploadRequest(upload.url,new Uint8Array([9,9,9])),env))?.status).toBe(200);
    const object=await env.ASSETS!.get(`accounts/owner/inputs/${upload.id}`);
    expect([...new Uint8Array(await new Response(object!.body).arrayBuffer())]).toEqual([1,2,3]);
    db.prepare('DELETE FROM account_media_tokens').run();
    expect((await publicMedia(uploadRequest(upload.url),env))?.status).toBe(404);
  });
  it('attaches only ready references owned by the submitting account',async()=>{
    const pending=await reserveUpload(env,'owner',3,'image/png');
    await expect(acceptJob(env,'owner','pending-reference-token',request([pending.id]))).rejects.toThrow();
    const upload=await ready();
    await expect(acceptJob(env,'other','cross-owner-reference-token',request([upload.id]))).rejects.toThrow();
    await expect(acceptJob(env,'owner','duplicate-reference-token',request([upload.id,upload.id]))).rejects.toThrow(/Duplicate/);
    const job=await acceptJob(env,'owner','ready-reference-token',request([upload.id]));
    const urls=await inputUrls(env,job);
    expect((await publicMedia(new Request(urls[0]),env))?.status).toBe(200);
    await finishJob(env,job.id,'cancelled');
    expect((await publicMedia(new Request(urls[0]),env))?.status).toBe(404);
  });
  it('keeps inputs for active jobs beyond cleanup expiry, then deletes them after completion',async()=>{
    const upload=await ready();const job=await acceptJob(env,'owner','retained-reference-token',request([upload.id]));
    db.prepare('UPDATE account_uploads SET expires_at=0').run();
    await cleanupUploads(env);
    expect(await env.ASSETS!.head(`accounts/owner/inputs/${upload.id}`)).not.toBeNull();
    await finishJob(env,job.id,'saved');await cleanupUploads(env);
    expect(await env.ASSETS!.head(`accounts/owner/inputs/${upload.id}`)).toBeNull();
  });
  it('keeps a failed deletion tombstone while cleaning later uploads and expired capabilities',async()=>{
    const first=await ready(),second=await ready();
    db.exec('UPDATE account_uploads SET expires_at=0; UPDATE account_media_tokens SET expires_at=0');
    const remove=env.ASSETS!.delete.bind(env.ASSETS!);
    vi.spyOn(env.ASSETS!,'delete').mockRejectedValueOnce(new Error('R2 unavailable')).mockImplementation(remove);
    await cleanupUploads(env);
    const remaining=db.prepare("SELECT id FROM account_uploads WHERE state='deleted'").all().map(row=>row.id);
    expect(remaining).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_media_tokens').get()?.n).toBe(0);
    expect([await env.ASSETS!.head(`accounts/owner/inputs/${first.id}`),await env.ASSETS!.head(`accounts/owner/inputs/${second.id}`)].filter(Boolean)).toHaveLength(1);
    await cleanupUploads(env);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_uploads').get()?.n).toBe(0);
  });
  it('provides revocable scoped downloads with ranges and no account cookies',async()=>{
    const job=await acceptJob(env,'owner','download-access-token',request([])),key=`accounts/owner/jobs/${job.id}/0`;
    await writeOutput(env,key,new Uint8Array([1,2,3]),'image/png');
    await captureResult(env,job,{sources:[{objectKey:key,mimeType:'image/png'}]});
    const access=await mediaAccess(env,'owner',`${job.id}-0`,'download');
    const response=await publicMedia(new Request(access.url,{headers:{Range:'bytes=1-2'}}),env);
    expect(response?.status).toBe(206);expect(response?.headers.get('content-range')).toBe('bytes 1-2/3');
    expect([...new Uint8Array(await response!.arrayBuffer())]).toEqual([2,3]);
    await deleteAsset(env,`${job.id}-0`,'owner');
    expect((await publicMedia(new Request(access.url),env))?.status).toBe(404);
  });
});
