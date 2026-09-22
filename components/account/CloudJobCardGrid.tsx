'use client';

import Link from 'next/link';
import { Film, Image as ImageIcon } from 'lucide-react';

import JobElapsed from '@/components/JobElapsed';
import type { CloudJobState, CloudJobView } from '@/lib/account/contracts';
import { jobModelLabel } from '@/lib/account/job-label';
import { studioLocationForJob } from '@/lib/account/job-location';
import { JOB_STATE_LABELS, JOB_STATE_TONES } from '@/lib/account/job-status';
import { libraryGridClass } from './library-grid';

/**
 * The stages a background job passes through, as the only progress we can state
 * honestly. No provider in the catalog reports a percentage, so the bar steps
 * through the states the Worker does tell us and a travelling highlight says it
 * is still live — a fabricated 43% would be the one number on this card that is
 * not true. The widths are ordered, not measured: the point is that the bar
 * moves forward when something changes and holds still when nothing has.
 *
 * Colour follows `JOB_STATE_TONES` rather than a fixed accent, so a card that
 * has reached the provider looks different from one still in the queue at a
 * glance, and it matches the word printed right above it.
 */
const STAGES: Record<Exclude<CloudJobState, 'saved' | 'needs_attention' | 'failed' | 'cancelled'>, { width: string; fill: string; say: string }> = {
  queued: { width: '12%', fill: 'bg-sky-300', say: 'Waiting for a free slot.' },
  submitting: { width: '34%', fill: 'bg-sky-300', say: 'Handing the request to the provider.' },
  running: { width: '68%', fill: 'bg-violet-300', say: 'The provider is working on it.' },
  saving: { width: '90%', fill: 'bg-cyan-300', say: 'Saving the result to your library.' },
};

/**
 * Jobs still in flight, drawn as the cards they are about to become.
 *
 * They sit in the same library as the finished work and used to arrive as a
 * text row, which put a list and a grid behind two pills of one filter: the
 * reader had to re-read the page to find out that the thing they started is on
 * it. The card carries everything already known — the prompt, the model, the
 * media type — in the same places `CloudAssetGrid` puts them, so when the job
 * saves, the card it becomes is the one that was already there.
 *
 * Only for `isActiveJob` states. A job waiting on a person is a paragraph of
 * explanation and two decisions, which is `CloudJobList`'s shape, not this one.
 */
export default function CloudJobCardGrid({
  jobs,
  columns = 4,
  busy = false,
  onCancel,
}: {
  jobs: CloudJobView[];
  columns?: 2 | 4;
  busy?: boolean;
  onCancel?: (id: string) => void;
}) {
  if (!jobs.length) return null;
  return (
    <ul className={libraryGridClass(columns)}>
      {jobs.map(job => (
        <CloudJobCard key={job.id} job={job} busy={busy} onCancel={onCancel} />
      ))}
    </ul>
  );
}

function CloudJobCard({ job, busy, onCancel }: { job: CloudJobView; busy: boolean; onCancel?: (id: string) => void }) {
  const stage = STAGES[job.state as keyof typeof STAGES] ?? STAGES.running;
  const label = JOB_STATE_LABELS[job.state];
  const tone = JOB_STATE_TONES[job.state];
  const prompt = job.request.prompt || 'Untitled generation';
  const Mark = job.request.mediaType === 'video' ? Film : ImageIcon;
  // Where this job's own spinner lives. Same answer the queue overlay gives, so
  // a card and a row clicked a minute apart land in the same place.
  const location = studioLocationForJob(job.request);
  return (
    <li className="space-y-2.5 rounded-xl border border-sky-300/30 bg-[var(--background-elevated)]/80 p-2.5">
      {/* The well stands in for the thumbnail that does not exist yet, at the
          same aspect ratio the finished card will use, so the grid does not
          reflow when the result lands. */}
      <div className="relative flex aspect-video flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-black/40">
        <span aria-hidden="true" className="job-card-sheen" />
        <Mark size={22} aria-hidden="true" className={`job-card-mark ${tone}`} />
        <span className="relative flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]">
          <span className={tone}>{label}</span>
          <JobElapsed className="text-[var(--foreground-muted)]" startedAt={job.createdAt} />
        </span>
        {/* Indeterminate on purpose: no `aria-valuenow`, because there is no
            honest one to give. `aria-valuetext` carries the stage instead. */}
        <div
          role="progressbar"
          aria-label={`Progress of “${prompt}”`}
          aria-valuetext={`${label}. ${stage.say}`}
          className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10"
        >
          <span className={`job-card-stage ${stage.fill}`} style={{ width: stage.width }} />
        </div>
      </div>
      <div>
        <p className="line-clamp-2 text-[0.8125rem] font-medium leading-snug text-[var(--foreground)]">{prompt}</p>
        {/* The same three facts in the same place as a saved card's meta line —
            provider, media type, and what made it — with the model named rather
            than left as a vendor id. */}
        <p className="mt-1 text-[0.625rem] text-sky-200">
          {job.provider} · {job.request.mediaType} · {jobModelLabel(job.provider, job.request.modelId)}
        </p>
        <p className="mt-1 text-[0.625rem] text-[var(--foreground-subtle)]">{stage.say}</p>
      </div>
      {(location || (job.state === 'queued' && onCancel)) && (
        <div className="flex flex-wrap gap-1.5">
          {location && (
            <Link href={location.href} onClick={location.select} className="btn-secondary px-2 py-1 text-xs">
              Open the studio form
            </Link>
          )}
          {/* Unconfirmed, like the list's own cancel: nothing has been charged
              for a job the provider has not been handed yet. */}
          {job.state === 'queued' && onCancel && (
            <button type="button" disabled={busy} onClick={() => onCancel(job.id)} className="btn-secondary px-2 py-1 text-xs disabled:opacity-50">
              Cancel
            </button>
          )}
        </div>
      )}
    </li>
  );
}
