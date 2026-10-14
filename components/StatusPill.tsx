// components/StatusPill.tsx
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import JobElapsed from '@/components/JobElapsed';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

/** One colour per meaning, shared with ConfidenceBadge so "exact" and "done" match. */
export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  danger: 'border-red-500/30 bg-red-500/10 text-red-300',
  neutral: 'border-[var(--border)] bg-[var(--background-elevated)] text-[var(--foreground-muted)]',
};

const SIZE_CLASSES = {
  sm: 'gap-1 px-1.5 py-px font-medium',
  md: 'gap-1.5 px-2.5 py-1',
} as const;

export function StatusPill({
  tone,
  size = 'sm',
  title,
  children,
}: {
  tone: StatusTone;
  size?: keyof typeof SIZE_CLASSES;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border text-xs ${SIZE_CLASSES[size]} ${STATUS_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A job's state and how long it has run, as every result panel shows it. The
 * label is its own element so a reader — and a test — can match it exactly.
 */
export function JobStatusPill({
  tone,
  label,
  startedAt,
  finishedAt,
  spinner = false,
}: {
  tone: StatusTone;
  label: string;
  startedAt: number;
  /** Set once the job is terminal, which stops the clock. */
  finishedAt?: number;
  /** For a panel where the pill is the only sign polling is still alive. */
  spinner?: boolean;
}) {
  return (
    <StatusPill tone={tone} size="md">
      {spinner && <Loader2 aria-hidden className="animate-spin" size={12} />}
      <span>{label}</span>
      <span aria-hidden="true">·</span>
      <JobElapsed startedAt={startedAt} finishedAt={finishedAt} />
    </StatusPill>
  );
}
