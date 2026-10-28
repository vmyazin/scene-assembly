// components/VideoResult.tsx
import type { ReactNode } from 'react';
import { Download, Loader2, Video } from 'lucide-react';

import JobElapsed from '@/components/JobElapsed';
import LastFrameActions from '@/components/LastFrameActions';
import VideoPlayer from '@/components/video/VideoPlayer';
import ResultRating from '@/components/ResultRating';
import type { RatingTarget } from '@/lib/results/rating';

const ACCENT = {
  cyan: 'text-[var(--neon-cyan)]',
  purple: 'text-[var(--neon-purple)]',
} as const;

/**
 * The latest video's stage in a result panel: the clip once it lands, a
 * working state while the job runs, the error when it failed, and an empty
 * placeholder before anything has run.
 */
export function VideoResultStage({
  resultUrl,
  working,
  error,
  accent,
}: {
  resultUrl?: string;
  /** Set while the latest job is still running. */
  working?: { label: string; startedAt: number; progress?: number };
  /** Set when the latest job failed. */
  error?: ReactNode;
  accent: keyof typeof ACCENT;
}) {
  return (
    <div className="flex min-h-[300px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]/70">
      {resultUrl ? (
        <VideoPlayer src={resultUrl} label="Generated video" className="h-full max-h-[520px] w-full" />
      ) : working ? (
        <div className="space-y-3 p-5 text-center">
          <Loader2 className={`mx-auto animate-spin ${ACCENT[accent]}`} size={34} />
          <p className="text-sm text-[var(--foreground-muted)]">
            {working.label}{' '}
            {/* From the job's `createdAt`, so it counts the queue too and
                survives a reload — the wait a person actually feels. */}
            <JobElapsed startedAt={working.startedAt} className="text-[var(--foreground)]" />
          </p>
          {typeof working.progress === 'number' && (
            <p className={`font-mono text-xs ${ACCENT[accent]}`}>{Math.round(working.progress * 100)}%</p>
          )}
        </div>
      ) : error ? (
        <p className="max-w-sm p-5 text-center text-sm text-red-300">{error}</p>
      ) : (
        <div className="p-5 text-center text-[var(--foreground-muted)]">
          <Video className="mx-auto mb-3 opacity-35" size={46} />
          <p>Your generated video will appear here.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Download for a finished clip. Results are served cross-origin, where the
 * `download` attribute is ignored, so the click fetches the bytes instead and
 * the file keeps its readable name.
 */
export function VideoDownloadLink({
  href,
  filename,
  busy,
  label,
  onDownload,
}: {
  href: string;
  filename: string;
  busy: boolean;
  label: string;
  onDownload: () => void;
}) {
  return (
    <a
      href={href}
      download={filename}
      onClick={(event) => {
        event.preventDefault();
        onDownload();
      }}
      className="btn-secondary w-full"
    >
      {busy ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
      {busy ? 'Preparing download…' : label}
    </a>
  );
}

/**
 * What a finished clip offers under its stage: its rating, the download,
 * anything the provider adds (a draft's Finalize), then "Continue from last
 * frame". The rating leads because it is the judgement made while watching.
 */
export function FinishedVideoActions({
  url,
  filenameBase,
  extension,
  busy,
  label = 'Download video',
  onDownload,
  onContinueFromFrame,
  rating,
  children,
}: {
  url: string;
  filenameBase: string;
  extension: string;
  busy: boolean;
  label?: string;
  onDownload: () => void;
  onContinueFromFrame?: () => void;
  /** Where the clip's rating is kept, once it is filed in a library. */
  rating?: RatingTarget;
  children?: ReactNode;
}) {
  return (
    <>
      {rating && <ResultRating target={rating} />}
      <VideoDownloadLink href={url} filename={`${filenameBase}.${extension}`} busy={busy} label={label} onDownload={onDownload} />
      {children}
      <LastFrameActions videoUrl={url} filenameBase={filenameBase} onContinue={onContinueFromFrame} />
    </>
  );
}
