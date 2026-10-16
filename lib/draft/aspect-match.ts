import { useEffect, useRef } from 'react';

import type { ProviderSize } from '@/lib/providers/types';
import type { DraftReference } from '@/store/useDraftStore';

/**
 * One selectable option a workspace could snap to: the value it would write
 * into its control, and the aspect ratio that value stands for.
 */
export interface AspectCandidate {
  value: string;
  ratio: number;
}

/** '16:9', '9x16', '1280×720' → width/height. Null for 'auto', presets, etc. */
export function parseAspect(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)\s*$/i.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

/** Select-option values ('16:9', 'auto', 1024, …) → the ratio-parsable subset. */
export function candidatesFromValues(values: Array<string | number | boolean>): AspectCandidate[] {
  const candidates: AspectCandidate[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const ratio = parseAspect(value);
    if (ratio !== null) candidates.push({ value, ratio });
  }
  return candidates;
}

/**
 * A provider's published size table → candidates keyed by label, which is what
 * the "Output size" select stores. Entries that publish neither pixels nor a
 * ratio-shaped label (a bare vendor preset) cannot be matched and are skipped.
 */
export function candidatesFromSizes(sizes: ProviderSize[]): AspectCandidate[] {
  const candidates: AspectCandidate[] = [];
  for (const size of sizes) {
    const ratio =
      size.width && size.height && size.width > 0 && size.height > 0
        ? size.width / size.height
        : parseAspect(size.label);
    if (ratio !== null) candidates.push({ value: size.label, ratio });
  }
  return candidates;
}

/**
 * How far apart two ratios can sit in log space and still be the same shape.
 *
 * Vendors round their own tables: this model's "480p · 16:9" is 864×496, which
 * is 1.742 rather than 1.778, and lands 0.02 from a true 16:9. The nearest
 * genuinely different shape in these tables is 3:2, a full 0.17 away, so 0.05
 * separates "the vendor rounded" from "a different shape" with room to spare.
 */
const SAME_SHAPE = 0.05;

/** '480p · 16:9' → '480p'. Empty for a label that names only a ratio. */
export function sizeTier(label: string): string {
  const parts = label.split('·');
  return parts.length > 1 ? parts[0].trim() : '';
}

/**
 * The candidate whose ratio is closest to the image's, measured in log space
 * so that 2:1 and 1:2 sit at the same distance from square — a linear
 * difference would treat portrait ratios as all nearly alike.
 *
 * `current` is what the control already holds, and it is treated as a decision
 * rather than a starting point. These labels carry a resolution as well as a
 * shape, and resolution is what the money is: on this catalogue 720p is 2.25×
 * the per-second rate of 480p. Matching on ratio alone moved a reader from
 * "480p · 16:9" to "720p · 16:9" the moment they attached a 16:9 image, because
 * the vendor's own rounding made the more expensive row a closer numeric match.
 */
export function closestAspectCandidate(
  width: number,
  height: number,
  candidates: AspectCandidate[],
  current?: string
): AspectCandidate | null {
  if (width <= 0 || height <= 0) return null;
  const target = Math.log(width / height);
  const usable = candidates.filter(
    (candidate) => Number.isFinite(candidate.ratio) && candidate.ratio > 0
  );
  const distance = (candidate: AspectCandidate) => Math.abs(Math.log(candidate.ratio) - target);
  const nearest = (options: AspectCandidate[]) =>
    options.reduce<AspectCandidate | null>(
      (best, candidate) => (best === null || distance(candidate) < distance(best) ? candidate : best),
      null
    );

  const chosen = current ? usable.find((candidate) => candidate.value === current) : undefined;
  // Already the right shape: there is nothing to correct, and correcting it
  // anyway is how an explicit budget decision got overwritten.
  if (chosen && distance(chosen) <= SAME_SHAPE) return chosen;

  const best = nearest(usable);
  if (!best || !chosen) return best;

  // The shape does have to change. The resolution does not: prefer the same
  // tier when it can carry the new shape just as well.
  const tier = sizeTier(chosen.value);
  const sameTier = tier ? nearest(usable.filter((candidate) => sizeTier(candidate.value) === tier)) : null;
  return sameTier && distance(sameTier) <= distance(best) + SAME_SHAPE ? sameTier : best;
}

/**
 * Snaps a size-shaped control to the reference image the user just added.
 *
 * Fires when the driving reference (or its late-arriving measurement) changes,
 * and when the candidate list changes — a model switch publishes a different
 * whitelist, so the match is recomputed against it. It deliberately does NOT
 * fire on a manual control change: a pick made after the image was added is
 * the user overruling the guess, and it must stick.
 */
export function useAutoAspect(
  reference: DraftReference | undefined,
  candidates: AspectCandidate[],
  apply: (value: string) => void,
  /** What the control holds now, so an existing choice can be kept. */
  current?: string
) {
  const applyRef = useRef(apply);
  // A ref, not a dependency: the effect must fire when the reference changes,
  // never when the reader edits the control themselves. That edit overrules the
  // guess and has to stick, which is the rule this hook already kept.
  const currentRef = useRef(current);
  // Identity-stable key: candidates are rebuilt every render.
  const candidatesKey = candidates.map((candidate) => candidate.value).join('|');
  const candidatesRef = useRef(candidates);

  useEffect(() => {
    applyRef.current = apply;
    candidatesRef.current = candidates;
    currentRef.current = current;
  });

  const { id, width, height } = reference ?? {};
  useEffect(() => {
    if (!id || !width || !height) return;
    const matched = closestAspectCandidate(width, height, candidatesRef.current, currentRef.current);
    if (matched) applyRef.current(matched.value);
  }, [id, width, height, candidatesKey]);
}

/** Ratios people name; anything else is described by its pixels. */
const NAMED_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '9:21'];

function ratioName(width: number, height: number): string {
  const target = Math.log(width / height);
  let best: string | null = null;
  let bestDistance = SAME_SHAPE;
  for (const name of NAMED_RATIOS) {
    const ratio = parseAspect(name);
    if (ratio === null) continue;
    const distance = Math.abs(Math.log(ratio) - target);
    if (distance <= bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best ?? `${width}×${height}`;
}

/**
 * Says so when the reference image has a shape the model cannot output.
 *
 * `useAutoAspect` snaps to the nearest shape a model publishes, which is right
 * but silent: Veo offers only 16:9 and 9:16, so a square image landed on 16:9
 * and the person learned the frame would be reframed only from the result
 * (UX audit M5). Null when the selected shape matches, when the control has no
 * ratio to compare, or before the reference has been measured.
 */
export function describeAspectMismatch(
  reference: { width?: number; height?: number } | undefined,
  candidates: AspectCandidate[],
  current: string | undefined
): string | null {
  const width = reference?.width;
  const height = reference?.height;
  if (!width || !height || width <= 0 || height <= 0 || !current) return null;
  const chosen = candidates.find((candidate) => candidate.value === current);
  if (!chosen) return null;
  if (Math.abs(Math.log(chosen.ratio) - Math.log(width / height)) <= SAME_SHAPE) return null;
  const offered = candidates.some(
    (candidate) => Math.abs(Math.log(candidate.ratio) - Math.log(width / height)) <= SAME_SHAPE
  );
  const shape = ratioName(width, height);
  return offered
    ? `Your reference is ${shape} but the output is set to ${current}, so it will be reframed.`
    : `Your reference is ${shape}, and this model has no ${shape} output. It will be reframed to ${current}.`;
}
