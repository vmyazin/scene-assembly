'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Clipboard, Film, ImageDown, Loader2 } from 'lucide-react';

import { FRAME_EXTRACTION_ERROR } from '@/lib/video-frame';
import { useLastFrame } from '@/lib/use-last-frame';

interface LastFrameActionsProps {
  videoUrl: string;
  /** Slug the clip was named with; the frame is saved alongside it. */
  filenameBase: string;
  /**
   * Switch the workspace into image-to-video. Provided only where a follow-on
   * clip is possible; the frame itself is handed over via the seed store.
   */
  onContinue?: () => void;
}

/**
 * Save or copy the closing frame of a finished clip. Extraction is cached per
 * URL so using both buttons, or retrying, refetches nothing.
 */
export default function LastFrameActions({
  videoUrl,
  filenameBase,
  onContinue,
}: LastFrameActionsProps) {
  const [pending, setPending] = useState<'save' | 'copy' | 'continue' | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useLastFrame(videoUrl, filenameBase);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = async (action: 'save' | 'copy' | 'continue', task: () => Promise<void>) => {
    if (pending) return;
    setPending(action);
    setError(null);
    setCopied(false);
    try {
      await task();
      if (action === 'copy' && mountedRef.current) setCopied(true);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof Error && caught.message ? caught.message : FRAME_EXTRACTION_ERROR);
    } finally {
      if (mountedRef.current) setPending(null);
    }
  };

  const save = () => run('save', frame.save);

  const copy = () => run('copy', frame.copy);

  const continueFrom = () =>
    run('continue', async () => {
      await frame.seed();
      onContinue?.();
    });

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending !== null}
          className="btn-secondary flex-1"
        >
          {pending === 'save' ? <Loader2 className="animate-spin" size={15} /> : <ImageDown size={15} />}
          {pending === 'save' ? 'Reading frame…' : 'Save last frame'}
        </button>
        {frame.copySupported && (
          <button
            type="button"
            onClick={() => void copy()}
            disabled={pending !== null}
            className="btn-secondary flex-1"
          >
            {pending === 'copy' ? (
              <Loader2 className="animate-spin" size={15} />
            ) : copied ? (
              <Check size={15} className="text-emerald-400" />
            ) : (
              <Clipboard size={15} />
            )}
            {pending === 'copy' ? 'Reading frame…' : copied ? 'Copied' : 'Copy last frame'}
          </button>
        )}
      </div>
      {onContinue && (
        <button
          type="button"
          onClick={() => void continueFrom()}
          disabled={pending !== null}
          className="btn-secondary w-full"
        >
          {pending === 'continue' ? <Loader2 className="animate-spin" size={15} /> : <Film size={15} />}
          {pending === 'continue' ? 'Reading frame…' : 'Continue from last frame'}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
