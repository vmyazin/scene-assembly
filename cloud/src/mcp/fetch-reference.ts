import { MAX_EDIT_VIDEO_BYTES } from '../../../lib/providers/video-edit';
import { AccountError } from '../jobs';
import type { Env } from '../security';
import { MAX_INPUT_BYTES } from '../uploads';
import { peekMediaType } from '../media-type';

export { sniffMime } from '../media-type';

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
    const { mimeType, body } = await peekMediaType(response.body.getReader(), () => refused('The reference URL could not be read.'));
    if (!mimeType) { await body.cancel().catch(() => {}); throw refused('The reference is not a PNG, JPEG, WebP, AVIF, MP4 or WebM file.'); }
    const maxBytes = mimeType.startsWith('image/') ? MAX_INPUT_BYTES : MAX_EDIT_VIDEO_BYTES;
    return { body, mimeType, maxBytes };
  }
  throw refused('The reference URL redirected too many times.');
}
