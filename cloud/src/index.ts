import { reconcileSpend, spendRoutes } from './spend';
import { enabledProviders } from './providers';
import { listConnections } from './vault';
import { publicMedia, uploadRoutes, cleanupUploads } from './uploads';
import { cleanupRetainedAssets } from './retention';
import { cleanupObjects, cleanupTerminalJobObjects } from './cleanup';
import { lifecycleRoutes } from './lifecycle';
import { jobRoutes } from './job-routes';
import { dispatchJob, type JobRow } from './jobs';
import { connectionRoutes } from './connections';
import { providerBillingRoutes } from './provider-billing';
import { bootstrapLocalSchema } from './schema';
import { cookie, cookieName, hash, isLocal, json, randomToken, readCookie, returnPath, validOrigin, type Env } from './security';
import { googleAuthorization, googleEnabled, googleIdentity } from './google';
import { createSession, currentAccount, revokeSession } from './sessions';
import { cleanupImports, importRoutes, publicImportMedia } from './imports';
import { applyIngress, cleanupExpiredIngress } from './ingress';

interface OAuthAttempt { verifier: string; nonce: string; return_to: string }
const bootstrapped = new WeakMap<object, Promise<void>>();
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    if (!validOrigin(env)) return json({ error: 'Account service is not configured.' }, 503);
    // The local shortcut must stay absent even before production migrations exist.
    if(new URL(request.url).pathname==='/api/account/local-sign-in'&&!isLocal(env))return json({error:'Not found.'},404);
    if (isLocal(env)) {
      // Share the upgrade across simultaneous first requests; retry after a failure.
      let ready = bootstrapped.get(env.DB);
      if (!ready) {
        ready = bootstrapLocalSchema(env.DB).catch(error => { bootstrapped.delete(env.DB); throw error; });
        bootstrapped.set(env.DB, ready);
      }
      await ready;
    }
    const ingress = await applyIngress(request, env);
    if (ingress.response) return ingress.response;
    request = ingress.request;
    const mediaResponse = await publicMedia(request,env);
    if(mediaResponse)return mediaResponse;
    const importMediaResponse = await publicImportMedia(request,env);
    if(importMediaResponse)return importMediaResponse;
    const url = new URL(request.url);
    const path = url.pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== env.APP_ORIGIN) return json({ error: 'Request origin is not allowed.' }, 403);
    const expectedOwner=request.headers.get('x-account-id');
    if(expectedOwner&&(await currentAccount(request,env))?.id!==expectedOwner)return json({error:'Your account changed. Refresh before continuing.'},409);
    const uploadResponse = await uploadRoutes(request,env);
    if(uploadResponse)return uploadResponse;
    const importResponse = await importRoutes(request,env);
    if(importResponse)return importResponse;
    const lifecycleResponse=await lifecycleRoutes(request,env);
    if(lifecycleResponse)return lifecycleResponse;
    const jobResponse = await jobRoutes(request, env);
    if (jobResponse) return jobResponse;
    const spendResponse=await spendRoutes(request,env);
    if(spendResponse)return spendResponse;
    const billingResponse=await providerBillingRoutes(request,env);
    if(billingResponse)return billingResponse;
    const connectionResponse = await connectionRoutes(request, env);
    if (connectionResponse) return connectionResponse;
    if (path === '/health' && request.method === 'GET') return json({ ok: true });
    if (path === '/api/account/session' && request.method === 'GET') {
      const account=await currentAccount(request,env);
      return json({account,googleEnabled:googleEnabled(env),localSignIn:isLocal(env)&&Boolean(env.DEV_ACCOUNT_EMAIL),fakeGeneration:isLocal(env)&&env.DEV_FAKE_GENERATION==='1',providers:enabledProviders(env),connections:account?await listConnections(env,account.id):[]});
    }
    if (path === '/api/account/sign-out' && request.method === 'POST') {
      await revokeSession(request, env);
      return json({ ok: true }, 200, [cookie(env, 'session', '', 0), cookie(env, 'oauth', '', 0)]);
    }
    if (path === '/api/account/local-sign-in' && request.method === 'POST') {
      if (!isLocal(env) || !env.DEV_ACCOUNT_EMAIL) return json({ error: 'Not found.' }, 404);
      await revokeSession(request, env);
      const session = await createSession(env, { subject: `local:${env.DEV_ACCOUNT_EMAIL}`, email: env.DEV_ACCOUNT_EMAIL, name: 'Local creator' });
      return json({ ok: true }, 200, [session]);
    }
    if (path === '/api/account/sign-in/google' && request.method === 'POST') {
      if (!googleEnabled(env)) return json({ error: 'Google sign-in is not configured yet. You can continue as a guest.' }, 503);
      const text = await request.text();
      if (text.length > 2048) return json({ error: 'Request is too large.' }, 413);
      let body: { returnTo?: unknown };
      try { body = JSON.parse(text || '{}'); } catch { return json({ error: 'Invalid request.' }, 400); }
      const state = randomToken(), binding = randomToken(), verifier = randomToken(), nonce = randomToken();
      await env.DB.prepare('INSERT INTO account_oauth (state_hash, binding_hash, verifier, nonce, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(await hash(state), await hash(binding), verifier, nonce, returnPath(body?.returnTo), Date.now() + 600_000).run();
      return json({ url: await googleAuthorization(env, state, verifier, nonce) }, 200, [cookie(env, 'oauth', binding, 600)]);
    }
    if (path === '/api/account/callback/google' && request.method === 'GET') {
      const failure = () => redirect(`${env.APP_ORIGIN}/sign-in?account=signin-failed`, [cookie(env, 'oauth', '', 0)]);
      if (!googleEnabled(env)) return failure();
      const state = url.searchParams.get('state');
      const binding = readCookie(request, cookieName(env, 'oauth'));
      if (!state || state.length > 128 || !binding) return failure();
      // Consume atomically before the external exchange; a callback cannot be replayed.
      const attempt = await env.DB.prepare('DELETE FROM account_oauth WHERE state_hash = ? AND binding_hash = ? AND expires_at > ? RETURNING verifier, nonce, return_to')
        .bind(await hash(state), await hash(binding), Date.now()).first<OAuthAttempt>();
      if (!attempt) return failure();
      try {
        const identity = await googleIdentity(env, url, state, attempt.verifier, attempt.nonce);
        await revokeSession(request, env);
        const session = await createSession(env, identity);
        return redirect(`${env.APP_ORIGIN}${returnPath(attempt.return_to)}`, [session, cookie(env, 'oauth', '', 0)]);
      } catch { return failure(); }
    }
    return json({ error: 'Not found.' }, 404);
  } catch {
    // Never serialize OAuth errors: vendor payloads may contain credentials.
    return json({ error: 'Account service is temporarily unavailable. Guest generation is still available.' }, 503);
  }
}
function redirect(location: string, cookies: string[]) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  cookies.forEach(value => headers.append('Set-Cookie', value));
  return new Response(null, { status: 303, headers });
}
export async function runScheduledMaintenance(env:Env) {
  const tasks:Array<()=>Promise<unknown>>=[
    async()=>{
      const pending=await env.DB.prepare("SELECT * FROM account_jobs WHERE dispatched = 0 AND deleted = 0 AND state IN ('queued','running','saving') LIMIT 50").all<JobRow>();
      for(const job of pending.results)await dispatchJob(env,job).catch(()=>{});
    },
    ()=>reconcileSpend(env),
    ()=>cleanupUploads(env),
    ()=>cleanupRetainedAssets(env),
    ()=>cleanupImports(env),
    ()=>cleanupTerminalJobObjects(env),
    ()=>cleanupObjects(env),
    ()=>cleanupExpiredIngress(env),
    ()=>env.DB.prepare('DELETE FROM account_oauth WHERE expires_at <= ?').bind(Date.now()).run(),
    ()=>env.DB.prepare('DELETE FROM account_sessions WHERE expires_at <= ?').bind(Date.now()).run(),
  ];
  // Each journal is independently durable. A failed subsystem must not prevent
  // unrelated expirations and deletion queues from making progress this pass.
  for(const task of tasks)await task().catch(()=>{});
}

const worker = {
  fetch: handleRequest,
  async scheduled(_event: ScheduledController, env: Env) {
    await runScheduledMaintenance(env);
  },
};

export default worker;
