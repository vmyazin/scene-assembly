// lib/moderation/level.ts
/**
 * Standard is today's payload. Relaxed asks a hosting layer for its documented
 * less-strict setting. It is not an adult mode: the copy and the knobs stay
 * inside what each provider publishes.
 */

/** Persisted map key for a confirmation made while signed out. */
export const GUEST_CONSENT_KEY = 'guest';

/**
 * Account ids and the guest bucket must not share a key. A guest confirmation
 * stored under the same field as an account would let a later sign-in skip the
 * dialog and show Relaxed while the Worker still runs Standard.
 */
export function consentStorageKey(accountId: string | null | undefined): string {
  return accountId ? `account:${accountId}` : GUEST_CONSENT_KEY;
}
export type ModerationLevel = 'standard' | 'relaxed';

/** Bump to ask for the 18+ confirmation again. */
export const RELAXED_POLICY_VERSION = 1;

export interface RelaxedConsent {
  consentedAt: string;
  policyVersion: number;
  ageConfirmed: true;
  /** Null is a guest. A signed-in confirmation names the account it was saved for. */
  accountId: string | null;
}

export function isModerationLevel(value: unknown): value is ModerationLevel {
  return value === 'standard' || value === 'relaxed';
}

export function moderationLevel(value: unknown): ModerationLevel {
  return value === 'relaxed' ? 'relaxed' : 'standard';
}

export function consentIsCurrent(
  consent: RelaxedConsent | null | undefined,
  accountId: string | null
): boolean {
  return Boolean(
    consent &&
      consent.ageConfirmed === true &&
      consent.policyVersion === RELAXED_POLICY_VERSION &&
      typeof consent.consentedAt === 'string' &&
      consent.consentedAt.length > 0 &&
      (consent.accountId ?? null) === accountId
  );
}
