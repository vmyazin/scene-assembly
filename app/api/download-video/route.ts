import { NextRequest, NextResponse } from 'next/server';

import { acceptedResultUrl } from '@/lib/account/result-location';
import { isGateFailure, requireApprovedAccount } from '@/lib/auth/guard';
import {
  extensionForMedia,
  MAX_REMOTE_VIDEO_BYTES,
  normalizedMimeType,
} from '@/lib/media-download';
import { proxyRefusal } from '@/lib/server/proxy-guard';
import { fetchPublicMedia } from '@/lib/server/public-media-fetch';
import { createRateLimiter } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';

const MAX_URL_LENGTH = 2048;
const MAX_FILENAME_BASE_LENGTH = 160;
// This signal covers the streamed body as well as the initial headers. Allow a
// slow large-file transfer while still preventing a stalled CDN from holding a
// server request forever.
const FETCH_TIMEOUT_MS = 5 * 60_000;
const OPAQUE_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
]);

/** Each download can stream 512 MiB on our bandwidth; a timeline import fetches a few clips at once. */
export const DOWNLOAD_RATE_LIMIT = 60;
const downloads = createRateLimiter(DOWNLOAD_RATE_LIMIT, 10 * 60 * 1000);
export function resetDownloadRateLimit() {
  downloads.reset();
}

function fail(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

function safeFilenameBase(raw: string) {
  const leaf = raw.replaceAll('\\', '/').split('/').pop() ?? '';
  return leaf
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.(mp4|webm|mov|mkv)$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^\.+|[-.]+$/g, '')
    .slice(0, MAX_FILENAME_BASE_LENGTH);
}

function cappedStream(source: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = source.getReader();
  let total = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel('Remote video exceeded the download size limit');
          controller.error(new Error('Remote video exceeded the download size limit'));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function POST(request: NextRequest) {
  const gate = requireApprovedAccount(request);
  if (isGateFailure(gate)) return gate.response;
  const refused = proxyRefusal(request, downloads);
  if (refused) return refused;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'The download request is malformed.');
  }

  const rawUrl = String(form.get('url') ?? '').trim();
  const rawFilenameBase = String(form.get('filenameBase') ?? '').trim();
  const hintedMime = normalizedMimeType(String(form.get('mimeType') ?? ''));
  const filenameBase = safeFilenameBase(rawFilenameBase);

  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
    return fail(400, 'A video URL is required.');
  }
  if (!filenameBase || rawFilenameBase.length > MAX_FILENAME_BASE_LENGTH * 2) {
    return fail(400, 'A valid download filename is required.');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail(400, 'A video URL is required.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || Boolean(url.username)
    || Boolean(url.password)
  ) {
    return fail(400, 'That address cannot be downloaded.');
  }
  // This route exists for provider results the browser cannot fetch itself, so
  // only the provider hosts capture already trusts are proxied. An open list
  // made it a free 512 MiB relay for any file on the internet.
  if (!acceptedResultUrl(url.href)) {
    return fail(403, 'That address cannot be downloaded.');
  }

  const result = await fetchPublicMedia(url, {
    accept: 'video/*, application/octet-stream',
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!(result instanceof Response)) {
    return fail(result.status, result.kind === 'blocked'
      ? 'That address cannot be downloaded.'
      : 'That video could not be fetched from its source.');
  }
  if (!result.ok || !result.body) {
    void result.body?.cancel();
    return fail(502, 'That video could not be fetched from its source.');
  }

  const upstreamMime = normalizedMimeType(result.headers.get('content-type'));
  if (!OPAQUE_MIMES.has(upstreamMime) && !VIDEO_MIMES.has(upstreamMime)) {
    void result.body.cancel();
    return fail(415, 'That link does not point at a supported video.');
  }
  const effectiveMime = OPAQUE_MIMES.has(upstreamMime) && VIDEO_MIMES.has(hintedMime)
    ? hintedMime
    : OPAQUE_MIMES.has(upstreamMime)
      ? 'video/mp4'
      : upstreamMime;

  const declaredHeader = result.headers.get('content-length')?.trim() ?? '';
  const declaredLength = /^\d+$/.test(declaredHeader) ? Number(declaredHeader) : undefined;
  if (
    declaredLength !== undefined
    && (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_REMOTE_VIDEO_BYTES)
  ) {
    void result.body.cancel();
    return fail(413, 'That video is too large.');
  }

  const filename = `${filenameBase}.${extensionForMedia('video', effectiveMime)}`;
  const headers = new Headers({
    'Content-Type': upstreamMime || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (declaredLength !== undefined) headers.set('Content-Length', String(declaredLength));

  return new NextResponse(cappedStream(result.body, MAX_REMOTE_VIDEO_BYTES), {
    status: 200,
    headers,
  });
}
