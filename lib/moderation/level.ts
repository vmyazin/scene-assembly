// lib/moderation/level.ts
/**
 * Standard is today's payload. Relaxed asks a hosting layer for its documented
 * less-strict setting. It is not an adult mode: the copy and the knobs stay
 * inside what each provider publishes.
 */
export type ModerationLevel = 'standard' | 'relaxed';

/** Bump to ask for the 18+ confirmation again. */
export const RELAXED_POLICY_VERSION = 1;

export interface RelaxedConsent {
  consentedAt: string;
  policyVersion: number;
  ageConfirmed: true;
}

export function isModerationLevel(value: unknown): value is ModerationLevel {
  return value === 'standard' || value === 'relaxed';
}

export function moderationLevel(value: unknown): ModerationLevel {
  return value === 'relaxed' ? 'relaxed' : 'standard';
}

export function consentIsCurrent(consent: RelaxedConsent | null | undefined): boolean {
  return Boolean(
    consent &&
      consent.ageConfirmed === true &&
      consent.policyVersion === RELAXED_POLICY_VERSION &&
      typeof consent.consentedAt === 'string' &&
      consent.consentedAt.length > 0
  );
}
