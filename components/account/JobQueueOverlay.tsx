'use client';
import Link from 'next/link';
import { TriangleAlert, X } from 'lucide-react';
import { useAccountStore } from '@/store/useAccountStore';
import { useJobQueueStore } from '@/store/useJobQueueStore';
import { jobSummary } from '@/lib/account/job-label';
import { assetForJob, libraryHashForAsset, studioLocationForJob } from '@/lib/account/job-location';
import { JOB_STATE_LABELS, JOB_STATE_TONES, awaitingDecision, isActiveJob, isSucceededJob, needsAttention } from '@/lib/account/job-status';
import type { CloudAsset, CloudJobView } from '@/lib/account/contracts';
import JobElapsed, { hasElapsed } from '@/components/JobElapsed';

const LIMIT = 5;

/** A standing answer to "is anything still running?" for background jobs, which
 *  by design outlive the page that started them — the workspace rail that
 *  reported them is one navigation away from being gone.
 *
 *  Awareness only: cancel, resume and stop-tracking live in CloudJobList on
 *  /account, where they have the confirmation they need. Desktop only for now;
 *  a fixed corner card is the wrong shape for a phone.
 *
 *  The card earns its size only while something is actually in flight. A job
 *  that needs a person does not resolve on its own and `dismissed` is per-tab,
 *  so the list used to rebuild itself on every reload and follow the reader
 *  across every page for the rest of the run — a standing widget they learn to
 *  ignore, which is the worst possible home for "the provider may have charged
 *  for this". With nothing running it collapses to a count that points at the
 *  one place those jobs can be resumed, cancelled or stopped.
 */
export default function JobQueueOverlay() {
  const jobs = useAccountStore(state => state.jobs);
  const assets = useAccountStore(state => state.assets);
  const dismissed = useJobQueueStore(state => state.dismissed);
  const dismiss = useJobQueueStore(state => state.dismiss);
  /** What keeps the card on screen: work in flight, or work waiting on a person.
   *  Succeeded jobs are deliberately not part of this — they are context for a
   *  run in progress, not a receipt that follows the reader around after it. */
  const alive = jobs.filter(job => !dismissed.includes(job.id) && (isActiveJob(job) || needsAttention(job)));
  const succeeded = jobs.filter(job => !dismissed.includes(job.id) && isSucceededJob(job));
  if (!alive.length) return null;
  /** The alarm counts decisions, not records. A job that already failed or was
   *  stopped needs nothing from anyone here — it only needs clearing, on the
   *  page this links to — and counting those alongside real decisions is how
   *  five of them became a standing "11 jobs need attention" badge. */
  const decisions = alive.filter(awaitingDecision);

  // Nothing is in flight, so there is no progress to report — only unfinished
  // business, which belongs where it can be settled rather than in a corner.
  // Finished work is not counted here: it needs nothing from anyone.
  if (!alive.some(isActiveJob)) {
    // Stopped records alone are not an alarm worth following someone around.
    if (!decisions.length) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Job queue"
        className="fixed bottom-4 right-4 z-40 hidden md:block"
      >
        <Link
          href="/account#jobs"
          className="flex items-center gap-2 rounded-full border border-amber-300/30 bg-[var(--surface-overlay)] px-3 py-1.5 text-xs text-amber-200 shadow-lg transition-colors hover:border-amber-300/60 hover:text-amber-100"
        >
          <TriangleAlert size={13} aria-hidden="true" />
          {decisions.length} job{decisions.length === 1 ? '' : 's'} need
          {decisions.length === 1 ? 's' : ''} attention
        </Link>
      </div>
    );
  }

  /** Unfinished business first, then what is done. The list is capped, and a
   *  run of four images would otherwise push the one still generating off the
   *  bottom behind three finished rows — which is the opposite of what the card
   *  is for. */
  const shown = [...alive, ...succeeded];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Job queue"
      className="fixed bottom-4 right-4 z-40 hidden w-72 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] p-3.5 shadow-lg md:block"
    >
      <Link href="/account" className="display text-sm font-semibold hover:text-[var(--neon-cyan)]">
        Job Queue
      </Link>
      <ul className="mt-2 space-y-1.5">
        {shown.slice(0, LIMIT).map(job => (
          <li key={job.id} className="flex items-center justify-between gap-2 text-xs">
            <JobRow job={job} assets={assets} />
            {needsAttention(job) && (
              <button
                type="button"
                onClick={() => dismiss(job.id)}
                aria-label={`Dismiss ${jobSummary(job.request)}`}
                title="Hide from this list. The job is not cancelled."
                className="shrink-0 text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)]"
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {shown.length > LIMIT && (
        <Link href="/account" className="mt-2 block text-xs text-[var(--foreground-muted)] underline underline-offset-2">
          +{shown.length - LIMIT} more
        </Link>
      )}
    </div>
  );
}

/**
 * One row: what was asked for, what state it is in, and how long it has taken.
 *
 * Where it points depends on which of those it is. A job still running is only
 * ever going to appear in one place — the studio form it was started from,
 * whose `CloudJobPanel` already holds its spinner — so the row goes back there.
 * A saved job's run is over and the answer is the asset, so the row goes to the
 * library and names which card. Work waiting on a person is settled on
 * /account, which the card's own heading already reaches, and it carries a
 * dismiss button of its own, so it stays plain text rather than becoming a
 * third kind of link inside one row.
 */
function JobRow({ job, assets }: { job: CloudJobView; assets: CloudAsset[] }) {
  const label = job.state === 'failed' && job.errorCode === 'tracking_stopped' ? 'Tracking stopped' : JOB_STATE_LABELS[job.state];
  const finishedAt = isActiveJob(job) ? undefined : job.updatedAt;
  // The separator belongs to the clock, not to the state: a job that finished
  // inside a second has no duration to report, and `Saved ·` reads as a row
  // that was cut off mid-sentence.
  const timed = hasElapsed(job.createdAt, finishedAt);
  const body = (
    <>
      <span className="truncate text-[var(--foreground-muted)]">{jobSummary(job.request)}</span>
      <span className="flex shrink-0 items-center gap-1">
        <span className={JOB_STATE_TONES[job.state]}>
          <span>{label}</span>
          {timed && <span aria-hidden="true">{' · '}</span>}
          <JobElapsed startedAt={job.createdAt} finishedAt={finishedAt} />
        </span>
      </span>
    </>
  );

  if (isSucceededJob(job)) {
    // Without the asset loaded the library is still the right room, just
    // without a card to point at — better than a row that does nothing.
    const asset = assetForJob(job, assets);
    return (
      <Destination href={asset ? libraryHashForAsset(asset.id) : '/account'} say="show it in your cloud library">
        {body}
      </Destination>
    );
  }
  if (isActiveJob(job)) {
    const location = studioLocationForJob(job.request);
    if (location) {
      return (
        <Destination href={location.href} onClick={location.select} say="open the form it was started from">
          {body}
        </Destination>
      );
    }
  }
  return <span className="flex min-w-0 flex-1 items-center justify-between gap-2">{body}</span>;
}

/** The link shape a row takes. The destination is spoken rather than set as an
 *  `aria-label`, which would replace the row's own text and take the elapsed
 *  time with it — the one thing on the row that a reader watching a long job
 *  actually wants read out. */
function Destination({ href, onClick, say, children }: { href: string; onClick?: () => void; say: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded transition-colors hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--neon-cyan)]"
    >
      {children}
      <span className="sr-only">— {say}</span>
    </Link>
  );
}
