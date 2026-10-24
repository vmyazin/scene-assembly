import { NextRequest, NextResponse } from 'next/server';

import { isGateFailure, requireApprovedAccount } from '@/lib/auth/guard';
import { proxyRefusal } from '@/lib/server/proxy-guard';
import { fetchPublicMedia } from '@/lib/server/public-media-fetch';
import { createRateLimiter } from '@/lib/server/rate-limit';

// node:dns rules this out of the edge runtime, and the address check is the whole point.
export const runtime = 'nodejs';

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
]);

const MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_URL_LENGTH = 2048;

const GENERIC_ERROR = 'That image could not be fetched from its source.';
const BLOCKED_ERROR = 'That address cannot be fetched.';

/** Dropped links can point anywhere, so no host list here; the window bounds how much one address fetches. */
export const FETCH_IMAGE_RATE_LIMIT = 120;
const fetches = createRateLimiter(FETCH_IMAGE_RATE_LIMIT, 10 * 60 * 1000);
export function resetFetchImageRateLimit() {
  fetches.reset();
}

function fail(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Read the body with a hard ceiling. Content-Length is a claim by the remote host — it can
 * be absent, or a lie — so the running total is what actually enforces the cap.
 */
async function readCapped(response: Response): Promise<Uint8Array | undefined> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return undefined;

  const reader = response.body?.getReader();
  if (!reader) return undefined;

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      void reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function POST(request: NextRequest) {
  // A no-op unless AUTH_ADMIN_EMAIL is set, but a private deployment should not expose an
  // open fetch proxy to anyone who finds the URL.
  const gate = requireApprovedAccount(request);
  if (isGateFailure(gate)) return gate.response;
  const refused = proxyRefusal(request, fetches);
  if (refused) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'The request body must be JSON.');
  }

  const raw =
    body !== null && typeof body === 'object' && 'url' in body && typeof body.url === 'string'
      ? body.url.trim()
      : '';
  if (!raw || raw.length > MAX_URL_LENGTH) return fail(400, 'An image URL is required.');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(400, 'An image URL is required.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail(400, BLOCKED_ERROR);

  const result = await fetchPublicMedia(url, {
    accept: 'image/*',
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!(result instanceof Response)) {
    return fail(result.status, result.kind === 'blocked' ? BLOCKED_ERROR : GENERIC_ERROR);
  }
  if (!result.ok) {
    void result.body?.cancel();
    return fail(502, GENERIC_ERROR);
  }

  const contentType = (result.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    void result.body?.cancel();
    return fail(415, 'That link does not point at a supported image.');
  }

  const bytes = await readCapped(result);
  if (!bytes) return fail(413, 'That image is too large.');

  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      // Fixed type and attachment disposition: whatever came back, our own origin never
      // renders it as a document.
      'Content-Type': contentType,
      'Content-Disposition': 'attachment',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
