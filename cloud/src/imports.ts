import type { CloudJobRequest } from '../../lib/account/contracts';
import { referenceIdCap } from './providers';
import { writeOutput } from './assets';
import { deleteQueuedObject } from './cleanup';
import { AccountError } from './jobs';
import { mediaCors, mediaOrigin } from './media';
import { currentAccount } from './sessions';
import { hash, json, randomToken, type Env } from './security';

export const MAX_IMPORT_BYTES = 1_000_000_000;
export const MAX_ACTIVE_IMPORTS = 3;
export const MAX_GLOBAL_ACTIVE_IMPORTS = 100;
const IMPORT_TTL_MS = 86_400_000;
const UPLOAD_TOKEN_TTL_MS = 600_000;
const SUPERSEDED_GRACE_MS = 900_000;
const CLEANUP_RESCAN_MS = 600_000;
const CLEANUP_RESCAN_WINDOW_MS = 3_600_000;
export const MAX_IMPORT_ATTEMPTS = 5;
export const MAX_ACCOUNT_LIVE_IMPORT_ATTEMPTS = 12;
export const MAX_GLOBAL_LIVE_IMPORT_ATTEMPTS = 200;
const providers = new Set(['gemini','fal','kie','runware','atlas','comet','piapi','cloudflare','pollinations','local-test']);

type ImportState = 'pending'|'uploading'|'completed'|'cancelled'|'expired';
interface ImportRow {
  id:string; user_id:string; client_id:string; request_digest:string; object_key:string;
  kind:'image'|'video'; mime_type:string; expected_bytes:number; metadata_json:string;
  state:ImportState; reservation_accounted:number; upload_attempt:number; upload_token_hash:string|null;
  upload_token_expires_at:number|null; created_at:number; updated_at:number; expires_at:number;
}

function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function validateMetadata(value:unknown,kind:'image'|'video'):CloudJobRequest {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountError('Invalid import metadata.',400,'invalid_import');
  const item=value as Partial<CloudJobRequest>;
  if(!providers.has(String(item.provider))||typeof item.modelId!=='string'||item.modelId.length>256||item.mediaType!==kind||!['text','image','frames','reference','edit'].includes(String(item.inputMode))||typeof item.prompt!=='string'||item.prompt.length>20_000||!item.values||typeof item.values!=='object'||Array.isArray(item.values)||Object.keys(item.values).length>64||Object.values(item.values).some(entry=>!['string','boolean','number'].includes(typeof entry)||typeof entry==='number'&&!Number.isFinite(entry)||typeof entry==='string'&&entry.length>2048)||!Array.isArray(item.referenceIds)||item.referenceIds.length>referenceIdCap(item)||item.referenceIds.some(id=>typeof id!=='string'||id.length>128))throw new AccountError('Invalid import metadata.',400,'invalid_import');
  return item as CloudJobRequest;
}

function validateIntent(value:unknown) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new AccountError('Invalid import request.',400,'invalid_import');
  const body=value as {clientImportId?:unknown;bytes?:unknown;mimeType?:unknown;metadata?:unknown};
  if(typeof body.clientImportId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(body.clientImportId)||!Number.isSafeInteger(body.bytes)||Number(body.bytes)<=0||Number(body.bytes)>MAX_IMPORT_BYTES||typeof body.mimeType!=='string'||! /^(image\/(png|jpeg|webp|avif)|video\/(mp4|webm))$/.test(body.mimeType))throw new AccountError('Use a stable import ID and a supported image or video up to 1 GB.',400,'invalid_import');
  const kind=body.mimeType.startsWith('image/')?'image':'video';
  return {clientImportId:body.clientImportId,bytes:Number(body.bytes),mimeType:body.mimeType,kind,metadata:validateMetadata(body.metadata,kind)} as const;
}

function view(row:ImportRow,url?:string,tokenExpiresAt?:number) {
  return {id:row.id,state:row.state,assetId:row.state==='completed'?row.id:null,expiresAt:row.expires_at,...(url?{url,uploadExpiresAt:tokenExpiresAt}:{})};
}

async function renewUpload(env:Env,row:ImportRow) {
  mediaOrigin(env);
  const token=randomToken(),tokenExpiresAt=Math.min(Date.now()+UPLOAD_TOKEN_TTL_MS,row.expires_at);
  const updated=await env.DB.prepare("UPDATE account_imports SET upload_token_hash=?,upload_token_expires_at=?,updated_at=? WHERE id=? AND user_id=? AND state IN ('pending','uploading') AND expires_at>?")
    .bind(await hash(token),tokenExpiresAt,Date.now(),row.id,row.user_id,Date.now()).run();
  if(!updated.meta.changes)return view((await getImport(env,row.id,row.user_id))||row);
  return view({...row,upload_token_expires_at:tokenExpiresAt},`${mediaOrigin(env)}/import-media/${token}`,tokenExpiresAt);
}

async function getImport(env:Env,id:string,owner:string) {
  return env.DB.prepare('SELECT * FROM account_imports WHERE id=? AND user_id=?').bind(id,owner).first<ImportRow>();
}

interface AttemptRow {import_id:string;attempt:number;object_key:string;state:'active'|'superseded'|'committed'|'cleaned';cleanup_after:number|null;cleanup_until:number|null}

function attemptCapacityError(globalAttempts:number) {
  const globallyFull=globalAttempts>=MAX_GLOBAL_LIVE_IMPORT_ATTEMPTS;
  return new AccountError('Too many interrupted import transfers are awaiting cleanup. Try again shortly.',globallyFull?503:409,globallyFull?'service_capacity':'import_attempt_capacity');
}

async function queueAttemptObject(env:Env,row:AttemptRow) {
  const now=Date.now(),finished=(row.cleanup_until??now)<=now;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO account_object_deletions (object_key,created_at) VALUES (?,?)').bind(row.object_key,now),
    env.DB.prepare("UPDATE account_import_attempts SET state=?,cleanup_after=? WHERE import_id=? AND attempt=? AND state='superseded'").bind(finished?'cleaned':'superseded',finished?null:now+CLEANUP_RESCAN_MS,row.import_id,row.attempt),
  ]);
  await deleteQueuedObject(env,row.object_key);
}

async function retireAttempts(env:Env,row:ImportRow,delay=0) {
  const now=Date.now();
  await env.DB.prepare("UPDATE account_import_attempts SET state='superseded',cleanup_after=MIN(COALESCE(cleanup_after,?),?),cleanup_until=MAX(COALESCE(cleanup_until,?),?) WHERE import_id=? AND state!='committed'")
    .bind(now+delay,now+delay,now+CLEANUP_RESCAN_WINDOW_MS,now+CLEANUP_RESCAN_WINDOW_MS,row.id).run();
}

async function expireImport(env:Env,row:ImportRow,state:'cancelled'|'expired') {
  const now=Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE account_storage SET reserved_bytes=reserved_bytes-? WHERE user_id=? AND EXISTS
      (SELECT 1 FROM account_imports WHERE id=? AND user_id=? AND reservation_accounted=1 AND state IN ('pending','uploading'))`).bind(row.expected_bytes,row.user_id,row.id,row.user_id),
    env.DB.prepare(`UPDATE account_imports SET state=?,reservation_accounted=0,upload_token_hash=NULL,upload_token_expires_at=NULL,updated_at=?
      WHERE id=? AND user_id=? AND state IN ('pending','uploading')`).bind(state,now,row.id,row.user_id),
  ]);
  const current=await getImport(env,row.id,row.user_id);
  if(current?.state===state)await retireAttempts(env,current);
  return current;
}

async function resumeImport(env:Env,row:ImportRow) {
  if(row.state==='pending')return renewUpload(env,row);
  if(row.state!=='uploading')return view(row);
  if(await env.ASSETS?.head(row.object_key))return renewUpload(env,row);
  if(row.upload_attempt>=MAX_IMPORT_ATTEMPTS){
    await expireImport(env,row,'cancelled');
    throw new AccountError('This import exceeded the interrupted-upload retry limit. Start a new explicit import.',409,'import_attempt_limit');
  }
  const now=Date.now(),next=row.upload_attempt+1,nextKey=`accounts/${row.user_id}/imports/${row.id}/attempt-${next}`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE account_imports SET state='pending',object_key=?,upload_attempt=?,upload_token_hash=NULL,upload_token_expires_at=NULL,updated_at=?
      WHERE id=? AND user_id=? AND state='uploading' AND upload_attempt=?
      AND (SELECT COUNT(*) FROM account_import_attempts a JOIN account_imports i ON i.id=a.import_id WHERE i.user_id=? AND a.state IN ('active','superseded'))<${MAX_ACCOUNT_LIVE_IMPORT_ATTEMPTS}
      AND (SELECT COUNT(*) FROM account_import_attempts WHERE state IN ('active','superseded'))<${MAX_GLOBAL_LIVE_IMPORT_ATTEMPTS}`).bind(nextKey,next,now,row.id,row.user_id,row.upload_attempt,row.user_id),
    env.DB.prepare("UPDATE account_import_attempts SET state='superseded',cleanup_after=?,cleanup_until=? WHERE import_id=? AND attempt=? AND state='active' AND EXISTS (SELECT 1 FROM account_imports WHERE id=? AND upload_attempt=?)").bind(now+SUPERSEDED_GRACE_MS,row.expires_at+CLEANUP_RESCAN_WINDOW_MS,row.id,row.upload_attempt,row.id,next),
    env.DB.prepare(`INSERT OR IGNORE INTO account_import_attempts (import_id,attempt,object_key)
      SELECT id,upload_attempt,object_key FROM account_imports WHERE id=? AND user_id=? AND upload_attempt=? AND object_key=?`).bind(row.id,row.user_id,next,nextKey),
  ]);
  const current=await getImport(env,row.id,row.user_id);
  if(current?.upload_attempt===row.upload_attempt){
    const global=await env.DB.prepare("SELECT COUNT(*) AS count FROM account_import_attempts WHERE state IN ('active','superseded')").first<{count:number}>();
    throw attemptCapacityError(global?.count||0);
  }
  return current&&(current.state==='pending'||current.state==='uploading')?renewUpload(env,current):view(current||row);
}

export async function beginImport(env:Env,owner:string,value:unknown) {
  const intent=validateIntent(value);
  const digest=await hash(canonical({bytes:intent.bytes,mimeType:intent.mimeType,metadata:intent.metadata}));
  let existing=await env.DB.prepare('SELECT * FROM account_imports WHERE user_id=? AND client_id=?').bind(owner,intent.clientImportId).first<ImportRow>();
  if(existing){
    if(existing.request_digest!==digest)throw new AccountError('Import ID already used for different content.',409,'import_conflict');
    if(existing.expires_at<=Date.now()&&(existing.state==='pending'||existing.state==='uploading'))existing=await expireImport(env,existing,'expired')||existing;
    return existing.state==='pending'||existing.state==='uploading'?resumeImport(env,existing):view(existing);
  }
  const id=crypto.randomUUID(),now=Date.now(),objectKey=`accounts/${owner}/imports/${id}`;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO account_storage (user_id) VALUES (?)').bind(owner),
    env.DB.prepare(`INSERT OR IGNORE INTO account_imports (id,user_id,client_id,request_digest,object_key,kind,mime_type,expected_bytes,metadata_json,created_at,updated_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? FROM account_storage WHERE user_id=? AND used_bytes+reserved_bytes+?<=limit_bytes
      AND (SELECT COUNT(*) FROM account_imports WHERE user_id=? AND reservation_accounted=1)<${MAX_ACTIVE_IMPORTS}
      AND (SELECT COUNT(*) FROM account_imports WHERE reservation_accounted=1)<${MAX_GLOBAL_ACTIVE_IMPORTS}
      AND (SELECT COUNT(*) FROM account_import_attempts a JOIN account_imports i ON i.id=a.import_id WHERE i.user_id=? AND a.state IN ('active','superseded'))<${MAX_ACCOUNT_LIVE_IMPORT_ATTEMPTS}
      AND (SELECT COUNT(*) FROM account_import_attempts WHERE state IN ('active','superseded'))<${MAX_GLOBAL_LIVE_IMPORT_ATTEMPTS}`)
      .bind(id,owner,intent.clientImportId,digest,objectKey,intent.kind,intent.mimeType,intent.bytes,JSON.stringify(intent.metadata),now,now,now+IMPORT_TTL_MS,owner,intent.bytes,owner,owner),
    env.DB.prepare('UPDATE account_storage SET reserved_bytes=reserved_bytes+? WHERE user_id=? AND EXISTS (SELECT 1 FROM account_imports WHERE id=? AND reservation_accounted=0)').bind(intent.bytes,owner,id),
    env.DB.prepare('UPDATE account_imports SET reservation_accounted=1 WHERE id=?').bind(id),
    env.DB.prepare('INSERT OR IGNORE INTO account_import_attempts (import_id,attempt,object_key) SELECT id,upload_attempt,object_key FROM account_imports WHERE id=?').bind(id),
  ]);
  existing=await env.DB.prepare('SELECT * FROM account_imports WHERE user_id=? AND client_id=?').bind(owner,intent.clientImportId).first<ImportRow>();
  if(!existing){
    const capacity=await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM account_imports WHERE reservation_accounted=1) AS global_imports,
      (SELECT COUNT(*) FROM account_import_attempts WHERE state IN ('active','superseded')) AS global_attempts,
      (SELECT COUNT(*) FROM account_import_attempts a JOIN account_imports i ON i.id=a.import_id WHERE i.user_id=? AND a.state IN ('active','superseded')) AS account_attempts`)
      .bind(owner).first<{global_imports:number;global_attempts:number;account_attempts:number}>();
    if((capacity?.global_imports||0)>=MAX_GLOBAL_ACTIVE_IMPORTS)throw new AccountError('Import storage is busy. Try again shortly.',503,'service_capacity');
    if((capacity?.global_attempts||0)>=MAX_GLOBAL_LIVE_IMPORT_ATTEMPTS)throw attemptCapacityError(capacity?.global_attempts||0);
    if((capacity?.account_attempts||0)>=MAX_ACCOUNT_LIVE_IMPORT_ATTEMPTS)throw attemptCapacityError(capacity?.global_attempts||0);
    throw new AccountError('Your account needs more available storage or fewer active imports.',409,'capacity');
  }
  if(existing.request_digest!==digest)throw new AccountError('Import ID already used for different content.',409,'import_conflict');
  return renewUpload(env,existing);
}

export async function publicImportMedia(request:Request,env:Env):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/import-media/'))return null;
  const respond=(response:Response)=>mediaCors(response,env);
  if(request.headers.get('origin')!==env.APP_ORIGIN)return respond(json({error:'Request origin is not allowed.',code:'origin'},403));
  if(request.method==='OPTIONS')return respond(new Response(null,{status:204}));
  if(request.method!=='PUT')return respond(json({error:'Method not allowed.'},405));
  const match=path.match(/^\/import-media\/([A-Za-z0-9_-]{43})$/);
  if(!match)return respond(json({error:'Import upload expired or is invalid.',code:'import_token'},404));
  const row=await env.DB.prepare("SELECT * FROM account_imports WHERE upload_token_hash=? AND upload_token_expires_at>? AND expires_at>? AND state IN ('pending','uploading')")
    .bind(await hash(match[1]),Date.now(),Date.now()).first<ImportRow>();
  if(!row)return respond(json({error:'Import upload expired or is invalid.',code:'import_token'},404));
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!==row.mime_type||!request.body)return respond(json({error:'Upload type does not match.',code:'upload_type'},400));
  const declared=request.headers.get('content-length');
  if(declared!==null&&Number(declared)!==row.expected_bytes)return respond(json({error:'Uploaded size does not match.',code:'upload_size'},400));
  const claim=await env.DB.prepare("UPDATE account_imports SET state='uploading',updated_at=? WHERE id=? AND state='pending' AND reservation_accounted=1 AND upload_attempt=? AND upload_token_hash=?")
    .bind(Date.now(),row.id,row.upload_attempt,await hash(match[1])).run();
  let object=await env.ASSETS?.head(row.object_key);
  if(!claim.meta.changes&&!object)return respond(json({error:'Import upload is already in progress.',code:'import_in_progress'},409));
  let completeObject=false;
  try {
    object=object||await writeOutput(env,row.object_key,request.body,row.mime_type,row.expected_bytes);
    if(object.size!==row.expected_bytes)throw new AccountError('Uploaded size does not match.',400,'upload_size');
    completeObject=true;
    const now=Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO account_assets (id,user_id,job_id,object_key,kind,mime_type,bytes,metadata_json,created_at)
        SELECT id,user_id,NULL,object_key,kind,mime_type,expected_bytes,metadata_json,? FROM account_imports
        WHERE id=? AND state='uploading' AND reservation_accounted=1 AND expected_bytes=? AND upload_attempt=? AND object_key=? AND EXISTS (SELECT 1 FROM account_users WHERE id=user_id)`).bind(now,row.id,object.size,row.upload_attempt,row.object_key),
      env.DB.prepare(`UPDATE account_storage SET used_bytes=used_bytes+?,reserved_bytes=reserved_bytes-? WHERE user_id=? AND EXISTS
        (SELECT 1 FROM account_imports WHERE id=? AND state='uploading' AND reservation_accounted=1 AND upload_attempt=? AND object_key=?) AND EXISTS (SELECT 1 FROM account_assets WHERE id=?)`).bind(row.expected_bytes,row.expected_bytes,row.user_id,row.id,row.upload_attempt,row.object_key,row.id),
      env.DB.prepare(`UPDATE account_imports SET state='completed',reservation_accounted=0,upload_token_hash=NULL,upload_token_expires_at=NULL,updated_at=?
        WHERE id=? AND state='uploading' AND reservation_accounted=1 AND upload_attempt=? AND object_key=? AND EXISTS (SELECT 1 FROM account_assets WHERE id=?)`).bind(now,row.id,row.upload_attempt,row.object_key,row.id),
      env.DB.prepare("UPDATE account_import_attempts SET state='committed',cleanup_after=NULL,cleanup_until=NULL WHERE import_id=? AND attempt=? AND EXISTS (SELECT 1 FROM account_imports WHERE id=? AND state='completed' AND upload_attempt=?)").bind(row.id,row.upload_attempt,row.id,row.upload_attempt),
    ]);
    const completed=await getImport(env,row.id,row.user_id);
    if(completed?.state==='completed')return respond(json(view(completed)));
    const stale=await env.DB.prepare('SELECT * FROM account_import_attempts WHERE import_id=? AND attempt=?').bind(row.id,row.upload_attempt).first<AttemptRow>();
    if(stale){
      await env.DB.prepare("UPDATE account_import_attempts SET state='superseded',cleanup_after=?,cleanup_until=MAX(COALESCE(cleanup_until,?),?) WHERE import_id=? AND attempt=? AND state!='committed'")
        .bind(Date.now(),Date.now()+CLEANUP_RESCAN_WINDOW_MS,Date.now()+CLEANUP_RESCAN_WINDOW_MS,row.id,row.upload_attempt).run();
      const due=await env.DB.prepare('SELECT * FROM account_import_attempts WHERE import_id=? AND attempt=?').bind(row.id,row.upload_attempt).first<AttemptRow>();
      if(due?.state==='superseded')await queueAttemptObject(env,due);
    }else{
      await env.DB.prepare('INSERT OR IGNORE INTO account_object_deletions (object_key,created_at) VALUES (?,?)').bind(row.object_key,Date.now()).run();
      await deleteQueuedObject(env,row.object_key);
    }
    return respond(json({error:'Import was cancelled while uploading.',code:'import_cancelled'},409));
  } catch(error) {
    // Once R2 completed, retain the object and uploading marker. Repeating the
    // same begin request issues a fresh capability and finalizes without reupload.
    if(!completeObject){
      await env.ASSETS?.delete(row.object_key).catch(()=>{});
      await env.DB.prepare("UPDATE account_imports SET state='pending',updated_at=? WHERE id=? AND state='uploading' AND reservation_accounted=1 AND upload_attempt=? AND object_key=?")
        .bind(Date.now(),row.id,row.upload_attempt,row.object_key).run();
    }
    if(error instanceof AccountError)return respond(json({error:error.message,code:error.code},error.status));
    return respond(json({error:'Upload was interrupted. Begin the same import again to resume.',code:'upload_interrupted'},400));
  }
}

export async function importRoutes(request:Request,env:Env):Promise<Response|null> {
  const path=new URL(request.url).pathname;
  if(!/^\/api\/account\/imports(\/|$)/.test(path))return null;
  const account=await currentAccount(request,env);
  if(!account)return json({error:'Sign in to import files.'},401);
  if(path==='/api/account/imports'){
    if(request.method==='GET'){
      const rows=await env.DB.prepare('SELECT * FROM account_imports WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(account.id).all<ImportRow>();
      return json({imports:rows.results.map(row=>view(row))});
    }
    if(request.method==='POST'){
      const text=await request.text();if(text.length>32_768)return json({error:'Request is too large.'},413);
      try{return json(await beginImport(env,account.id,JSON.parse(text||'{}')),201);}
      catch(error){if(error instanceof AccountError)return json({error:error.message,code:error.code},error.status);if(error instanceof SyntaxError)return json({error:'Invalid request.'},400);throw error;}
    }
  }
  const match=path.match(/^\/api\/account\/imports\/([a-f0-9-]{36})$/);
  if(match){
    const row=await getImport(env,match[1],account.id);
    if(!row)return json({error:'Import not found.',code:'import_not_found'},404);
    if(request.method==='GET')return json(view(row));
    if(request.method==='DELETE'){
      if(row.state==='completed')return json({error:'The imported asset is already in the library.',code:'import_completed'},409);
      if(row.state==='cancelled'||row.state==='expired')return json(view(row));
      return json(view((await expireImport(env,row,'cancelled'))||row));
    }
  }
  return json({error:'Not found.'},404);
}

export async function cleanupImports(env:Env) {
  const rows=await env.DB.prepare("SELECT * FROM account_imports WHERE state IN ('pending','uploading') AND expires_at<=? ORDER BY expires_at LIMIT 100").bind(Date.now()).all<ImportRow>();
  for(const row of rows.results)await expireImport(env,row,'expired');
  const cleanup=await env.DB.prepare("SELECT * FROM account_import_attempts WHERE state='superseded' AND cleanup_after<=? ORDER BY cleanup_after LIMIT 100").bind(Date.now()).all<AttemptRow>();
  for(const row of cleanup.results)await queueAttemptObject(env,row);
}
