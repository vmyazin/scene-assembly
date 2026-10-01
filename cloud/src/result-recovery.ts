import type { JobResultRecovery } from '../../lib/account/contracts';
import { acceptedResultUrl, providerBrowserUrl } from '../../lib/account/result-location';
import type { JobRow } from './jobs';

function sources(job: Pick<JobRow, 'result_json'>): { url?: unknown }[] {
  try {
    const result = JSON.parse(job.result_json ?? 'null');
    return Array.isArray(result?.sources) && result.sources.length <= 8 && result.sources.every((source: unknown) => !!source && typeof source === 'object')
      ? result.sources : [];
  } catch { return []; }
}

/** A policy update can make a formerly rejected location saveable. Re-evaluate
 * the stored URLs, without contacting a provider or relaxing capture's policy. */
export function canRetryResultLocation(job: Pick<JobRow, 'state' | 'failure_reason' | 'result_json'>): boolean {
  if (job.state !== 'needs_attention' || job.failure_reason !== 'result_location') return false;
  const outputs = sources(job);
  return outputs.length > 0 && outputs.every(source => acceptedResultUrl(source.url) !== null);
}

/** Only the authenticated recovery read exposes these temporary URLs. Normal
 * job lists, workflow diagnostics and persisted browser stores must not. */
export function resultRecovery(job: JobRow): JobResultRecovery {
  const links = sources(job).flatMap(source => {
    const url = providerBrowserUrl(source.url);
    return url ? [{ url: url.href, hostname: url.hostname }] : [];
  });
  let providerTaskId: string | null = null;
  try {
    const id = JSON.parse(job.provider_task ?? 'null')?.id;
    if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) providerTaskId = id;
  } catch { /* A reference is optional; never echo raw provider state. */ }
  return { links, providerTaskId };
}
