// lib/results/meta.ts

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Roughly when something happened, for a metadata line where the exact second
 * is not the point.
 *
 * Deliberately coarse and deliberately paired with `formatAbsoluteTime` behind
 * it: "2m ago" answers "is this the run I just did?", which is the question
 * asked of a result card, and the tooltip answers "which run was it exactly?",
 * which is the question asked of one from yesterday. Writing both inline would
 * make every card carry a timestamp nobody reads.
 *
 * Under ten seconds reads as `just now` rather than `3s ago`: the card appears
 * at the moment the job finishes, so a counter starting at zero draws the eye
 * to the clock instead of to the image that just arrived.
 */
export function formatRelativeTime(secondsAgo: number): string {
  if (!Number.isFinite(secondsAgo) || secondsAgo < 10) return 'just now';
  if (secondsAgo < MINUTE) return `${Math.floor(secondsAgo)}s ago`;
  if (secondsAgo < HOUR) return `${Math.floor(secondsAgo / MINUTE)}m ago`;
  if (secondsAgo < DAY) return `${Math.floor(secondsAgo / HOUR)}h ago`;
  return `${Math.floor(secondsAgo / DAY)}d ago`;
}

/** The exact moment, in the viewer's own locale and zone, for the tooltip. */
export function formatAbsoluteTime(at: number): string {
  if (!Number.isFinite(at)) return '';
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** `1024×1536`. Both dimensions or nothing — half a size says nothing. */
export function formatDimensions(width?: number, height?: number): string | undefined {
  if (!width || !height) return undefined;
  return `${width}×${height}`;
}
