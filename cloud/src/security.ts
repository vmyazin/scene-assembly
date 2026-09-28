import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

declare const __LOCAL_DEV__: boolean;
export interface Env {
  PUBLIC_WORKER_ORIGIN?: string;
  /** Opt-in only after provider contract and credentialed smoke verification. */
  CLOUD_GENERATION_PROVIDERS?: string;
  DB: D1Database;
  ASSETS?: R2Bucket;
  GENERATION?: Workflow<{ jobId: string }>;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DEV_ACCOUNT_EMAIL?: string;
  DEV_FAKE_GENERATION?: string;
  ACCOUNT_ENCRYPTION_KEYS?: string;
  ACCOUNT_ENCRYPTION_VERSION?: string;
  MCP_ORIGIN?: string;
  /** Injected by workers-oauth-provider before any handler runs. */
  OAUTH_PROVIDER?: OAuthHelpers;
  OAUTH_KV?: KVNamespace;
  IMAGES?: ImagesBinding;
}
export function isLocal(env: Env): boolean {
  return typeof __LOCAL_DEV__ !== 'undefined' && __LOCAL_DEV__ === true
    && new URL(env.APP_ORIGIN).protocol === 'http:'
    && ['localhost', '127.0.0.1'].includes(new URL(env.APP_ORIGIN).hostname);
}
export function validOrigin(env: Env): boolean {
  const url = new URL(env.APP_ORIGIN);
  return url.origin === env.APP_ORIGIN && (url.protocol === 'https:' || isLocal(env));
}
export function cookieName(env: Env, kind: 'session' | 'oauth') {
  return `${isLocal(env) ? '' : '__Host-'}sa_${kind}`;
}
export function cookie(env: Env, kind: 'session' | 'oauth', value: string, seconds: number) {
  return `${cookieName(env, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${isLocal(env) ? '' : '; Secure'}`;
}
export function readCookie(request: Request, name: string): string | undefined {
  const values = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  // Duplicate cookies are ambiguous; don't let ordering decide identity.
  if (values.length !== 1) return undefined;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : undefined;
}
export function randomToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function hash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
export function returnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\x00-\x1f]/.test(value)) return '/';
  const url = new URL(value, 'https://return.invalid');
  return url.origin === 'https://return.invalid' && !url.pathname.startsWith('/api/') ? `${url.pathname}${url.search}` : '/';
}
export function json(value: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(JSON.stringify(value), { status, headers });
}
