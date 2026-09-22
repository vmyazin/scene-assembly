'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { CloudJobView } from '@/lib/account/contracts';
import { JOB_STATE_LABELS as labels, JOB_STATE_TONES as tones, isActiveJob, isClearableJob, isRemovableJob } from '@/lib/account/job-status';
import { canResumeJob, describeFailure, MAX_RESUME_ATTEMPTS, resumeAttempts } from '@/lib/account/job-failure';
import JobElapsed from '@/components/JobElapsed';
const stopTrackingDescription='The provider may still finish and charge for this job. Scene Assembly will stop checking and saving new outputs, and this row will be removed from your list. Existing saved assets remain; temporary downloads keep their existing deadline. Check the provider history before starting another generation.';
/** Recovery is a read of what the provider already produced, not a resume:
 *  these adapters can find a staged output for a submission whose confirmation
 *  was lost, so the row offers a look before it offers giving up. */
const RECOVERABLE_IMAGE_PROVIDERS=['gemini','cloudflare','pollinations','comet'];
const canCheckForOutput=(job:CloudJobView)=>job.state==='needs_attention'&&job.errorCode==='submission_ambiguous'&&job.request.mediaType==='image'&&RECOVERABLE_IMAGE_PROVIDERS.includes(job.provider);
export default function CloudJobList({jobs,onResume,onCancel,onDismiss,onClear,busy=false,limit=5}:{jobs:CloudJobView[];onResume:(id:string)=>void;onCancel?:(id:string)=>void;onDismiss?:(id:string)=>void;onClear?:(jobs:CloudJobView[])=>void;busy?:boolean;limit?:number}) {
  const [dismissing,setDismissing]=useState<CloudJobView|null>(null);
  const [clearing,setClearing]=useState(false);
  if(!jobs.length)return null;
  const shown=jobs.slice(0,limit);
  // Only what is on screen. Clearing rows the list is not showing would be a
  // second, invisible deletion behind a button that names a visible count.
  // "Clearable" now spans both halves of the old two-step: a stopped row and a
  // row still waiting on a decision both end up gone, which is what someone
  // clicking a button that says "clear" is asking for. The dialog names the
  // charge risk because that is the part of it that is not reversible.
  const clearable=onClear?shown.filter(isClearableJob):[];
  const clearableWaiting=clearable.filter(job=>job.state==='needs_attention').length;
  return <>
    {clearable.length>1&&<div className="mb-2 flex justify-end"><button disabled={busy} type="button" onClick={()=>setClearing(true)} className="text-xs text-[var(--foreground-muted)] underline underline-offset-4 hover:text-[var(--foreground)] disabled:opacity-50">Clear {clearable.length} jobs from this list</button></div>}
    <ul className="space-y-2">{shown.map(job=>{
    const failure=job.state==='needs_attention'||job.state==='failed'?describeFailure(job):null;
    const attempts=resumeAttempts(job);
    return <li key={job.id} className="rounded-lg border border-[var(--border)] bg-[var(--background)]/40 p-3">
    <div className="flex items-center justify-between gap-3"><p className="truncate text-sm">{job.request.prompt}</p><div className="flex shrink-0 items-center gap-2"><span className={`text-xs font-semibold ${job.state==='failed'&&job.errorCode==='tracking_stopped'?'text-[var(--foreground-muted)]':tones[job.state]}`}>{job.state==='failed'&&job.errorCode==='tracking_stopped'?'Tracking stopped':labels[job.state]}</span>
      <JobElapsed className="text-xs text-[var(--foreground-muted)]" startedAt={job.createdAt} finishedAt={isActiveJob(job)?undefined:job.updatedAt}/>
      {/* Unconfirmed on purpose: this removes a finished record, while the saved
          asset and the spend entry it describes both stay. The destructive
          decision was the one already taken to stop tracking. */}
      {onClear&&isRemovableJob(job)&&<button disabled={busy} type="button" onClick={()=>onClear([job])} title="Remove from this list" aria-label={`Remove "${job.request.prompt}" from this list`} className="-mr-1 rounded p-1 text-[var(--foreground-subtle)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50 motion-reduce:transition-none"><X size={14} aria-hidden="true"/></button>}</div></div>
    {job.state==='queued'&&onCancel&&<button disabled={busy} type="button" onClick={()=>onCancel(job.id)} className="mt-2 text-xs text-sky-200 underline underline-offset-4">Cancel queued job</button>}
    {job.state==='needs_attention'&&failure&&<div className="mt-2 text-xs leading-relaxed text-amber-200">
      <p>{failure.sentence}</p>
      {/* The provider's words, marked as theirs. Everything else on this row is
          ours, and a vendor sentence rendered in our voice is how "prompt
          violates content policy" reads as the app's own judgement. */}
      {failure.detail&&<p className="mt-1 text-[var(--foreground-muted)]">The provider said: “{failure.detail}”</p>}
      {/* Attempts are stated rather than implied. Three identical failures with
          no counter on screen is what made resuming feel like the app was
          ignoring the click, instead of doing exactly what was asked.
          The limit is named only when it is what stopped the button: on a row
          whose cause could never be retried, blaming the cap would point at the
          wrong thing and imply a fourth attempt might have worked. */}
      {attempts>0&&<p className="mt-1 text-[var(--foreground-muted)]">Resumed {attempts===1?'once':`${attempts} times`} already{failure.resumable&&!canResumeJob(job)?` — the limit is ${MAX_RESUME_ATTEMPTS}`:''}.</p>}
      {canResumeJob(job)&&<button disabled={busy} type="button" onClick={()=>onResume(job.id)} className="mt-2 underline underline-offset-4">Resume existing job</button>}
    </div>}
    {canCheckForOutput(job)&&<button disabled={busy} type="button" onClick={()=>onResume(job.id)} className="mt-2 text-xs text-amber-200 underline underline-offset-4">Check for a saved output</button>}
    {/* One action, not two. Stopping tracking used to leave the row behind as
        "Tracking stopped" beside an X, which reads as a button that did
        nothing — rows sat that way for days. The decision being confirmed here
        is the irreversible one; clearing the record was never a second
        decision, only a second click. */}
    {job.state==='needs_attention'&&onDismiss&&<button disabled={busy} type="button" onClick={()=>setDismissing(job)} className="mt-2 block text-xs text-red-200 underline underline-offset-4">Stop tracking and remove</button>}
    {/* One line, not the paragraph this used to carry: a stopped job is a row in
        a list of stopped jobs, and the full explanation repeated on each one
        buried the prompts that tell them apart. The long form still runs in the
        confirm dialog, at the moment the decision is actually made. */}
    {job.state==='failed'&&failure&&<p className="mt-2 text-xs text-[var(--foreground-muted)]">{job.errorCode==='tracking_stopped'?'The provider may have charged for this — check its history.':job.errorCode==='storage_expired'?'The temporary download expired before library space became available.':failure.sentence}{failure.detail?` The provider said: “${failure.detail}”`:''}</p>}
  </li>;})}</ul>
  {dismissing&&typeof document!=='undefined'&&createPortal(<ConfirmDialog open title="Stop tracking and remove this job?" description={stopTrackingDescription} confirmLabel="Stop and remove" onConfirm={()=>{onDismiss?.(dismissing.id);setDismissing(null);}} onCancel={()=>setDismissing(null)}/>,document.body)}
  {clearing&&typeof document!=='undefined'&&createPortal(<ConfirmDialog open title={`Clear ${clearable.length} jobs from this list?`} description={clearableWaiting>0?`Removes these rows from the list. ${clearableWaiting===1?'One of them is':`${clearableWaiting} of them are`} still waiting on a decision, so Scene Assembly stops checking ${clearableWaiting===1?'it':'them'} — the provider may still finish and charge, and nothing is recovered. Saved assets and spend records are not affected.`:'Removes these stopped and cancelled jobs from the list. Saved assets and spend records are not affected, and nothing is recovered from the provider.'} confirmLabel="Clear jobs" onConfirm={()=>{onClear?.(clearable);setClearing(false);}} onCancel={()=>setClearing(false)}/>,document.body)}
  </>;
}
