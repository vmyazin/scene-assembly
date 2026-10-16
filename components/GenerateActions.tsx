// components/GenerateActions.tsx
'use client';

import type { ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import CloudExecutionNotice from '@/components/account/CloudExecutionNotice';
import SubmissionError from '@/components/SubmissionError';
import type { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
import { refusalPresentation, type RefusalContext } from '@/lib/moderation/classify';
import type { useRelaxedFilter } from '@/lib/moderation/use-relaxed-filter';
import type { AutoRetry } from '@/lib/providers/auto-retry';

/**
 * A provider workspace's `actions` slot: the generate button, where the run
 * happens, and why the last press failed. One block so every provider reads
 * the same press the same way — the retry countdown, the "try Relaxed" offer
 * and the simulation label used to drift between workspaces.
 */
export default function GenerateActions({
  workspace,
  mediaType,
  label,
  cost,
  note,
  busy,
  busyLabel,
  onSubmit,
  error,
  refusal,
  relaxed,
  autoRetry,
}: {
  workspace: ReturnType<typeof useCloudWorkspace>;
  mediaType: 'image' | 'video';
  /** "Generate video", "Generate edit". */
  label: string;
  /** The run's price after the label; hidden for a simulation, which costs nothing. */
  cost?: ReactNode;
  /** A line under the button, for a workspace that prices the run there instead. */
  note?: ReactNode;
  busy: boolean;
  busyLabel: ReactNode;
  onSubmit: () => void;
  error: string | null;
  /** How a refused run is explained; the moderation level comes from `relaxed`. */
  refusal: Omit<RefusalContext, 'level'>;
  relaxed: ReturnType<typeof useRelaxedFilter>;
  autoRetry: AutoRetry;
}) {
  const simulated = workspace.cloud && workspace.fakeGeneration;
  const presentation = error ? refusalPresentation(error, { ...refusal, level: relaxed.effective }) : null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          // A deliberate press is a fresh start: it drops any queued attempt
          // and hands back the full retry budget.
          autoRetry.reset();
          onSubmit();
        }}
        disabled={busy || workspace.checking}
        // A disabled control has to carry its own reason: the submit guard for
        // this can only be reached programmatically, so for a pointer this
        // button going dead is the whole of the explanation on offer.
        title={workspace.checking ? 'Still checking your account.' : undefined}
        className="btn-primary w-full"
      >
        {busy ? (
          <>
            <Loader2 className="animate-spin" size={21} /> {busyLabel}
          </>
        ) : (
          <>
            <Sparkles size={21} /> {simulated ? `Run simulation · test ${mediaType} only` : label}
            {!simulated && cost}
          </>
        )}
      </button>
      {note}
      <CloudExecutionNotice workspace={workspace} />
      {error && (
        <SubmissionError
          message={presentation?.message ?? error}
          retry={autoRetry.pending}
          onCancelRetry={autoRetry.cancel}
          offerTryRelaxed={Boolean(presentation?.offerTryRelaxed && relaxed.offered)}
          onTryRelaxed={() => relaxed.requestRelaxed(onSubmit)}
        />
      )}
    </>
  );
}
