// components/DescribeSourceButton.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, ScanSearch } from 'lucide-react';

import { requestSourceDescription, type DescribeSourceInput } from '@/lib/describe-source/browser';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';

/**
 * Sends the selected source to a vision model and writes the description into
 * the prompt. The prompt stays an ordinary field afterwards, so the reader
 * can edit it before generating.
 *
 * Neutral, like Saved prompts: Gen Example is the header's one accent, and a
 * second lit button in the same row competes with it.
 */
export default function DescribeSourceButton({
  sources,
  apiKey,
  disabled = false,
  onPrompt,
  onError,
  onBusyChange,
}: {
  sources: DescribeSourceInput[];
  apiKey: string;
  disabled?: boolean;
  onPrompt: (prompt: string) => void;
  onError: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const hasSource = sources.length > 0;

  // A late answer after the panel goes away must not write the prompt. The
  // counter is the guard. A mounted flag set from effect cleanup is not: React
  // re-runs that cleanup in development and the flag never comes back.
  useEffect(() => () => {
    requestId.current += 1;
  }, []);

  const describe = async () => {
    if (!hasSource || busy || disabled) return;
    const id = ++requestId.current;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const prompt = await requestSourceDescription(sources, apiKey);
      if (id !== requestId.current) return;
      onPrompt(prompt);
    } catch (caught) {
      if (id !== requestId.current) return;
      const text = caught instanceof Error && caught.message ? caught.message : DESCRIBE_ERRORS.failed;
      onError(text);
    } finally {
      if (id !== requestId.current) return;
      onBusyChange?.(false);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void describe()}
      disabled={!hasSource || busy || disabled}
      aria-busy={busy}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground-muted)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
      title={
        hasSource
          ? 'Describe the selected source and fill the prompt. You can edit the result before generating.'
          : DESCRIBE_ERRORS.empty
      }
    >
      {busy ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <ScanSearch size={14} aria-hidden="true" />}
      {busy ? 'Describing…' : <span className="sr-only sm:not-sr-only">Describe source</span>}
    </button>
  );
}
