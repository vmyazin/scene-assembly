// components/MicroAiUsagePanel.tsx
'use client';

import { Check, Cpu } from 'lucide-react';

import { formatUsd } from '@/lib/spend/format';
import { PRICING_NOTE } from '@/lib/micro-ai/models';
import { useMicroAiUsageStore } from '@/store/useMicroAiUsageStore';
import { StatusPill } from '@/components/StatusPill';

/**
 * Read-only telemetry for the shared micro-AI tier that names downloads,
 * writes example prompts, and describes a source. Deliberately not a quota:
 * these numbers inform, they do not gate.
 */
export default function MicroAiUsagePanel() {
  const requests = useMicroAiUsageStore((state) => state.requests);
  const costUsd = useMicroAiUsageStore((state) => state.costUsd);

  // Nothing is probed on open: the tier proves itself by serving a request, so
  // the badge appears once one has been billed to it this session.
  const active = requests > 0;

  return (
    <section className="space-y-2.5">
      <h3 className="field-label flex flex-wrap items-center gap-2">
        <Cpu size={22} className="text-[var(--foreground-muted)]" /> Shared fast tier
        {active && (
          <StatusPill tone="success">
            <Check size={13} /> Active
          </StatusPill>
        )}
      </h3>
      <p className="field-hint">
        {active
          ? 'Filenames, example prompts, and source descriptions are running on the shared fast tier at no cost to you.'
          : 'Filenames, example prompts, and source descriptions run on a shared model, or on your Gemini key.'}
      </p>

      {/* Two figures, not three: what ran and what it would have cost. The raw
          token count measured the same thing in a unit nobody spends. */}
      {requests > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background-elevated)]/60 p-3">
          <dl className="grid grid-cols-2 gap-2 text-center">
            <div>
              <dt className="text-[0.8125rem] text-[var(--foreground-muted)]">Requests</dt>
              <dd className="font-mono text-sm text-[var(--foreground)]">{requests}</dd>
            </div>
            <div>
              <dt className="text-[0.8125rem] text-[var(--foreground-muted)]">Est. cost</dt>
              <dd className="font-mono text-sm text-[var(--foreground)]">{formatUsd(costUsd)}</dd>
            </div>
          </dl>
          <p className="mt-2.5 text-center text-[0.8125rem] text-[var(--foreground-muted)]">
            This session only. {PRICING_NOTE}
          </p>
        </div>
      )}
    </section>
  );
}
