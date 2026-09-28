// cloud/src/relaxed-consent.ts
import type { CloudJobRequest } from '../../lib/account/contracts';
import { RELAXED_POLICY_VERSION } from '../../lib/moderation/level';
import type { Env } from './security';

/**
 * A relaxed job with no current consent record is stored and run as Standard.
 * The column is added by migration 0013; a Worker that deploys before that
 * migration treats the missing column as "no consent" and still accepts the
 * job, rather than failing every submission.
 *
 * The Worker does not read `NEXT_PUBLIC_RELAXED_FILTER`. That flag is a Next
 * build setting; treating a missing one as off would downgrade every cloud
 * job. Consent is the gate here. Next routes clamp with `serverHonorsRelaxed`.
 */
export async function enforceRelaxedConsent(
  env: Env,
  userId: string,
  request: CloudJobRequest
): Promise<CloudJobRequest> {
  if (request.values.moderation !== 'relaxed') return request;
  let consented = false;
  try {
    const row = await env.DB.prepare(
      'SELECT relaxed_consent_at AS at, relaxed_policy_version AS version FROM account_users WHERE id = ?'
    ).bind(userId).first<{ at: number | null; version: number | null }>();
    consented = typeof row?.at === 'number' && row.at > 0 && row.version === RELAXED_POLICY_VERSION;
  } catch {
    consented = false;
  }
  if (consented) return request;
  return { ...request, values: { ...request.values, moderation: 'standard' } };
}

export async function recordRelaxedConsent(env: Env, userId: string, policyVersion: number): Promise<void> {
  if (policyVersion !== RELAXED_POLICY_VERSION) {
    throw new Error('policy');
  }
  await env.DB.prepare(
    'UPDATE account_users SET relaxed_consent_at = ?, relaxed_policy_version = ? WHERE id = ?'
  ).bind(Date.now(), RELAXED_POLICY_VERSION, userId).run();
}
