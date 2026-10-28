'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import RatingControl from '@/components/RatingControl';
import { rateAccountAsset } from '@/lib/account/use-library';
import type { Rating, RatingTarget } from '@/lib/results/rating';
import { useAccountStore } from '@/store/useAccountStore';
import { useGalleryStore } from '@/store/useGalleryStore';

/**
 * The rating control under a result that just finished, so the judgement is
 * made while the clip is still on screen instead of from memory later.
 *
 * Renders nothing until the result is filed: a browser image is captured a
 * moment after it appears, and a record that could not be saved has nowhere
 * for a rating to live.
 */
export default function ResultRating({ target, className = '' }: { target: RatingTarget; className?: string }) {
  const record = useGalleryStore((state) =>
    target.kind === 'browser' ? state.records.find((entry) => entry.id === target.recordId) : undefined
  );
  const asset = useAccountStore((state) =>
    target.kind === 'cloud' ? state.assets.find((entry) => entry.id === target.assetId) : undefined
  );
  const [saving, setSaving] = useState(false);
  const found = target.kind === 'browser' ? record : asset;
  if (!found) return null;

  const rate = async (rating: Rating | null) => {
    if (target.kind === 'browser') {
      await useGalleryStore.getState().setRating(target.recordId, rating);
      return;
    }
    const { session, epoch } = useAccountStore.getState();
    const owner = session?.account?.id;
    if (!owner) return;
    setSaving(true);
    try {
      const saved = await rateAccountAsset(target.assetId, rating, owner);
      const state = useAccountStore.getState();
      // Owner and epoch guarded, so a rating that lands after a sign-out
      // cannot write into the next account's store.
      state.applyJobs(owner, epoch, state.jobs, state.assets.map((entry) => (entry.id === saved.id ? saved : entry)));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not save this rating.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 ${className}`}>
      <span className="text-xs text-[var(--foreground-muted)]">How did this model do?</span>
      <RatingControl value={found.rating} disabled={saving} onChange={(rating) => void rate(rating)} />
    </div>
  );
}
