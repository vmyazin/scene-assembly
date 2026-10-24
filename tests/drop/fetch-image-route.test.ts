// @vitest-environment node

import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { FETCH_IMAGE_RATE_LIMIT, POST, resetFetchImageRateLimit } from '../../app/api/fetch-image/route';

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('http://localhost/api/fetch-image', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as NextRequest;
}

function imageResponse(bytes: Uint8Array, type = 'image/png', headers: Record<string, string> = {}) {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': type, ...headers },
  });
}

const PUBLIC_LOOKUP = [{ address: '93.184.216.34', family: 4 }];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFetchImageRateLimit();
  lookupMock.mockResolvedValue(PUBLIC_LOOKUP);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('POST /api/fetch-image', () => {
  it('returns the bytes for a public image URL', async () => {
    fetchMock.mockResolvedValue(imageResponse(new Uint8Array([1, 2, 3]), 'image/webp'));

    const response = await POST(request({ url: 'https://example.com/cat.webp' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects a non-http protocol before any fetch', async () => {
    const response = await POST(request({ url: 'file:///etc/passwd' }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);

    const response = await POST(request({ url: 'https://internal.example.com/x.png' }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when only one of several answers is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    const response = await POST(request({ url: 'https://split-horizon.example.com/x.png' }));

    expect(response.status).toBe(403);
  });

  it('rejects a literal metadata address without consulting DNS', async () => {
    const response = await POST(request({ url: 'http://169.254.169.254/latest/meta-data/' }));

    expect(response.status).toBe(403);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-checks the address after a redirect', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } })
      )
      .mockResolvedValue(imageResponse(new Uint8Array([9])));

    const response = await POST(request({ url: 'https://example.com/redirect' }));

    expect(response.status).toBe(403);
    // The second hop must never be attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after too many redirects', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://example.com/next' } })
    );

    const response = await POST(request({ url: 'https://example.com/start' }));

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 hops
  });

  it('rejects a response that is not an allowed image type', async () => {
    fetchMock.mockResolvedValue(imageResponse(new Uint8Array([1]), 'text/html'));

    const response = await POST(request({ url: 'https://example.com/page.png' }));

    expect(response.status).toBe(415);
  });

  it('rejects a body over the size cap even when Content-Length lies', async () => {
    const oversized = new Uint8Array(21 * 1024 * 1024);
    fetchMock.mockResolvedValue(imageResponse(oversized, 'image/png', { 'content-length': '10' }));

    const response = await POST(request({ url: 'https://example.com/big.png' }));

    expect(response.status).toBe(413);
  });

  it('rejects an upstream error status', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));

    const response = await POST(request({ url: 'https://example.com/missing.png' }));

    expect(response.status).toBe(502);
  });

  it('rejects a malformed body', async () => {
    expect((await POST(request('not json'))).status).toBe(400);
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ url: `https://example.com/${'a'.repeat(2100)}` }))).status).toBe(400);
  });
});

describe('POST /api/fetch-image abuse limits', () => {
  it('refuses a request posted from another site', async () => {
    const response = await POST(request({ url: 'https://example.com/a.png' }, { 'Sec-Fetch-Site': 'cross-site' }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limits how many fetches one address can start', async () => {
    fetchMock.mockImplementation(async () => imageResponse(new Uint8Array([1])));
    for (let attempt = 0; attempt < FETCH_IMAGE_RATE_LIMIT; attempt += 1) {
      await POST(request({ url: 'https://example.com/a.png' }, { 'X-Real-IP': '203.0.113.9' }));
    }

    const limited = await POST(request({ url: 'https://example.com/a.png' }, { 'X-Real-IP': '203.0.113.9' }));
    expect(limited.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(FETCH_IMAGE_RATE_LIMIT);
  });
});
