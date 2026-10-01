// tests/moderation/consent-migration.test.ts
import { beforeEach, describe, expect, it } from 'vitest';

import { GUEST_CONSENT_KEY, consentStorageKey } from '@/lib/moderation/level';
import { useAppStore } from '@/store/useAppStore';

const STORAGE_KEY = 'scene-assembly-store';

describe('relaxed consent is stored per account', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it('keeps a version 1 confirmation as a guest record', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          relaxedFilter: {
            consentedAt: '2026-09-28T00:00:00.000Z',
            policyVersion: 1,
            ageConfirmed: true,
          },
          uiSoundsEnabled: false,
        },
        version: 1,
      })
    );

    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().relaxedConsents[GUEST_CONSENT_KEY]).toMatchObject({
      accountId: null,
      policyVersion: 1,
      ageConfirmed: true,
    });
    expect(useAppStore.getState().relaxedConsents[consentStorageKey('account-a')]).toBeUndefined();
    expect(useAppStore.getState().uiSoundsEnabled).toBe(false);
  });
});
