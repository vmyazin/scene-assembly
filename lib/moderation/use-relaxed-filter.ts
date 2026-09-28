// lib/moderation/use-relaxed-filter.ts
'use client';

import { useEffect, useRef, useState } from 'react';

import { accountRequest } from '@/lib/account/client';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { moderationCapability, type ModerationRoute } from './capabilities';
import { relaxedFilterEnabled } from './flag';
import { FLOOR_STANDARD_NOTE, inspectPrompt } from './floors';
import {
  RELAXED_POLICY_VERSION,
  consentIsCurrent,
  type ModerationLevel,
  type RelaxedConsent,
} from './level';

export interface RelaxedFilterInput extends ModerationRoute {
  workspaceKey: string;
  prompt: string;
  hasReferences: boolean;
}

/**
 * Per-workspace Standard / Relaxed choice. The ref is what a submit reads,
 * because confirming the modal and resubmitting happen before React commits
 * the new preference.
 */
export function useRelaxedFilter(input: RelaxedFilterInput) {
  const consent = useAppStore((state) => state.relaxedFilter);
  const preferred = useAppStore((state) => state.preferredLevel[input.workspaceKey] ?? 'standard');
  const setConsent = useAppStore((state) => state.setRelaxedConsent);
  const setPreferred = useAppStore((state) => state.setPreferredLevel);
  const [open, setOpen] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const afterConsent = useRef<(() => void) | null>(null);
  const levelRef = useRef<ModerationLevel>('standard');

  const capability = moderationCapability(input);
  const offered = relaxedFilterEnabled() && capability.relaxable;
  const floor = inspectPrompt(input.prompt, preferred);
  const locked = input.hasReferences || floor.forceStandard;
  const effective: ModerationLevel = offered && preferred === 'relaxed' && !locked && consentIsCurrent(consent)
    ? 'relaxed'
    : 'standard';
  // Submit reads the ref, including a resubmit fired from the consent handler
  // before this effect runs. The effect covers prompt and reference changes,
  // which do not go through that handler.
  useEffect(() => {
    levelRef.current = effective;
  }, [effective]);

  const choose = (level: ModerationLevel) => {
    if (!offered) return;
    if (level === 'standard') {
      setPreferred(input.workspaceKey, 'standard');
      levelRef.current = 'standard';
      return;
    }
    if (locked) return;
    if (!consentIsCurrent(consent)) {
      setConsentError(null);
      setOpen(true);
      return;
    }
    setPreferred(input.workspaceKey, 'relaxed');
    levelRef.current = 'relaxed';
  };

  const requestRelaxed = (after?: () => void) => {
    if (!offered || locked) return;
    if (!consentIsCurrent(consent)) {
      afterConsent.current = after ?? null;
      setConsentError(null);
      setOpen(true);
      return;
    }
    setPreferred(input.workspaceKey, 'relaxed');
    levelRef.current = 'relaxed';
    after?.();
  };

  const confirm = async () => {
    const signedIn = Boolean(useAccountStore.getState().session?.account?.id);
    if (signedIn) {
      try {
        await accountRequest('relaxed-consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ageConfirmed: true, policyVersion: RELAXED_POLICY_VERSION }),
        });
      } catch {
        setConsentError('Could not save this confirmation on your account. Try again.');
        return;
      }
    }
    const record: RelaxedConsent = {
      consentedAt: new Date().toISOString(),
      policyVersion: RELAXED_POLICY_VERSION,
      ageConfirmed: true,
    };
    setConsent(record);
    setPreferred(input.workspaceKey, 'relaxed');
    levelRef.current = locked ? 'standard' : 'relaxed';
    setOpen(false);
    const resume = afterConsent.current;
    afterConsent.current = null;
    resume?.();
  };

  const cancel = () => {
    afterConsent.current = null;
    setOpen(false);
  };

  /** Adds `moderation` only when this request will actually run Relaxed. */
  const attach = (): { moderation?: 'relaxed' } =>
    offered && levelRef.current === 'relaxed' ? { moderation: 'relaxed' } : {};

  return {
    offered,
    effective,
    levelRef,
    capability,
    locked,
    lockedByReferences: input.hasReferences,
    floorNote: floor.forceStandard && !floor.blocked ? FLOOR_STANDARD_NOTE : null,
    open,
    consentError,
    choose,
    requestRelaxed,
    confirm,
    cancel,
    attach,
  };
}
