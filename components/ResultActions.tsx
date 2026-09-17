'use client';

import { useEffect, useRef, useState } from 'react';
import { Film, ImageDown, Loader2, SquarePlay } from 'lucide-react';
import { toast } from 'sonner';

import {
  HANDOFF_ERROR,
  resolveResultImage,
  sendResultToFirstFrame,
  sendResultToReferences,
  type ResultKind,
} from '@/lib/result-handoff';

export interface ResultActionsProps {
  kind: ResultKind;
  /** Where the bytes live. Also the cache key for the resolved image. */
  src: string;
  /** Names the file that reaches the draft, and labels its provenance. */
  filenameBase: string;
  /** How many references the selected model accepts. */
  referenceLimit?: number;
  /**
   * Switch the app into image-to-video. Only passed where that destination is
   * reachable — without it the action is not offered at all, which is what
   * keeps the row from showing a button that goes nowhere.
   */
  onUseAsFirstFrame?: () => void;
  /** Place this result on the timeline. Video results only. */
  onAddToTimeline?: () => void | Promise<void>;
  /** Tightens the row where it sits under a card rather than a full panel. */
  dense?: boolean;
  /**
   * Turn the row into a column once the enclosing `@container` is wide enough.
   * For hosts that park these actions in a narrow side column beside the
   * result instead of a full-width strip beneath it — side by side, two
   * buttons sharing 13rem would each be a truncated sliver.
   */
  stack?: boolean;
}

type Action = 'reference' | 'first-frame' | 'timeline';

/**
 * One row of "send this somewhere" on a finished result.
 *
 * A result used to be a dead end: a finished image offered only Download, so
 * reusing it meant generate → open Library → pick the source tab → find the
 * item → Use image, once per handoff. `Continue from last frame` was the single
 * place the app understood that output becomes input; this is that
 * understanding applied everywhere else.
 *
 * Actions are offered by what the result *is* and where the host can actually
 * go, never by a flag the caller has to remember to set correctly.
 */
export default function ResultActions({
  kind,
  src,
  filenameBase,
  referenceLimit = 8,
  onUseAsFirstFrame,
  onAddToTimeline,
  dense = false,
  stack = false,
}: ResultActionsProps) {
  const [pending, setPending] = useState<Action | null>(null);
  // Resolved bytes, keyed by source. Extraction is the expensive step, so using
  // two actions on one result — or retrying after a failure — refetches
  // nothing. Same bargain `LastFrameActions.ensureFrame` makes.
  const resolved = useRef<{ src: string; blob: Blob } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const ensureImage = async () => {
    if (resolved.current?.src === src) return resolved.current.blob;
    const blob = await resolveResultImage(src, kind);
    resolved.current = { src, blob };
    return blob;
  };

  const run = async (action: Action, task: () => Promise<void>) => {
    if (pending) return;
    setPending(action);
    try {
      await task();
    } catch (error) {
      // A toast, not an inline line: these rows sit inside scrolled panels
      // where an alert written above the fold is invisible at the moment it
      // appears, which reads as a button that does nothing.
      toast.error(error instanceof Error && error.message ? error.message : HANDOFF_ERROR);
    } finally {
      if (mounted.current) setPending(null);
    }
  };

  const label = kind === 'video' ? 'last frame' : 'image';

  const applyAsReference = () =>
    run('reference', async () => {
      await sendResultToReferences(await ensureImage(), {
        filenameBase,
        kind,
        sourceLabel: `From ${filenameBase}`,
        limit: referenceLimit,
      });
      toast.success('Added as a reference');
    });

  const applyAsFirstFrame = () =>
    run('first-frame', async () => {
      sendResultToFirstFrame(await ensureImage(), {
        filenameBase,
        kind,
        sourceLabel: filenameBase,
      });
      onUseAsFirstFrame?.();
    });

  const addToTimeline = () => run('timeline', async () => { await onAddToTimeline?.(); });

  const size = dense ? 13 : 15;
  const buttonClass = `btn-secondary flex flex-1 items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
    dense ? 'px-2 py-1 text-xs' : 'py-2 text-xs'
  }${stack ? ' @lg:w-full @lg:flex-none' : ''}`;
  const spinner = <Loader2 className="animate-spin motion-reduce:animate-none" size={size} aria-hidden="true" />;

  return (
    <div className={`flex flex-wrap gap-2${stack ? ' @lg:flex-col @lg:flex-nowrap' : ''}`}>
      <button
        type="button"
        onClick={() => void applyAsReference()}
        disabled={pending !== null}
        className={buttonClass}
      >
        {pending === 'reference' ? spinner : <ImageDown size={size} aria-hidden="true" />}
        {pending === 'reference' ? `Reading ${label}…` : 'Use as reference'}
      </button>

      {onUseAsFirstFrame && (
        <button
          type="button"
          onClick={() => void applyAsFirstFrame()}
          disabled={pending !== null}
          className={buttonClass}
        >
          {pending === 'first-frame' ? spinner : <SquarePlay size={size} aria-hidden="true" />}
          {pending === 'first-frame' ? `Reading ${label}…` : 'Use as first frame'}
        </button>
      )}

      {kind === 'video' && onAddToTimeline && (
        <button
          type="button"
          onClick={() => void addToTimeline()}
          disabled={pending !== null}
          className={buttonClass}
        >
          {pending === 'timeline' ? spinner : <Film size={size} aria-hidden="true" />}
          {pending === 'timeline' ? 'Adding…' : 'Add to timeline'}
        </button>
      )}
    </div>
  );
}
