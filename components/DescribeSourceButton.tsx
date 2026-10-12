// components/DescribeSourceButton.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, ScanSearch } from 'lucide-react';

import { requestSourceDescription, type DescribeSourceInput } from '@/lib/describe-source/browser';
import { DESCRIBE_ERRORS, describeOmittedNotice } from '@/lib/describe-source/errors';

function sourceKey(sources: DescribeSourceInput[]): string {
  return sources
    .map((source) => `${source.label}:${source.file.name}:${source.file.size}:${source.file.lastModified}`)
    .join('|');
}

function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === 'AbortError';
}

/**
 * Sends the selected source to a vision model and writes the description into
 * the prompt. The prompt stays an ordinary field afterwards, so the reader
 * can edit it before generating.
 *
 * Neutral, like Saved prompts: Gen Example is the header's one accent, and a
 * second lit button in the same row competes with it.
 *
 * A response is dropped when the source changed, or the prompt changed, during
 * the wait. Unmounting aborts the fetch. A mounted flag is not the guard:
 * React re-runs effect cleanup in development and the flag never comes back.
 */
export default function DescribeSourceButton({
  sources,
  apiKey,
  prompt,
  disabled = false,
  onPrompt,
  onError,
  onNotice,
  onBusyChange,
}: {
  sources: DescribeSourceInput[];
  apiKey: string;
  prompt: string;
  disabled?: boolean;
  onPrompt: (prompt: string) => void;
  onError: (message: string) => void;
  onNotice?: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const promptRef = useRef(prompt);
  const hasSource = sources.length > 0;
  const key = sourceKey(sources);
  const keyRef = useRef(key);

  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [key]);

  const describe = async () => {
    if (!hasSource || busy || disabled) return;
    const id = ++requestId.current;
    const promptAtClick = promptRef.current;
    const keyAtClick = key;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await requestSourceDescription(sources, apiKey, { signal: controller.signal });
      if (id !== requestId.current || controller.signal.aborted) return;
      if (keyRef.current !== keyAtClick) return;
      if (promptRef.current !== promptAtClick) {
        onNotice?.('The description was not applied because the prompt changed.');
        return;
      }
      onPrompt(result.prompt);
      if (result.omitted.length > 0) onNotice?.(describeOmittedNotice(result.omitted));
    } catch (caught) {
      if (id !== requestId.current || controller.signal.aborted || isAbortError(caught)) return;
      const text = caught instanceof Error && caught.message ? caught.message : DESCRIBE_ERRORS.failed;
      onError(text);
    } finally {
      if (id !== requestId.current) return;
      if (abortRef.current === controller) abortRef.current = null;
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
