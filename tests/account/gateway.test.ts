// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountGateway } from '@/lib/account/gateway';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('account gateway', () => {
  it('forwards account deletion and every saved provider removal through the fixed backend',async()=>{
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN','https://accounts.test');
    const fetcher=vi.fn().mockResolvedValue(Response.json({ok:true}));vi.stubGlobal('fetch',fetcher);
    for(const path of ['profile','connections/pollinations']){
      expect((await accountGateway(new Request(`https://app.test/api/account/${path}`,{method:'DELETE',headers:{origin:'https://app.test','X-Account-Id':'owner'}}))).status).toBe(200);
    }
    expect(fetcher.mock.calls[0][1].headers.get('X-Account-Id')).toBe('owner');
    expect(fetcher.mock.calls[0][1].method).toBe('DELETE');
  });
  it('fails gracefully with no backend and does not require guest authentication', async () => {
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN', '');
    const response=await accountGateway(new Request('https://app.test/api/account/session'));
    expect(response.status).toBe(200);expect((await response.json()).account).toBeNull();
  });
  it('forwards only safe headers and preserves multiple cookies and redirects', async () => {
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN', 'https://accounts.test');
    const headers = new Headers({ location: 'https://app.test/sign-in' });
    headers.append('set-cookie', '__Host-sa_session=abc; Secure; HttpOnly; Path=/');
    headers.append('set-cookie', '__Host-sa_oauth=; Max-Age=0; Secure; Path=/');
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 303, headers }));
    vi.stubGlobal('fetch', fetcher);
    const response = await accountGateway(new Request('https://app.test/api/account/callback/google?code=x', { headers: { cookie: 'session=x', 'x-user-id': 'forged', authorization: 'Bearer forged', origin: 'https://app.test' } }));
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://accounts.test/api/account/callback/google?code=x');
    expect(options.headers.get('x-user-id')).toBeNull();
    expect(options.headers.get('authorization')).toBeNull();
    expect(options.headers.get('cookie')).toBe('session=x');
    expect(options.redirect).toBe('manual');
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects unlisted routes and actual oversized bodies', async () => {
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN', 'https://accounts.test');
    expect((await accountGateway(new Request('https://app.test/api/account/admin'))).status).toBe(404);
    expect((await accountGateway(new Request('https://app.test/api/account/sign-in/google', { method: 'POST', body: 'x'.repeat(2049) }))).status).toBe(413);
  });
  it('forwards explicit job lifecycle routes, preserves retry timing, and rejects adjacent actions', async () => {
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN', 'https://accounts.test');
    const fetcher=vi.fn().mockResolvedValue(Response.json({error:'Busy.'},{status:429,headers:{'Retry-After':'12'}}));vi.stubGlobal('fetch',fetcher);
    for(const action of ['cancel','dismiss']){
      const response=await accountGateway(new Request(`https://app.test/api/account/jobs/job-1/${action}`,{method:'POST',headers:{origin:'https://app.test','X-Account-Id':'owner'}}));
      expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('12');
    }
    expect(String(fetcher.mock.calls[0][0])).toBe('https://accounts.test/api/account/jobs/job-1/cancel');
    expect(String(fetcher.mock.calls[1][0])).toBe('https://accounts.test/api/account/jobs/job-1/dismiss');
    expect((await accountGateway(new Request('https://app.test/api/account/jobs/job-1/retry',{method:'POST'}))).status).toBe(404);
  });
  it('rejects plaintext upstreams in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN', 'http://localhost:8797');
    expect((await accountGateway(new Request('https://app.test/api/account/session'))).status).toBe(503);
  });
});

it('forwards bounded import metadata and account spend requests',async()=>{
  process.env.ACCOUNT_WORKER_ORIGIN='https://worker.example.test';
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true})));
  for(const [path,method] of [['imports','POST'],['imports/fixture-id','DELETE'],['spend?cursor=1:gemini-fixture','GET'],['spend/all','DELETE'],['provider-billing','GET']] as const){
    const response=await accountGateway(new Request(`https://app.example.test/api/account/${path}`,{method,headers:{Origin:'https://app.example.test','X-Account-Id':'owner'},...(method==='POST'?{body:JSON.stringify({metadata:{prompt:'x'.repeat(3000)}})}:{})}));
    expect(response.status).toBe(200);
  }
  const oversized=await accountGateway(new Request('https://app.example.test/api/account/imports',{method:'POST',body:'x'.repeat(32769)}));
  expect(oversized.status).toBe(413);
});
