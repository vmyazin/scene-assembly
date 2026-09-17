'use client';

import { Fragment, type ReactNode } from 'react';

import { useElapsedSeconds } from '@/lib/jobs/use-elapsed';
import { formatCompactDuration } from '@/lib/timeline/format';
import { formatUsd } from '@/lib/spend/format';
import { formatAbsoluteTime, formatDimensions, formatRelativeTime } from '@/lib/results/meta';

export interface ResultMetaProps {
  /** Engine that produced it, e.g. `gemini`, `fal`, `kie`. */
  provider?: string;
  modelId?: string;
  /** Natural pixel size, measured off the loaded image by the host. */
  width?: number;
  height?: number;
  /** USD, where the panel knows it. Kie and account assets do not. */
  cost?: number;
  /**
   * Wall clock around the run. Two timestamps rather than a duration so the
   * figure survives a reload, the same bargain `useElapsedSeconds` makes.
   * This is time to result — queue wait and save included — not the model's
   * own render time, which no provider reports.
   */
  startedAt?: number;
  finishedAt?: number;
  /** When the result came into being; falls back to `finishedAt`. */
  createdAt?: number;
  className?: string;
}

/**
 * What a result is, under the actions that send it somewhere.
 *
 * A finished image used to say nothing about itself, so comparing two runs
 * meant remembering which model was selected when each was fired — exactly the
 * thing iterating makes you lose track of. Every fact here is one the panel
 * already held and was throwing away.
 *
 * Facts are omitted, never blanked: the three panels know different amounts
 * (no provider reports cost the same way, and an account asset outlives the
 * job row that timed it), and a row of `—` placeholders would make an
 * incomplete record look like a broken one.
 */
export default function ResultMeta({
  provider,
  modelId,
  width,
  height,
  cost,
  startedAt,
  finishedAt,
  createdAt,
  className = '',
}: ResultMetaProps) {
  const at = createdAt ?? finishedAt;
  // Ticks through the shared page timer, so four cards cost one interval.
  const secondsAgo = useElapsedSeconds(at);

  const facts: { key: string; node: ReactNode }[] = [];

  if (provider) facts.push({ key: 'provider', node: <span>{provider}</span> });
  if (modelId) {
    facts.push({
      key: 'model',
      // The one fact worth the horizontal room it takes, so it gets the
      // emphasis and the others stay quiet around it.
      node: <span className="font-medium text-[var(--foreground-muted)]">{modelId}</span>,
    });
  }

  const size = formatDimensions(width, height);
  if (size) facts.push({ key: 'size', node: <span className="tabular-nums">{size}</span> });

  if (typeof cost === 'number' && cost > 0) {
    facts.push({ key: 'cost', node: <span className="tabular-nums">{formatUsd(cost)}</span> });
  }

  // A run that reports no elapsed time is left out rather than shown as
  // `took 0s`, which reads as a measurement rather than a missing one.
  if (typeof startedAt === 'number' && typeof finishedAt === 'number' && finishedAt > startedAt) {
    const seconds = (finishedAt - startedAt) / 1000;
    facts.push({
      key: 'took',
      node: <span className="tabular-nums">took {formatCompactDuration(seconds)}</span>,
    });
  }

  if (typeof at === 'number') {
    facts.push({
      key: 'when',
      node: (
        <time dateTime={new Date(at).toISOString()} title={formatAbsoluteTime(at)}>
          {formatRelativeTime(secondsAgo)}
        </time>
      ),
    });
  }

  if (facts.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--border)] pt-2 text-xs text-[var(--foreground-subtle)] ${className}`}
    >
      {facts.map((fact, index) => (
        <Fragment key={fact.key}>
          {index > 0 && (
            <span aria-hidden="true" className="opacity-40">
              ·
            </span>
          )}
          {fact.node}
        </Fragment>
      ))}
    </div>
  );
}
