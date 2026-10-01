import type { AuthRequest, CompleteAuthorizationOptions, OAuthHelpers } from '@cloudflare/workers-oauth-provider';

/** Just enough of the library's consent helpers to test our side of the flow.
 *  The binding rule is the library's: the browser's cookie must match the handle,
 *  and a handle works once. */
export function fakeOAuth() {
  const authRequest: AuthRequest = { responseType: 'code', clientId: 'client-1', redirectUri: 'http://127.0.0.1:6274/oauth/callback', scope: [], state: 'state-1', codeChallenge: 'c', codeChallengeMethod: 'S256' };
  const handles = new Map<string, boolean>();
  const completed: CompleteAuthorizationOptions[] = [];
  const bound = (request: Request, handle: string) => {
    if (!handles.has(handle) || handles.get(handle) || !(request.headers.get('cookie') ?? '').includes(`consent=${handle}`)) throw new Error('unbound or used');
    handles.set(handle, true);
  };
  const helpers = {
    async parseAuthRequest(request: Request) {
      if (!new URL(request.url).searchParams.get('client_id')) throw new Error('invalid request');
      return authRequest;
    },
    async describeConsent() {
      return { clientId: 'client-1', clientName: 'Claude Code', redirectUri: authRequest.redirectUri, redirectHost: '127.0.0.1', redirectIsLoopback: true, scope: [] };
    },
    async beginConsent() {
      const handle = crypto.randomUUID();
      handles.set(handle, false);
      return { handle, headers: new Headers({ 'Set-Cookie': `consent=${handle}; Path=/; HttpOnly`, 'X-Frame-Options': 'DENY' }) };
    },
    async approveConsent(request: Request, handle: string) {
      bound(request, handle);
      return { request: authRequest, headers: new Headers({ 'Set-Cookie': 'consent=; Max-Age=0' }) };
    },
    async denyConsent(request: Request, handle: string) {
      bound(request, handle);
      const redirectTo = `${authRequest.redirectUri}?error=access_denied&state=state-1`;
      return { request: authRequest, redirectTo, headers: new Headers({ Location: redirectTo }) };
    },
    async completeAuthorization(options: CompleteAuthorizationOptions) {
      completed.push(options);
      return { redirectTo: `${authRequest.redirectUri}?code=code-1&state=state-1` };
    },
    async listUserGrants() { return { items: [] }; },
    async revokeGrant() {},
  } as unknown as OAuthHelpers;
  return { helpers, completed };
}
