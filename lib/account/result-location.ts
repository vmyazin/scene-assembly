/** Capture trusts only provider-owned hosts, never an entire shared storage service.
 * Atlas's specific Alibaba bucket was verified on a live job on 2026-09-29;
 * allowing all of aliyuncs.com would also trust buckets anybody can create.
 * Comet's Runway Aleph 2 returns results on Runway's own CloudFront distribution
 * (seen on a live job on 2026-10-14); that one distribution is allowed, never
 * cloudfront.net, which anybody can put a distribution on.
 * Atlas's Wan 2.7 Edit hands back Alibaba DashScope's own result bucket on the
 * OSS accelerate endpoint (seen on a live job on 2026-10-16); that bucket is
 * allowed by exact host, for the same reason as Atlas's bucket above.
 * Atlas's Seedance 2.0 Fast hands back ByteDance's ModelArk bucket on Volcengine
 * TOS (seen on a live job on 2026-10-23); that bucket is allowed by exact host,
 * never volces.com, where anybody can create a bucket.
 * Atlas's Kling 4.0 reference-to-video started handing back a 24-hour temp
 * bucket on Alibaba's overseas OSS accelerate endpoint (seen on a live job on
 * 2026-11-13); that one bucket is allowed by exact host, never the endpoint,
 * whose other temp-24h-* buckets belong to whoever created them. */
const RESULT_DOMAINS = ['fal.media', 'fal.ai', 'kie.ai', 'kieai.redpandaai.co', 'tempfile.ai', 'tempfile.redpandaai.co', 'redpandaai.co', 'runware.ai', 'atlascloud.ai', 'atlas-media.oss-us-west-1.aliyuncs.com', 'cometapi.com', 'filesystem.site', 'piapi.ai', 'theapi.app', 'dnznrvs05pmza.cloudfront.net', 'dashscope-463f.oss-accelerate.aliyuncs.com', 'ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com', 'temp-24h-m4x2.oss-accelerate-overseas.aliyuncs.com'];

/** Hosts trusted by exact name only: unlike `RESULT_DOMAINS`, no subdomain of
 * these is accepted. Kie's docs show finished Market, Runway and Veo results on
 * `tempfile.aiquickdraw.com` (`resultUrls` examples on about 80 pages, and the
 * download-url example); a paid video job ended `result_location` on it
 * (owner's report, 2026-11-22). `file.aiquickdraw.com` is the documented host
 * of Veo 4K results and of Z-Image's `resultUrls` example. `aiquickdraw.com`
 * as a whole is not a name this app can vouch for, so neither it nor any other
 * host under it is trusted. Sources and the hosts left out are in
 * `docs/claude/specs/2026-11-22-kie-tempfile-aiquickdraw-host.md`. */
const RESULT_HOSTS = ['tempfile.aiquickdraw.com', 'file.aiquickdraw.com'];

/** Browser navigation only. This MUST NOT authorize a Worker fetch: an unknown
 * public-looking hostname can resolve or redirect anywhere. Links are shown
 * only after an owner asks, with their hostname and no referrer or opener. */
export function providerBrowserUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 16_384) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.+$/, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || host.startsWith('[')) return null;
    if (['localhost', 'local', 'internal', 'test', 'invalid'].some(suffix => host === suffix || host.endsWith(`.${suffix}`))) return null;
    return url;
  } catch { return null; }
}

export function acceptedResultUrl(value: unknown): URL | null {
  const url = providerBrowserUrl(value);
  if (!url) return null;
  return RESULT_HOSTS.includes(url.hostname) || RESULT_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url : null;
}
