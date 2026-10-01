/** Local-only recovery fixtures. No provider requests or production records.
 * ACCOUNT_DEMO_ORIGIN=http://localhost:3167 node scripts/seed-result-recovery.mjs
 * Rerunning resets these demo rows while preserving their retry counts.
 * Pass --fresh for a new retry example after the three-attempt cap is reached. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const origin=process.env.ACCOUNT_DEMO_ORIGIN||'http://localhost:3167';
const target=new URL(origin);
if(target.protocol!=='http:'||!['localhost','127.0.0.1'].includes(target.hostname))throw new Error('Only localhost fixtures are supported.');
const login=await fetch(`${origin}/api/account/local-sign-in`,{method:'POST',headers:{Origin:origin}});
if(!login.ok)throw new Error('Local sign-in failed.');
const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
const session=await (await fetch(`${origin}/api/account/session`,{headers:{Cookie:cookie}})).json();
const owner=session.account.id;
const cli=(args)=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{cwd:'cloud',env:{...process.env,WRANGLER_SEND_METRICS:'false'},encoding:'utf8'});
const sql=(command)=>cli(['d1','execute','DB','--local','--json','--command',command]);
const q=value=>`'${String(value).replaceAll("'","''")}'`;
sql(`INSERT OR IGNORE INTO account_storage (user_id) VALUES (${q(owner)})`);
const fresh=process.argv.includes('--fresh')?`-${Date.now()}`:'';
const dir=mkdtempSync(join(tmpdir(),'result-recovery-'));
try {
  const file=join(dir,'fixture.png');
  writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  const fixtures=[
    [`seed-recovery-approved${fresh}`,'Demo: retry saving an existing result','https://atlas-media.oss-us-west-1.aliyuncs.com/local-fixture.png'],
    ['seed-recovery-manual','Demo: retrieve a provider download link','https://downloads.example.com/local-demo-result.png'],
  ];
  for(const [id,prompt,url] of fixtures){
    const request={provider:'atlas',modelId:'gpt-image-1',mediaType:'image',inputMode:'text',prompt,values:{},referenceIds:[]};
    // The approved fixture uses already-staged local bytes, so clicking Retry
    // saving tests Workflow + D1 + R2 without ever fetching the illustrative URL.
    if(id.startsWith('seed-recovery-approved'))cli(['r2','object','put',`scene-assembly-assets/accounts/${owner}/jobs/${id}/0`,'--local','--file',file,'--content-type','image/png']);
    sql(`UPDATE account_storage SET used_bytes=MAX(0,used_bytes-COALESCE((SELECT SUM(bytes) FROM account_assets WHERE job_id=${q(id)} AND deleted=0),0)) WHERE user_id=${q(owner)};
      DELETE FROM account_asset_retention WHERE asset_id IN (SELECT id FROM account_assets WHERE job_id=${q(id)});
      DELETE FROM account_assets WHERE job_id=${q(id)};
      INSERT OR REPLACE INTO account_jobs (id,user_id,request_token,request_digest,provider,request_json,state,error_code,failure_reason,provider_task,result_json,reservation_bytes,dispatched,workflow_attempt,created_at,updated_at)
      VALUES (${q(id)},${q(owner)},${q(id)},'seed','atlas',${q(JSON.stringify(request))},'needs_attention','save_failed','result_location',${q(JSON.stringify({id:`demo-provider-${id}`}))},${q(JSON.stringify({sources:[{url}]}))},0,1,COALESCE((SELECT workflow_attempt FROM account_jobs WHERE id=${q(id)}),0),${Date.now()-149000},${Date.now()});`);
  }
} finally {rmSync(dir,{recursive:true,force:true});}
console.log(`Recovery fixtures ready at ${origin}/account#jobs. The manual link is illustrative; the retry fixture saves local bytes without contacting a provider.`);
