'use client';

import { useState } from 'react';
import type { CloudJobView } from '@/lib/account/contracts';
import { canResumeJob, describeFailure, failureNextStep, MAX_RESUME_ATTEMPTS, resumeAttempts } from '@/lib/account/job-failure';

/** No raw requests, media addresses or signed links in a support report. The
 * prompt stays available in the disclosure but is not copied automatically. */
export default function JobFailureDetails({ job }: { job: CloudJobView }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const failure = describeFailure(job);
  const attempts = resumeAttempts(job);
  const providerMessage = job.failureReason === 'provider_rejected' || job.failureReason === 'provider_policy';
  const fields = [
    ['Job reference', job.id],
    ['Provider / model', `${job.provider} / ${job.request.modelId}`],
    ['State', job.state],
    ['Reason', job.failureReason ?? 'Not recorded'],
    ['Error code', job.errorCode ?? 'Not recorded'],
    ['Started', new Date(job.createdAt).toISOString()],
    ['Last update', new Date(job.updatedAt).toISOString()],
    ['Resumes', String(resumeAttempts(job))],
  ];
  const detail = job.failureDetail || 'No additional error detail was recorded for this job.';
  async function copy() {
    try {
      await navigator.clipboard.writeText([
        'Scene Assembly job issue', ...fields.map(([label, value]) => `${label}: ${value}`),
        `Summary: ${failure.sentence}`, `${providerMessage ? 'Provider message' : 'Recorded error'}: ${detail}`,
        `Next step: ${failureNextStep(job)}`,
      ].join('\n'));
      setCopyState('copied');
    } catch { setCopyState('error'); }
  }
  return <details className="mt-3 border-t border-[var(--border)] pt-2 text-xs text-[var(--foreground-muted)]">
    <summary className="cursor-pointer select-none py-1 text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-cyan-300">Issue details</summary>
    <div className="mt-2 space-y-3">
      <div><p>{failure.sentence}</p><p className="mt-1">{failureNextStep(job)}</p></div>
      {attempts>0&&<p>Resumed {attempts===1?'once':`${attempts} times`} already{job.state==='needs_attention'&&failure.resumable&&!canResumeJob(job)?` — the limit is ${MAX_RESUME_ATTEMPTS}`:''}.</p>}
      <div><p className="font-semibold">{providerMessage ? 'Provider message' : 'Recorded error'}</p><p className="mt-1 break-words">{providerMessage?`The provider said: “${detail}”`:detail}</p></div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {fields.map(([label, value]) => <div key={label} className="contents"><dt>{label}</dt><dd className="select-text break-all text-[var(--foreground)]">{value}</dd></div>)}
      </dl>
      <div><p className="font-semibold">Full prompt</p><p className="mt-1 whitespace-pre-wrap break-words">{job.request.prompt || 'No prompt supplied.'}</p></div>
      <button type="button" onClick={() => void copy()} className="text-sky-200 underline underline-offset-4">Copy issue details</button>
      <p role="status">{copyState === 'copied' ? 'Copied. Prompt and download links are not included.' : copyState === 'error' ? 'Could not copy. Select the details above to copy them manually.' : 'The copy includes diagnostic details, without your prompt or download links.'}</p>
    </div>
  </details>;
}
