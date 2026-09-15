import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadRemoteMedia, remoteVideoBlob, sniffMediaMime } from '../lib/media-download';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const HTML_BYTES = new TextEncoder().encode('<!doctype html><title>nope</title>');
const MP4_BYTES = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypisom'), 1, 2, 3, 4]);

const RESULT_URL = 'https://tempfile.example.com/result';

function response(bytes: Uint8Array, contentType?: string) {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: contentType ? { 'Content-Type': contentType } : {},
  });
}

let clickSpy: ReturnType<typeof vi.spyOn>;
let createObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:result');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  document.querySelectorAll('form, iframe').forEach((element) => element.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** What the anchor was actually told to save, and under what name. */
function savedAs() {
  const link = clickSpy.mock.instances[0] as HTMLAnchorElement;
  return { href: link.href, download: link.download };
}

describe('sniffMediaMime', () => {
  it.each([
    ['png', PNG_BYTES, 'image/png'],
    ['jpeg', JPEG_BYTES, 'image/jpeg'],
  ])('reads %s from its leading bytes', (_name, bytes, expected) => {
    expect(sniffMediaMime(bytes)).toBe(expected);
  });

  it('reads the container brands that share the ftyp header', () => {
    const ftyp = (brand: string) =>
      new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode(`ftyp${brand}`)]);
    expect(sniffMediaMime(ftyp('avif'))).toBe('image/avif');
    expect(sniffMediaMime(ftyp('isom'))).toBe('video/mp4');
  });

  it('says nothing about bytes it does not recognize', () => {
    expect(sniffMediaMime(HTML_BYTES)).toBeUndefined();
  });
});

describe('downloadRemoteMedia', () => {
  it('names the file from the sniffed bytes when the store sends a generic type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(JPEG_BYTES, 'application/octet-stream')));

    const saved = await downloadRemoteMedia({
      url: RESULT_URL,
      mediaType: 'image',
      filenameBase: 'quiet-ocean-at-dusk-gpt-image-2',
    });

    expect(saved).toBe(true);
    expect(savedAs()).toEqual({
      href: 'blob:result',
      download: 'quiet-ocean-at-dusk-gpt-image-2.jpg',
    });
  });

  it('retries an image through the server when the CDN refuses the browser', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === RESULT_URL) throw new TypeError('Failed to fetch');
      return response(PNG_BYTES, 'image/png');
    });
    vi.stubGlobal('fetch', fetchMock);

    const saved = await downloadRemoteMedia({
      url: RESULT_URL,
      mediaType: 'image',
      filenameBase: 'quiet-ocean-at-dusk-gpt-image-2',
    });

    expect(saved).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/fetch-image', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: RESULT_URL }),
    }));
    // The blob, not the provider URL — a cross-origin href would open a tab.
    expect(savedAs()).toEqual({
      href: 'blob:result',
      download: 'quiet-ocean-at-dusk-gpt-image-2.png',
    });
  });

  it('refuses a document dressed up as a result, on either route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(HTML_BYTES, 'application/octet-stream')));

    const saved = await downloadRemoteMedia({
      url: RESULT_URL,
      mediaType: 'image',
      filenameBase: 'quiet-ocean-at-dusk',
    });

    expect(saved).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    // Last resort only: the browser gets the URL itself.
    expect(savedAs().href).toBe(RESULT_URL);
  });

  it('submits a same-origin form when the provider blocks a video fetch', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);

    const saved = await downloadRemoteMedia({
      url: RESULT_URL,
      mediaType: 'video',
      filenameBase: 'neon-tiger-wan-2_7',
      mimeType: 'video/mp4',
    });

    expect(saved).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    const form = submitSpy.mock.instances[0] as HTMLFormElement;
    expect(form.method).toBe('post');
    expect(form.target).toBeTruthy();
    expect(form.target).not.toBe('_self');
    const targetFrame = document.querySelector<HTMLIFrameElement>(`iframe[name="${form.target}"]`);
    expect(targetFrame).not.toBeNull();
    expect(targetFrame?.hidden || targetFrame?.style.display === 'none').toBe(true);
    expect(new URL(form.action).pathname).toBe('/api/download-video');
    expect(new URL(form.action).search).toBe('');
    const fields = Object.fromEntries(new FormData(form).entries());
    expect(fields).toEqual({
      url: RESULT_URL,
      filenameBase: 'neon-tiger-wan-2_7',
      mimeType: 'video/mp4',
    });
    // A failed cross-origin fetch must not fall back to an anchor navigation.
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe('remoteVideoBlob', () => {
  it('reads the CDN directly when it answers the browser', async () => {
    const fetchMock = vi.fn(async () => response(MP4_BYTES, 'video/mp4'));
    vi.stubGlobal('fetch', fetchMock);

    const blob = await remoteVideoBlob(RESULT_URL);

    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBe(MP4_BYTES.byteLength);
    // No server bandwidth spent on a CDN that was willing to talk.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks the app for the bytes when the CDN refuses the browser', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === RESULT_URL) throw new TypeError('Failed to fetch');
      return response(MP4_BYTES, 'video/mp4');
    });
    vi.stubGlobal('fetch', fetchMock);

    const blob = await remoteVideoBlob(RESULT_URL);

    expect(blob.size).toBe(MP4_BYTES.byteLength);
    const [endpoint, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(endpoint).toBe('/api/download-video');
    expect(init.method).toBe('POST');
    // The provider URL travels in the body, never in a query string.
    const fields = Object.fromEntries(new URLSearchParams(String(init.body)));
    expect(fields).toEqual({ url: RESULT_URL, filenameBase: 'video' });
  });

  it('types the proxied bytes by what they are, not by a generic label', async () => {
    // A blob typed application/octet-stream is one no <video> element will play,
    // which is the difference between a readable frame and a decode error.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === RESULT_URL) throw new TypeError('Failed to fetch');
      return response(MP4_BYTES, 'application/octet-stream');
    }));

    expect((await remoteVideoBlob(RESULT_URL)).type).toBe('video/mp4');
  });

  it('refuses a document the proxy hands back in place of a clip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(HTML_BYTES, 'application/octet-stream')));

    await expect(remoteVideoBlob(RESULT_URL)).rejects.toThrow();
  });

  it('does not spend server bandwidth on a request the caller abandoned', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      throw new DOMException('Download aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);

    const caught = await remoteVideoBlob(RESULT_URL, controller.signal).catch((error) => error);

    expect((caught as DOMException).name).toBe('AbortError');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
