// components/ResultPanel.tsx
import type { ReactNode } from 'react';
import { JobStatusPill, type StatusTone } from '@/components/StatusPill';

export interface ResultPanelStatus {
  tone: StatusTone;
  label: string;
  startedAt: number;
  /** Set once the job is terminal, which stops the clock. */
  finishedAt?: number;
  spinner?: boolean;
}

/**
 * A browser-run workspace's `results` slot: a title, the producing model and
 * the latest job's state, then whatever the provider shows for its output.
 * The model is read from the job, not the picker, because the selection
 * configures the next run and must not relabel the last one.
 */
export default function ResultPanel({
  title = 'Result',
  description = 'Results are temporary — download anything you want to keep.',
  modelLabel,
  status,
  children,
}: {
  title?: string;
  description?: ReactNode;
  modelLabel?: string;
  status?: ResultPanelStatus;
  children: ReactNode;
}) {
  return (
    <section className="glass-card flex min-h-[420px] flex-col gap-4 p-3.5 md:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="display text-base font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">{description}</p>
          {modelLabel && <p className="mt-0.5 text-xs text-[var(--foreground-subtle)]">{modelLabel}</p>}
        </div>
        {status && <JobStatusPill {...status} />}
      </div>
      {children}
    </section>
  );
}
