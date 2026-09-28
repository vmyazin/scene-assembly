import { getAsset, isSupportedOutputMime } from './assets';
import { byteRange } from './range';
import { hash, isLocal, json, randomToken, type Env } from './security';

export function mediaOrigin(env:Env) {
  if(!env.PUBLIC_WORKER_ORIGIN)throw new Error('Public media origin is not configured');
  const url=new URL(env.PUBLIC_WORKER_ORIGIN);
  if(url.origin!==env.PUBLIC_WORKER_ORIGIN || !(url.protocol==='https:' || isLocal(env)&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Invalid media origin');
  return url.origin;
}
export async function mediaAccess(env:Env,owner:string,resourceId:string,purpose:'upload'|'agent-upload'|'input'|'download',jobId:string|null=null) {
  const origin=mediaOrigin(env), token=randomToken();
  // An agent's PUT link: long enough to find the file, short for a bearer URL.
  const expiresAt=Date.now()+(purpose==='input'?86_400_000:purpose==='agent-upload'?900_000:600_000);
  await env.DB.prepare('INSERT INTO account_media_tokens (token_hash,user_id,resource_id,purpose,job_id,expires_at) VALUES (?,?,?,?,?,?)').bind(await hash(token),owner,resourceId,purpose,jobId,expiresAt).run();
  return {url:`${origin}/media/${purpose}/${token}`,expiresAt};
}
export interface MediaToken { user_id:string;resource_id:string;purpose:string;job_id:string|null;expires_at:number }
export async function mediaToken(env:Env,path:string) {
  const match=path.match(/^\/media\/(upload|agent-upload|input|download)\/([A-Za-z0-9_-]{43})$/);
  if(!match)return null;
  return env.DB.prepare('SELECT * FROM account_media_tokens WHERE token_hash=? AND purpose=? AND expires_at>?').bind(await hash(match[2]),match[1],Date.now()).first<MediaToken>();
}
export function mediaCors(response:Response,env:Env) {
  response.headers.set('Access-Control-Allow-Origin',env.APP_ORIGIN);
  response.headers.set('Access-Control-Allow-Methods','GET, HEAD, PUT, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers','Content-Type, Range');
  response.headers.set('Access-Control-Expose-Headers','Content-Length, Content-Range');
  response.headers.set('Referrer-Policy','no-referrer');
  response.headers.set('Vary','Origin');
  return response;
}
export async function serveObject(request:Request,env:Env,key:string,mime:string,bytes:number) {
  const range=byteRange(request.headers.get('range'),bytes);
  if(range==='invalid')return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes}`,'Cache-Control':'no-store'}});
  const object=await env.ASSETS?.get(key,range?{range}:undefined);
  if(!object)return json({error:'File is temporarily unavailable.'},503);
  const objectMime=object.httpMetadata?.contentType;
  const responseMime=mime==='application/octet-stream'&&objectMime&&isSupportedOutputMime(objectMime)?objectMime:mime;
  const headers=new Headers({'Cache-Control':'private, no-store','Content-Type':responseMime,'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Length':String(range?.length??object.size),'Referrer-Policy':'no-referrer'});
  if(range)headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${object.size}`);
  if(request.method==='HEAD'){await object.body.cancel();return new Response(null,{status:range?206:200,headers});}
  return new Response(object.body,{status:range?206:200,headers});
}
export async function readMedia(request:Request,env:Env,token:MediaToken) {
  if(token.purpose==='download'){
    const asset=await getAsset(env,token.resource_id,token.user_id);
    if(!asset)return json({error:'File not found.'},404);
    return serveObject(request,env,asset.object_key,asset.mime_type,asset.bytes);
  }
  if(token.purpose==='input'&&token.job_id){
    const upload=await env.DB.prepare(`SELECT u.object_key,u.mime_type,u.expected_bytes FROM account_uploads u JOIN account_job_inputs i ON i.upload_id=u.id JOIN account_jobs j ON j.id=i.job_id
      WHERE u.id=? AND u.user_id=? AND u.state='ready' AND j.id=? AND j.deleted=0 AND j.state NOT IN ('saved','failed','cancelled')`).bind(token.resource_id,token.user_id,token.job_id).first<{object_key:string;mime_type:string;expected_bytes:number}>();
    if(upload)return serveObject(request,env,upload.object_key,upload.mime_type,upload.expected_bytes);
  }
  return json({error:'File not found.'},404);
}
