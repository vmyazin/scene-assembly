// @vitest-environment node

import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { DOWNLOAD_RATE_LIMIT, POST, resetDownloadRateLimit } from '../app/api/download-video/route';

const PUBLIC_LOOKUP = [{ address: '93.184.216.34', family: 4 }];

function request(
  fields: Record<string, string | undefined>,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) body.set(key, value);
  }
  return new Request('http://localhost/api/download-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders },
    body,
  }) as NextRequest;
}

function videoResponse(
  bytes: Uint8Array,
  type = 'video/mp4',
  headers: Record<string, string> = {}
) {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': type, ...headers },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetDownloadRateLimit();
  lookupMock.mockResolvedValue(PUBLIC_LOOKUP);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('POST /api/download-video', () => {
  it('streams a public MP4 with safe download headers', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3]);
    fetchMock.mockResolvedValue(videoResponse(bytes));

    const response = await POST(request({
      url: 'https://v3.fal.media/results/clip.mp4',
      filenameBase: 'neon-tiger-wan-2_7',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="neon-tiger-wan-2_7\.mp4"$/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('refuses a host that is not a provider result host', async () => {
    const response = await POST(request({
      url: 'https://example.com/results/clip.mp4',
      filenameBase: 'clip',
    }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a request posted from another site', async () => {
    const response = await POST(request(
      { url: 'https://v3.fal.media/clip.mp4', filenameBase: 'clip' },
      { 'Sec-Fetch-Site': 'cross-site' }
    ));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limits how many downloads one address can start', async () => {
    fetchMock.mockImplementation(async () => videoResponse(new Uint8Array([1])));
    const fields = { url: 'https://v3.fal.media/clip.mp4', filenameBase: 'clip' };
    for (let attempt = 0; attempt < DOWNLOAD_RATE_LIMIT; attempt += 1) {
      await POST(request(fields, { 'X-Real-IP': '203.0.113.9' }));
    }

    const limited = await POST(request(fields, { 'X-Real-IP': '203.0.113.9' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(fetchMock).toHaveBeenCalledTimes(DOWNLOAD_RATE_LIMIT);
  });

  it('rejects a private host before fetching', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);

    const response = await POST(request({
      url: 'https://v3.fal.media/clip.mp4',
      filenameBase: 'clip',
    }));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-checks redirect destinations before following them', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } })
    );

    const response = await POST(request({
      url: 'https://v3.fal.media/redirect',
      filenameBase: 'clip',
    }));

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects HTML instead of returning it as a video', async () => {
    fetchMock.mockResolvedValue(videoResponse(new Uint8Array([60, 33, 62]), 'text/html'));

    const response = await POST(request({
      url: 'https://v3.fal.media/page',
      filenameBase: 'clip',
    }));

    expect(response.status).toBe(415);
  });

  it('rejects an oversized declared response before streaming it', async () => {
    fetchMock.mockResolvedValue(videoResponse(new Uint8Array([1]), 'video/mp4', {
      'Content-Length': String(512 * 1024 * 1024 + 1),
    }));

    const response = await POST(request({
      url: 'https://v3.fal.media/huge.mp4',
      filenameBase: 'clip',
    }));

    expect(response.status).toBe(413);
  });

  it('sanitizes path separators and unsafe filename characters', async () => {
    fetchMock.mockResolvedValue(videoResponse(new Uint8Array([1]), 'video/webm'));

    const response = await POST(request({
      url: 'https://v3.fal.media/clip.webm',
      filenameBase: '../folder/quiet tiger?.webm',
    }));

    expect(response.status).toBe(200);
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment; filename="/);
    expect(disposition).toMatch(/\.webm"$/);
    expect(disposition).not.toContain('/');
    expect(disposition).not.toContain('..');
  });

  it.each([
    {},
    { url: 'not-a-url', filenameBase: 'clip' },
    { url: 'https://v3.fal.media/clip.mp4' },
    { url: 'https://user:pass@v3.fal.media/clip.mp4', filenameBase: 'clip' },
    { url: `https://v3.fal.media/${'a'.repeat(2045)}`, filenameBase: 'clip' },
  ])('rejects malformed or missing fields: %j', async (fields) => {
    const response = await POST(request(fields));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
