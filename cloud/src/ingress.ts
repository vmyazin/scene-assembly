import { currentAccount } from './sessions';
import { hash, json, type Env } from './security';

export const ACCOUNT_BODY_LIMITS = {
  jobs: 40_000,
  connections: 8_192,
  imports: 32_768,
  other: 2_048,
} as const;

export const INGRESS_LIMITS = {
  ownerReads: 600,
  ownerWrites: 120,
  jobSubmissions: 20,
  anonymous: 3_000,
  oauthStarts: 120,
} as const;

const WINDOW_MS = 60_000;
const EXPIRY_GRACE_MS = WINDOW_MS;

export interface IngressOptions {
  now?: number;
  limits?: Partial<typeof INGRESS_LIMITS>;
}

export interface IngressResult {
  request: Request;
  response?: Response;
}

function accountBodyLimit(path: string): number {
  if (/^\/api\/account\/jobs(?:\/|$)/.test(path)) return ACCOUNT_BODY_LIMITS.jobs;
  if (/^\/api\/account\/connections(?:\/|$)/.test(path)) return ACCOUNT_BODY_LIMITS.connections;
  if (/^\/api\/account\/imports(?:\/|$)/.test(path)) return ACCOUNT_BODY_LIMITS.imports;
  return ACCOUNT_BODY_LIMITS.other;
}

function declaredTooLarge(request: Request, limit: number): boolean {
  const declared = request.headers.get('content-length');
  return declared !== null && /^\d+$/.test(declared) && Number(declared) > limit;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try { await reader.cancel(); } catch { /* The stream may already be closed or errored. */ }
}

export async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (declaredTooLarge(request, limit)) {
    if (request.body) await cancelReader(request.body.getReader());
    throw new BodyTooLargeError();
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await cancelReader(reader);
        throw new BodyTooLargeError();
      }
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy);
    }
  } catch (error) {
    if (!(error instanceof BodyTooLargeError)) await cancelReader(reader);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* Cancellation can release the lock first. */ }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export class BodyTooLargeError extends Error {}

async function rebuildBoundedPost(request: Request, limit: number): Promise<Request> {
  const bytes = await boundedBody(request, limit);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
    redirect: request.redirect,
    signal: request.signal,
  });
}

export async function consume(
  env: Env,
  rawBucket: string,
  limit: number,
  now: number,
): Promise<Response | undefined> {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const expiresAt = windowStart + WINDOW_MS + EXPIRY_GRACE_MS;
  const bucket = await hash(`ingress:${rawBucket}`);
  const accepted = await env.DB.prepare(`INSERT INTO account_ingress_limits (bucket,window_start,count,expires_at)
    VALUES (?,?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET
      window_start=excluded.window_start,
      count=CASE WHEN account_ingress_limits.window_start=excluded.window_start THEN account_ingress_limits.count+1 ELSE 1 END,
      expires_at=excluded.expires_at
    WHERE account_ingress_limits.window_start!=excluded.window_start OR account_ingress_limits.count<?
    RETURNING count`)
    .bind(bucket, windowStart, expiresAt, limit).first<{ count: number }>();
  if (accepted) return undefined;
  const retryAfter = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));
  const response = json({ error: 'Too many requests. Try again shortly.' }, 429);
  response.headers.set('Retry-After', String(retryAfter));
  return response;
}

export async function applyIngress(request: Request, env: Env, options: IngressOptions = {}): Promise<IngressResult> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/account' && !path.startsWith('/api/account/')) return { request };

  // Reject cross-site mutations before any session or counter database work.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== env.APP_ORIGIN) {
    return { request, response: json({ error: 'Request origin is not allowed.' }, 403) };
  }

  if (request.method === 'POST') {
    try { request = await rebuildBoundedPost(request, accountBodyLimit(path)); }
    catch (error) {
      if (error instanceof BodyTooLargeError) return { request, response: json({ error: 'Request is too large.' }, 413) };
      throw error;
    }
  }

  const now = options.now ?? Date.now();
  const limits = { ...INGRESS_LIMITS, ...options.limits };
  if (path === '/api/account/sign-in/google' && request.method === 'POST') {
    return { request, response: await consume(env, 'global:oauth-start', limits.oauthStarts, now) };
  }

  const account = await currentAccount(request, env);
  if (!account) return { request, response: await consume(env, 'global:anonymous', limits.anonymous, now) };

  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const jobSubmission = path === '/api/account/jobs' && request.method === 'POST';
  const kind = jobSubmission ? 'job-submission' : safe ? 'read' : 'write';
  const limit = jobSubmission ? limits.jobSubmissions : safe ? limits.ownerReads : limits.ownerWrites;
  return { request, response: await consume(env, `owner:${account.id}:${kind}`, limit, now) };
}

export async function cleanupExpiredIngress(env: Env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM account_ingress_limits WHERE expires_at<=?').bind(now).run();
}
