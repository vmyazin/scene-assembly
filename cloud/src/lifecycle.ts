import { currentAccount } from './sessions';
import { cookie, json, type Env } from './security';
import { revokeUserGrants } from './mcp/agents';

export async function deleteAccount(env:Env,owner:string) {
  const now=Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO account_deletions (user_id,created_at,next_check_at) SELECT id,?,? FROM account_users WHERE id=?').bind(now,now,owner),
    env.DB.prepare('DELETE FROM account_asset_retention WHERE asset_id IN (SELECT id FROM account_assets WHERE user_id=?)').bind(owner),
    // Cascades erase sessions, encrypted keys, jobs, inputs, assets and quota.
    // New Google sign-up receives a new account ID and a different R2 prefix.
    env.DB.prepare('DELETE FROM account_users WHERE id=?').bind(owner),
  ]);
  await revokeUserGrants(env, owner);
}

export async function lifecycleRoutes(request:Request,env:Env):Promise<Response|null> {
  if(new URL(request.url).pathname!=='/api/account/profile')return null;
  if(request.method!=='DELETE')return json({error:'Method not allowed.'},405);
  const account=await currentAccount(request,env);
  if(!account)return json({error:'Sign in to delete your account.'},401);
  await deleteAccount(env,account.id);
  return json({ok:true,filesQueuedForDeletion:true},200,[cookie(env,'session','',0),cookie(env,'oauth','',0)]);
}
