import { MAX_EDIT_VIDEO_BYTES } from '../../../lib/providers/video-edit';
import { AccountError } from '../jobs';
import type { Env } from '../security';
import { MAX_INPUT_BYTES } from '../uploads';

/**
 * The one place the Worker fetches an address an agent chose. Our own hosts are
 * refused because their URLs can be capabilities (/media/... links), redirects
 * are followed by hand so every hop is re-checked, and the type is read from the
 * bytes because a header is whatever the other server says.
 */
export const REFERENCE_FETCH_TIMEOUT_MS = 20_000;
export const MAX_REFERENCE_REDIRECTS = 3;
const refused = (message: string) => new AccountError(message, 400, 'reference_fetch_failed');

function ownHosts(env: Env): Set<string> {
  const hosts = new Set<string>();
  for (const origin of [env.APP_ORIGIN, env.PUBLIC_WORKER_ORIGIN, env.MCP_ORIGIN]) {
    if (!origin) continue;
    try { hosts.add(new URL(origin).hostname.toLowerCase()); } catch { /* an unset or malformed var protects nothing */ }
  }
  return hosts;
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
  if (ownHosts(env).has(host)) throw refused('A reference cannot point at this service. Pass { assetId } for a library file.');
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

async function readCapped(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw refused('References can be up to 100 MB.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function fetchReference(env: Env, value: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let url = checkReferenceUrl(value, env);
  for (let hop = 0; hop <= MAX_REFERENCE_REDIRECTS; hop++) {
    let response: Response;
    try { response = await fetch(url, { redirect: 'manual', headers: { Accept: 'image/*, video/*' }, signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS) }); }
    catch { throw refused('The reference URL could not be reached.'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = response.headers.get('location');
      if (!next) throw refused('The reference URL redirected without saying where.');
      url = checkReferenceUrl(new URL(next, url).href, env);
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw refused(`The reference URL answered ${response.status}.`); }
    const bytes = await readCapped(response.body, MAX_EDIT_VIDEO_BYTES);
    const mimeType = sniffMime(bytes);
    if (!mimeType) throw refused('The reference is not a PNG, JPEG, WebP, AVIF, MP4 or WebM file.');
    if (mimeType.startsWith('image/') && bytes.byteLength > MAX_INPUT_BYTES) throw refused('Reference images can be up to 20 MB.');
    return { bytes, mimeType };
  }
  throw refused('The reference URL redirected too many times.');
}
