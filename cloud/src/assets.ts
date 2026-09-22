import type { CloudAsset, CloudJobRequest } from '../../lib/account/contracts';
import { AccountError, type JobRow } from './jobs';
import type { Env } from './security';
import { AVAILABLE_CAPACITY, OVERFLOW_TTL_MS, promoteTemporaryAsset } from './retention';
import { deleteQueuedObject } from './cleanup';

export const MAX_OUTPUT_BYTES = 1_000_000_000;
export const MAX_JOB_OUTPUTS = 8;
export const MAX_JOB_OUTPUT_BYTES = 1_000_000_000;
interface AssetRow { id: string; user_id: string; job_id: string | null; object_key: string; kind: 'image'|'video'; mime_type: string; bytes: number; metadata_json: string; created_at: number; deleted: number; expires_at?:number|null }
export interface ResultSource { url?: string; objectKey?: string; mimeType?: string }
export interface ProviderResult { sources: ResultSource[]; cost?: number; usage?: { promptTokens: number; outputTokens: number } }
export const isSupportedOutputMime = (mimeType:string) => /^(image\/(png|jpeg|webp|avif)|video\/(mp4|webm))$/.test(mimeType);
export function assetView(row: AssetRow): CloudAsset { return { id:row.id, jobId:row.job_id, kind:row.kind, mimeType:row.mime_type, bytes:row.bytes, createdAt:row.created_at, metadata:JSON.parse(row.metadata_json),...(row.expires_at?{expiresAt:row.expires_at}:{}) }; }
export async function getAsset(env:Env,id:string,owner:string) { return env.DB.prepare('SELECT a.*,r.expires_at FROM account_assets a LEFT JOIN account_asset_retention r ON r.asset_id=a.id WHERE a.id = ? AND a.user_id = ? AND a.deleted = 0 AND (r.expires_at IS NULL OR r.expires_at>?)').bind(id,owner,Date.now()).first<AssetRow>(); }

/** Host allowlist prevents a provider result from turning the capture worker into a URL proxy. */
export function safeResultUrl(value:string): URL {
  const url=new URL(value);
  const domains=['fal.media','fal.ai','kie.ai','kieai.redpandaai.co','tempfile.ai','tempfile.redpandaai.co','redpandaai.co','runware.ai','atlascloud.ai','cometapi.com','filesystem.site','piapi.ai','theapi.app'];
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !domains.some(d=>url.hostname===d||url.hostname.endsWith(`.${d}`))) throw new AccountError('Provider returned an unsupported result location.',502,'result_location');
  return url;
}
async function fetchOutput(url:string):Promise<Response> {
  let target=safeResultUrl(url);
  for(let i=0;i<4;i++) {
    const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(120_000)});
    if([301,302,303,307,308].includes(response.status)) { const next=response.headers.get('location'); await response.body?.cancel(); if(!next)break; target=safeResultUrl(new URL(next,target).href); continue; }
    // Split on purpose: a link the provider has already expired answers the
    // same way on every resume, so it is not the retryable "transfer broke"
    // case the single `save_failed` code used to lump it in with.
    if(!response.ok || !response.body)throw new AccountError([403,404,410].includes(response.status)?'The provider\'s download link for this result no longer works.':'Could not fetch the generated file.',502,[403,404,410].includes(response.status)?'result_link_expired':'save_failed');
    return response;
  }
  throw new AccountError('Provider returned too many redirects.',502,'result_location');
}
export async function writeOutput(env:Env,key:string,body:ReadableStream<Uint8Array>|Uint8Array,mimeType:string,maxBytes=MAX_OUTPUT_BYTES) {
  if(!env.ASSETS)throw new Error('Asset storage is unavailable');
  if(!isSupportedOutputMime(mimeType))throw new AccountError('Unsupported generated file type.',502,'result_type');
  let length=0;
  const input=body instanceof Uint8Array ? new ReadableStream<Uint8Array>({start(controller){controller.enqueue(body);controller.close();}}) : body;
  const bounded=input.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){length+=chunk.byteLength;if(length>maxBytes)throw new AccountError('Generated file exceeds the supported transfer limit.',502,'result_size');controller.enqueue(chunk);}}));
  // R2.put needs known length for a stream. Multipart keeps memory bounded and
  // leaves the object invisible until all parts have been uploaded.
  const upload=await env.ASSETS.createMultipartUpload(key,{httpMetadata:{contentType:mimeType}});
  const reader=bounded.getReader();
  const parts:R2UploadedPart[]=[];
  const partSize=8*1024*1024;
  let pending=new Uint8Array(partSize), used=0;
  try {
    while(true){
      const {value,done}=await reader.read();if(done)break;
      let offset=0;
      while(offset<value.length){const count=Math.min(partSize-used,value.length-offset);pending.set(value.subarray(offset,offset+count),used);used+=count;offset+=count;if(used===partSize){parts.push(await upload.uploadPart(parts.length+1,pending));pending=new Uint8Array(partSize);used=0;}}
    }
    if(length===0)throw new Error('Empty result');
    if(used)parts.push(await upload.uploadPart(parts.length+1,pending.slice(0,used)));
    return await upload.complete(parts);
  }catch(error){await reader.cancel().catch(()=>{});await upload.abort().catch(()=>{});throw error;}
}
export async function captureResult(env:Env,job:JobRow,result:ProviderResult) {
  if(!env.ASSETS)throw new Error('Asset storage is unavailable');
  if(result.sources.length===0||result.sources.length>MAX_JOB_OUTPUTS)throw new AccountError('Unsupported number of results.',502,'result_count');
  const request=JSON.parse(job.request_json) as CloudJobRequest;
  let totalBytes=0;
  for(let i=0;i<result.sources.length;i++){
    const id=`${job.id}-${i}`, source=result.sources[i], key=`accounts/${job.user_id}/jobs/${job.id}/${i}`;
    const existing=await env.DB.prepare('SELECT a.bytes,a.deleted,r.expires_at FROM account_assets a LEFT JOIN account_asset_retention r ON r.asset_id=a.id WHERE a.id=?').bind(id).first<{bytes:number;deleted:number;expires_at:number|null}>();
    if(existing){
      totalBytes+=existing.bytes;
      if(!existing.deleted&&existing.expires_at)await promoteTemporaryAsset(env,job,id,existing.bytes);
      continue; // Includes tombstones: never resurrect a deleted asset.
    }
    let object=await env.ASSETS.head(key);
    let storedMime=object?.httpMetadata?.contentType||source.mimeType;
    if(!object){
      if(source.objectKey){
        if(source.objectKey!==key)throw new AccountError('Invalid staged result.',502,'staged_missing');
        throw new AccountError('The staged result is no longer in storage.',502,'staged_missing');
      }
      if(!source.url)throw new AccountError('The provider reported success without a result to fetch.',502,'result_missing');
      const response=await fetchOutput(source.url);
      const mime=(response.headers.get('content-type')||source.mimeType||'').split(';')[0].trim().toLowerCase();
      if(!mime.startsWith(`${request.mediaType}/`)){await response.body?.cancel();throw new AccountError('The provider returned a different kind of file than this job asked for.',502,'result_type');}
      // Multipart completion can omit httpMetadata even though R2 stored it.
      // Keep the MIME that passed writeOutput validation for the D1 asset row.
      storedMime=mime;
      object=await writeOutput(env,key,response.body!,mime,MAX_JOB_OUTPUT_BYTES-totalBytes);
    }
    if(object.size<=0)throw new AccountError('The stored result is empty.',502,'result_empty');
    totalBytes+=object.size;
    if(totalBytes>MAX_JOB_OUTPUT_BYTES)throw new AccountError('This job exceeds the supported total output size.',502,'result_size');
    // The marker is the insert itself. Replays cannot count the same object twice.
    // If deletion raced the transfer, this inserts nothing; cleanup removes the orphan.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO account_asset_retention (asset_id,expires_at) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM account_assets WHERE id=?) AND EXISTS (SELECT 1 FROM account_jobs WHERE id=? AND deleted=0 AND state NOT IN ('failed','cancelled')) AND NOT EXISTS (${AVAILABLE_CAPACITY})`).bind(id,Date.now()+OVERFLOW_TTL_MS,id,job.id,job.id,object.size),
      env.DB.prepare(`UPDATE account_storage SET used_bytes = used_bytes + ? WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM account_assets WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM account_asset_retention WHERE asset_id=?) AND EXISTS (SELECT 1 FROM account_jobs WHERE id = ? AND deleted = 0 AND state NOT IN ('failed','cancelled'))`).bind(object.size,job.user_id,id,id,job.id),
      env.DB.prepare(`INSERT OR IGNORE INTO account_assets (id,user_id,job_id,object_key,kind,mime_type,bytes,metadata_json,created_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM account_jobs WHERE id = ? AND deleted = 0 AND state NOT IN ('failed','cancelled'))`)
        .bind(id,job.user_id,job.id,key,request.mediaType,storedMime||object.httpMetadata?.contentType||'application/octet-stream',object.size,job.request_json,Date.now(),job.id),
    ]);
    // A concurrent deletion can win after this transfer started. Queue the
    // newly finished object too, even if an earlier delete already drained.
    const visible=await env.DB.prepare('SELECT id FROM account_assets WHERE id=? AND deleted=0').bind(id).first();
    if(!visible){
      await env.DB.prepare('INSERT OR IGNORE INTO account_object_deletions (object_key,created_at) VALUES (?,?)').bind(key,Date.now()).run();
    }
  }
  const temporary=await env.DB.prepare('SELECT 1 FROM account_asset_retention r JOIN account_assets a ON a.id=r.asset_id WHERE a.job_id=? AND a.deleted=0 LIMIT 1').bind(job.id).first();
  if(temporary)throw new AccountError('Free space and resume saving. These results are temporarily downloadable for 24 hours.',409,'storage_full');
}
export async function deleteAsset(env:Env,id:string,owner:string) {
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO account_object_deletions (object_key,created_at) SELECT object_key,? FROM account_assets WHERE id=? AND user_id=?').bind(Date.now(),id,owner),
    env.DB.prepare('UPDATE account_storage SET used_bytes = used_bytes - COALESCE((SELECT bytes FROM account_assets WHERE id = ? AND user_id = ? AND deleted = 0 AND NOT EXISTS (SELECT 1 FROM account_asset_retention WHERE asset_id=?)),0) WHERE user_id = ?').bind(id,owner,id,owner),
    env.DB.prepare('UPDATE account_assets SET deleted = 1 WHERE id = ? AND user_id = ?').bind(id,owner),
  ]);
  const row=await env.DB.prepare('SELECT object_key FROM account_assets WHERE id = ? AND user_id = ? AND deleted = 1').bind(id,owner).first<{object_key:string}>();
  if(row)await deleteQueuedObject(env,row.object_key);
}
