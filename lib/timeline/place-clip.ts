import { toast } from 'sonner';

import { probeDimensions } from '@/lib/timeline/probe';
import { useGalleryStore } from '@/store/useGalleryStore';
import { useTimelineStore, type TimelineOutput } from '@/store/useTimelineStore';

/**
 * Placing a clip from outside the timeline — a finished result, a library card —
 * and saying what that did.
 *
 * There is one timeline, so an add from the studio always joins whatever edit is
 * already there. That used to happen behind a bare "Added to the timeline": a
 * landscape clip went onto the end of an old portrait edit and only showed up,
 * letterboxed to a strip, when the user next opened the timeline. The add itself
 * is still the right default (a second timeline does not exist to start, and
 * clearing this one would lose an edit whose undo history is not persisted), so
 * the fix is to make the outcome visible at the moment it happens: where the clip
 * landed, whether its shape fits the frame, and a one-click way back.
 */

interface Shape {
  width: number;
  height: number;
}

/** Within 3% is the same shape — 1918×1080 is 16:9 for anyone looking at it. */
const SAME_SHAPE_TOLERANCE = 0.03;

/** How long to wait for a clip's dimensions before reporting without them. */
const PROBE_BUDGET_MS = 1500;

function orientation({ width, height }: Shape): 'landscape' | 'portrait' | 'square' {
  const ratio = width / height;
  if (ratio > 1 + SAME_SHAPE_TOLERANCE) return 'landscape';
  if (ratio < 1 - SAME_SHAPE_TOLERANCE) return 'portrait';
  return 'square';
}

function usable(shape: Partial<Shape> | null | undefined): shape is Shape {
  return Boolean(shape && shape.width && shape.height && shape.width > 0 && shape.height > 0);
}

/**
 * The words for one placement. Pure, so the copy is testable without a toast.
 *
 * `clipsBefore` is the count before this add. A frame is only worth comparing
 * against once something set it: an empty timeline in automatic mode derives its
 * frame from the clip being added, so there is nothing for it to mismatch.
 */
export function describePlacement({
  clipsBefore,
  clip,
  frame,
}: {
  clipsBefore: number;
  clip: Partial<Shape> | null;
  frame: Pick<TimelineOutput, 'width' | 'height' | 'auto'>;
}): { title: string; description?: string } {
  const title =
    clipsBefore === 0
      ? 'Started your timeline with this clip'
      : `Added as clip ${clipsBefore + 1} on your timeline`;

  const frameIsSet = clipsBefore > 0 || !frame.auto;
  if (!frameIsSet || !usable(clip) || !usable(frame)) return { title };

  const clipRatio = clip.width / clip.height;
  const frameRatio = frame.width / frame.height;
  if (Math.abs(clipRatio - frameRatio) / frameRatio <= SAME_SHAPE_TOLERANCE) return { title };

  const size = `${frame.width}×${frame.height}`;
  const clipShape = orientation(clip);
  const frameShape = orientation(frame);
  const mismatch =
    clipShape === frameShape
      ? `Its shape differs from the timeline's ${size} frame`
      : `This clip is ${clipShape} and the timeline is ${frameShape} (${size})`;
  return {
    title,
    description: `${mismatch}, so it will show with bars. Change its fit or the output size on the timeline.`,
  };
}

/** The clip's width and height: stored on its record, or read off its bytes. */
async function clipShape(recordId: string): Promise<Shape | null> {
  const record = useGalleryStore.getState().records.find((entry) => entry.id === recordId);
  if (!record) return null;
  if (usable(record)) return { width: record.width, height: record.height };
  if (!record.blob) return null;
  // Bounded: this decides one sentence of a toast, never whether the add happens.
  const budget = new Promise<null>((resolve) => setTimeout(() => resolve(null), PROBE_BUDGET_MS));
  return Promise.race([probeDimensions(record.blob).catch(() => null), budget]);
}

/**
 * Append a stored clip to the timeline and report where it went, with Undo.
 *
 * No "Open timeline" action: the callers sit in grids and panels rendered
 * outside a router in tests and in the library dialog, and a hard navigation
 * would drop the in-memory draft. The header's Timeline tab is one click away.
 */
export async function placeClipOnTimeline(recordId: string): Promise<void> {
  const shape = await clipShape(recordId);
  const { timeline } = useTimelineStore.getState();
  const placement = useTimelineStore.getState().addClip(recordId);
  const { title, description } = describePlacement({
    clipsBefore: timeline.clips.length,
    clip: shape,
    frame: timeline.output,
  });
  toast.success(title, {
    description,
    // Longer when there is a warning to read than when there is only a count.
    duration: description ? 9000 : 5000,
    action: { label: 'Undo', onClick: () => useTimelineStore.getState().removeClip(placement) },
  });
}
