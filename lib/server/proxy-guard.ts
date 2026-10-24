// lib/server/proxy-guard.ts
import { NextResponse } from 'next/server';

import { clientAddress, type RateLimiter } from '@/lib/server/rate-limit';

/**
 * Shared front door for the media proxies (`/api/download-video`,
 * `/api/fetch-image`), which fetch a remote URL on the server's bandwidth.
 *
 * A browser names the requesting site in `Sec-Fetch-Site`; anything but our own
 * pages is refused, so another site cannot post a form here and have a visitor
 * download its bytes under our origin. A script can omit the header, so each
 * address also gets a window of proxied fetches.
 */
export function proxyRefusal(
  request: Request,
  limiter: RateLimiter
): NextResponse | null {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') {
    return NextResponse.json({ success: false, error: 'Cross-site requests are not allowed.' }, { status: 403 });
  }
  const limited = limiter.consume(clientAddress(request));
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many downloads in a short time. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } }
    );
  }
  return null;
}
