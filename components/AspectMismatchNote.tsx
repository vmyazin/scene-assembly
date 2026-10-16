'use client';

import { Crop } from 'lucide-react';

import { describeAspectMismatch, type AspectCandidate } from '@/lib/draft/aspect-match';

/**
 * One line under the controls when the reference image and the output shape
 * disagree; renders nothing when they agree.
 *
 * Takes the raw inputs rather than a finished message for the reason
 * `FalRunCost` does: a workspace that calls an imported helper with values it
 * derived from its variant during render makes the React compiler skip
 * optimizing it, while crossing into a child on props does not.
 */
export default function AspectMismatchNote({
  reference,
  candidates,
  current,
}: {
  reference: { width?: number; height?: number } | undefined;
  candidates: AspectCandidate[];
  current: string | number | boolean | undefined;
}) {
  const message = describeAspectMismatch(reference, candidates, typeof current === 'string' ? current : undefined);
  if (!message) return null;
  return (
    <p role="status" className="flex items-start gap-2 px-0.5 text-xs leading-relaxed text-[var(--foreground-muted)]">
      <Crop size={13} className="mt-0.5 shrink-0 text-[var(--neon-cyan)]" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
