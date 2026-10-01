/** Capture trusts only provider-owned hosts, never an entire shared storage service.
 * Atlas's specific Alibaba bucket was verified on a live job on 2026-09-29;
 * allowing all of aliyuncs.com would also trust buckets anybody can create. */
const RESULT_DOMAINS = ['fal.media', 'fal.ai', 'kie.ai', 'kieai.redpandaai.co', 'tempfile.ai', 'tempfile.redpandaai.co', 'redpandaai.co', 'runware.ai', 'atlascloud.ai', 'atlas-media.oss-us-west-1.aliyuncs.com', 'cometapi.com', 'filesystem.site', 'piapi.ai', 'theapi.app'];

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
  return url && RESULT_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url : null;
}
