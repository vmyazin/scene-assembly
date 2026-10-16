// components/FalRunCost.tsx
'use client';

import { falSecondsFrom } from '@/lib/fal/pricing';
import { falRunCost } from '@/lib/fal/run-cost';
import type { FalInputMode, FalMediaType } from '@/lib/fal/types';

interface FalRunCostProps {
  modelId: string;
  mediaType: FalMediaType;
  inputMode: FalInputMode;
  /** Raw control values: `5`, `'10'` and `'8s'` all appear across fal models. */
  resolution?: string | number | boolean;
  audio?: string | number | boolean;
  duration?: string | number | boolean;
  /** Output length when it is billed instead of the source. `0` means match source. */
  outputDuration?: string | number | boolean;
}

/**
 * What the press it sits on will cost, at the settings on screen.
 *
 * Its own component rather than a line inside the workspace, for a mechanical
 * reason worth recording: the fal workspace derives its control values from the
 * selected variant, so handing any of those values to an imported helper during
 * that component's render makes the React compiler treat the variant as
 * possibly mutated — and it then declines to preserve the workspace's existing
 * memoization and skips optimizing the file. Crossing into a child on props
 * puts the lookup somewhere the workspace's own memoization is not at stake.
 *
 * Renders nothing when fal never published a rate for this combination. A
 * missing figure is a silence; a nearby figure would be a guess the reader has
 * no reason to doubt.
 */
export default function FalRunCost({
  modelId,
  mediaType,
  inputMode,
  resolution,
  audio,
  duration,
  outputDuration,
}: FalRunCostProps) {
  const cost = falRunCost(
    modelId,
    mediaType,
    inputMode,
    typeof resolution === 'string' ? resolution : undefined,
    typeof audio === 'boolean' ? audio : undefined,
    falSecondsFrom(outputDuration) ?? falSecondsFrom(duration)
  );
  if (!cost) return null;
  return <span className="font-normal opacity-80">{` · ~$${cost.costUsd.toFixed(2)}`}</span>;
}
