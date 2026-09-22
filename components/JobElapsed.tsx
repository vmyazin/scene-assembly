'use client';

import { useElapsedSeconds } from '@/lib/jobs/use-elapsed';
import { formatElapsed } from '@/lib/timeline/format';

interface JobElapsedProps {
  /** When the job was submitted — its `createdAt`, never a mount timestamp. */
  startedAt: number | undefined;
  /**
   * The job's `updatedAt`, passed only once it has finished. Present means the
   * clock stops and reads as a total rather than a countdown.
   */
  finishedAt?: number;
  className?: string;
}

/**
 * Whether `JobElapsed` will render anything for this pair.
 *
 * Exported so a caller that puts a separator in front of the clock can leave it
 * out too. A job that finished inside a second reports no duration, and the
 * `Saved ·` it otherwise left behind reads as a row that was cut off — which
 * local-test jobs hit every time.
 */
export function hasElapsed(startedAt: number | undefined, finishedAt?: number): boolean {
  if (typeof startedAt !== 'number') return false;
  return finishedAt === undefined || finishedAt - startedAt >= 1000;
}

/**
 * How long a job has been going, or how long it took.
 *
 * `role="timer"` carries an implicit `aria-live="off"`, which is the point: a
 * number that changes every second inside a live region would have a screen
 * reader announce it every second, drowning the message beside it that says
 * what is actually happening.
 *
 * Formatting goes through `formatElapsed` rather than a second `m:ss` of its
 * own — see that module's note on three copies once disagreeing on the value.
 * Past an hour it reads `73:20` rather than `1:13:20`, deliberately: a video
 * job at `73:20` is visibly wrong, and that is worth seeing.
 */
export default function JobElapsed({ startedAt, finishedAt, className = '' }: JobElapsedProps) {
  const seconds = useElapsedSeconds(startedAt, { frozenAt: finishedAt });

  // Nothing to say without an origin, and a finished job that somehow reports
  // no duration reads better as absent than as `took 0:00`.
  if (!hasElapsed(startedAt, finishedAt)) return null;

  const clock = formatElapsed(seconds);

  return (
    <span
      role="timer"
      aria-label={finishedAt !== undefined ? `Took ${clock}` : `Running for ${clock}`}
      className={`tabular-nums ${className}`}
    >
      {finishedAt !== undefined ? `took ${clock}` : clock}
    </span>
  );
}
