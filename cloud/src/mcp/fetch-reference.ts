import { MAX_EDIT_VIDEO_BYTES } from '../../../lib/providers/video-edit';
import { AccountError } from '../jobs';
import type { Env } from '../security';
import { MAX_INPUT_BYTES } from '../uploads';

/**
 * The one place the Worker fetches an address an agent chose. Our own hosts are
 * refused because their URLs can be capabilities (/media/... links), redirects
 * are followed by hand so every hop is re-checked, and the type is read from the
 * bytes because a header is whatever the other server says. The body is streamed
 * straight through to storage rather than buffered here: a 70-100 MB video fully
 * in memory, twice over for a second copy, can exceed a Workers isolate on its own.
 */
export const REFERENCE_FETCH_TIMEOUT_MS = 20_000;
export const MAX_REFERENCE_REDIRECTS = 3;
export const REFERENCE_USER_AGENT = 'SceneAssembly/1.0 (+https://sceneassembly.mzork.com)';
// Enough to cover every signature sniffMime checks: the ftyp brand sits at bytes 8-12.
const SNIFF_BYTES = 16;
const refused = (message: string) => new AccountError(message, 400, 'reference_fetch_failed');

function ownHosts(env: Env): Set<string> {
  const hosts = new Set<string>();
  for (const origin of [env.APP_ORIGIN, env.PUBLIC_WORKER_ORIGIN, env.MCP_ORIGIN]) {
    if (!origin) continue;
    try { hosts.add(new URL(origin).hostname.toLowerCase()); } catch { /* an unset or malformed var protects nothing */ }
  }
  return hosts;
}

/** A workers.dev preview or version URL (<build>-<worker-name>.<account>.workers.dev)
 *  runs the very same Worker as PUBLIC_WORKER_ORIGIN, under that account's own
 *  subdomain — so a sibling host under it is refused too, not just the exact origin. */
function workersDevSuffix(env: Env): string | null {
  if (!env.PUBLIC_WORKER_ORIGIN) return null;
  let hostname: string;
  try { hostname = new URL(env.PUBLIC_WORKER_ORIGIN).hostname.toLowerCase(); } catch { return null; }
  const labels = hostname.split('.');
  if (labels.length < 3 || labels.at(-1) !== 'dev' || labels.at(-2) !== 'workers') return null;
  return labels.slice(-3).join('.');
}

function isOwnHost(host: string, env: Env): boolean {
  if (ownHosts(env).has(host)) return true;
  const suffix = workersDevSuffix(env);
  return suffix !== null && (host === suffix || host.endsWith(`.${suffix}`));
}

export function checkReferenceUrl(value: string, env: Env): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw refused('That is not a valid URL.'); }
  if (url.protocol !== 'https:') throw refused('Reference URLs must use https.');
  if (url.username || url.password) throw refused('Reference URLs cannot carry credentials.');
  // A trailing "." makes a domain absolute (DNS-root notation) without changing what it
  // resolves to, but the URL parser leaves it on url.hostname verbatim — so without
  // stripping it here, "sceneassembly.mzork.com." would resolve to this very Worker
  // while comparing unequal to the plain hostname in ownHosts, bypassing the refusal below.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith('[')) throw refused('Use a hostname, not an IP address.');
  if (isOwnHost(host, env)) throw refused('A reference cannot point at this service. Pass { assetId } for a library file.');
  return url;
}

export function sniffMime(bytes: Uint8Array): string | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    // QuickTime and HEIF are refused: writeOutput stores neither.
    if (['qt  ', 'heic', 'heix', 'mif1', 'msf1'].includes(brand)) return null;
    return 'video/mp4';
  }
  return null;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Reads only enough of the body to sniff its type, so the remainder can be
 *  streamed straight to storage instead of held in memory here. */
async function sniffPrefix(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < SNIFF_BYTES) {
    let step: { done: boolean; value?: Uint8Array };
    try { step = await reader.read(); } catch { throw refused('The reference URL could not be read.'); }
    if (step.done || !step.value) break;
    chunks.push(step.value);
    size += step.value.byteLength;
  }
  return chunks;
}

/** Replays the prefix already consumed for sniffing, then continues reading the
 *  same underlying body — one contiguous stream to the caller even though the
 *  first bytes were read here. */
function replayBody(prefix: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < prefix.length) { controller.enqueue(prefix[index++]); return; }
      try {
        const { done, value } = await reader.read();
        if (done) controller.close(); else controller.enqueue(value);
      } catch { controller.error(refused('The reference URL could not be read.')); }
    },
    cancel(reason) { return reader.cancel(reason).catch(() => {}); },
  });
}

export async function fetchReference(env: Env, value: string): Promise<{ body: ReadableStream<Uint8Array>; mimeType: string; maxBytes: number }> {
  let url = checkReferenceUrl(value, env);
  for (let hop = 0; hop <= MAX_REFERENCE_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        headers: { Accept: 'image/*, video/*', 'User-Agent': REFERENCE_USER_AGENT },
        signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS),
      });
    } catch { throw refused('The reference URL could not be reached.'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      const next = response.headers.get('location');
      if (!next) throw refused('The reference URL redirected without saying where.');
      let nextUrl: URL;
      try { nextUrl = new URL(next, url); } catch { throw refused('The reference URL redirected somewhere invalid.'); }
      url = checkReferenceUrl(nextUrl.href, env);
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel().catch(() => {}); throw refused(`The reference URL answered ${response.status}.`); }
    const reader = response.body.getReader();
    const prefix = await sniffPrefix(reader);
    const mimeType = sniffMime(concatChunks(prefix));
    if (!mimeType) { await reader.cancel().catch(() => {}); throw refused('The reference is not a PNG, JPEG, WebP, AVIF, MP4 or WebM file.'); }
    const maxBytes = mimeType.startsWith('image/') ? MAX_INPUT_BYTES : MAX_EDIT_VIDEO_BYTES;
    return { body: replayBody(prefix, reader), mimeType, maxBytes };
  }
  throw refused('The reference URL redirected too many times.');
}
