import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import CloudJobList from '@/components/account/CloudJobList';
import { canResumeJob, describeFailure, failureNextStep, MAX_RESUME_ATTEMPTS } from '@/lib/account/job-failure';
import type { CloudJobView } from '@/lib/account/contracts';

const request = {provider:'comet' as const,modelId:'veo-3',mediaType:'video' as const,inputMode:'text' as const,prompt:'Space Sheep on stage',values:{},referenceIds:[]};
const stopped = (patch: Partial<CloudJobView>): CloudJobView => ({
  id:'job',provider:'comet',request,state:'needs_attention',errorCode:'save_failed',createdAt:1,updatedAt:1,...patch,
});

/**
 * The defect these cover: three unrelated causes reached the account page as
 * one sentence about needing "another attempt", beside a Resume that repeated
 * the same failure. The row has to say which cause it is, and stop offering a
 * button for the causes a retry cannot change.
 */
it('names the specific cause instead of the coarse error code', () => {
  render(<CloudJobList jobs={[stopped({failureReason:'result_link_expired'})]} onResume={vi.fn()}/>);
  expect(screen.getByText(/download link for this result expired/)).toBeInTheDocument();
  expect(screen.queryByText(/needs another attempt/)).not.toBeInTheDocument();
});

it('hides Resume for a cause that cannot change, and keeps it for one that can', () => {
  const view = render(<CloudJobList jobs={[stopped({failureReason:'result_link_expired'})]} onResume={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Resume existing job'})).not.toBeInTheDocument();

  view.rerender(<CloudJobList jobs={[stopped({failureReason:'transfer_failed'})]} onResume={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Resume existing job'})).toBeInTheDocument();
});

it('states how many resumes have been spent and retires the button at the limit', () => {
  const view = render(<CloudJobList jobs={[stopped({failureReason:'transfer_failed',attempts:1})]} onResume={vi.fn()}/>);
  expect(screen.getByText(/Resumed once already\./)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Resume existing job'})).toBeInTheDocument();

  view.rerender(<CloudJobList jobs={[stopped({failureReason:'transfer_failed',attempts:MAX_RESUME_ATTEMPTS})]} onResume={vi.fn()}/>);
  expect(screen.getByText(new RegExp(`the limit is ${MAX_RESUME_ATTEMPTS}`))).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Resume existing job'})).not.toBeInTheDocument();
});

it('blames the cap only when the cap is what stopped the button', () => {
  // The cause here could never be retried, so naming the limit would point at
  // the wrong thing and imply a fourth attempt might have worked.
  render(<CloudJobList jobs={[stopped({failureReason:'result_too_large',attempts:MAX_RESUME_ATTEMPTS})]} onResume={vi.fn()}/>);
  expect(screen.getByText(/Resumed 3 times already\./)).toBeInTheDocument();
  expect(screen.queryByText(new RegExp(`the limit is ${MAX_RESUME_ATTEMPTS}`))).not.toBeInTheDocument();
});

it('quotes a provider refusal as the provider’s words, not the app’s', () => {
  render(<CloudJobList jobs={[stopped({state:'failed',errorCode:'provider_failed',failureReason:'provider_rejected',failureDetail:'prompt violates content policy'})]} onResume={vi.fn()}/>);
  expect(screen.getByText(/The provider said: “prompt violates content policy”/)).toBeInTheDocument();
});

/** A Worker deployed before these columns existed sends neither, and the two
 *  halves of this app deploy separately. The row must degrade to the copy it
 *  had rather than render `undefined` or lose its only action. */
it('falls back to the old copy for a job that predates the recorded reason', () => {
  render(<CloudJobList jobs={[stopped({})]} onResume={vi.fn()}/>);
  expect(screen.getByText(/Tracking or saving needs another attempt/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Resume existing job'})).toBeInTheDocument();
});

it('only quotes a provider message alongside a provider refusal', () => {
  // Defence in depth against a detail leaking onto an unrelated row: the column
  // is only ever written beside a provider refusal.
  expect(describeFailure(stopped({failureReason:'transfer_failed',failureDetail:'leaked'})).detail).toBeNull();
  expect(describeFailure(stopped({failureReason:'provider_rejected',failureDetail:'kept'})).detail).toBe('kept');
  expect(describeFailure(stopped({failureReason:'provider_policy',failureDetail:'prompt violates content policy'})).detail).toBe('prompt violates content policy');
});

it('does not offer Resume when the provider content filter stopped the job', () => {
  render(<CloudJobList jobs={[stopped({failureReason:'provider_policy',failureDetail:'prompt violates content policy'})]} onResume={vi.fn()}/>);
  expect(screen.getByText('Blocked by provider content filter')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Resume existing job'})).not.toBeInTheDocument();
});

it('never offers resume on a job that is no longer waiting for a decision', () => {
  expect(canResumeJob(stopped({state:'failed',failureReason:'transfer_failed'}))).toBe(false);
  expect(canResumeJob(stopped({failureReason:'transfer_failed'}))).toBe(true);
});

it('provides a download-first next step and honest legacy diagnostics', () => {
  render(<CloudJobList jobs={[stopped({failureReason:'result_location'})]} onResume={vi.fn()}/>);
  expect(screen.getByText(/Get the provider download below/)).toBeInTheDocument();
  expect(screen.getByText('No additional error detail was recorded for this job.')).toBeInTheDocument();
  expect(screen.getByText('Job reference')).toBeInTheDocument();
  expect(screen.getByText('comet / veo-3')).toBeInTheDocument();
});

it('copies diagnostics without the prompt, and keeps capture errors out of the provider voice', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText}});
  render(<CloudJobList jobs={[stopped({failureReason:'transfer_failed',failureDetail:'Provider download returned HTTP 503.'})]} onResume={vi.fn()}/>);
  fireEvent.click(screen.getByText('Issue details'));
  fireEvent.click(screen.getByRole('button',{name:'Copy issue details'}));
  await screen.findByText('Copied. Prompt and download links are not included.');
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Recorded error: Provider download returned HTTP 503.'));
  expect(writeText.mock.calls[0][0]).not.toContain(request.prompt);
  expect(screen.queryByText(/The provider said:/)).not.toBeInTheDocument();
});

it('offers manual copying when clipboard permission is unavailable', async () => {
  Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:vi.fn().mockRejectedValue(new Error('denied'))}});
  render(<CloudJobList jobs={[stopped({})]} onResume={vi.fn()}/>);
  fireEvent.click(screen.getByText('Issue details'));
  fireEvent.click(screen.getByRole('button',{name:'Copy issue details'}));
  expect(await screen.findByText(/Could not copy. Select the details above/)).toBeInTheDocument();
});

it('gives exhausted and terminal rows next steps that do not promise resume', () => {
  expect(failureNextStep(stopped({failureReason:'transfer_failed',attempts:3}))).toMatch(/No retries remain/);
  expect(failureNextStep(stopped({failureReason:'result_location',canRetrySave:true,attempts:3}))).toMatch(/Get the provider download/);
  expect(failureNextStep(stopped({failureReason:'transfer_failed',state:'failed'}))).not.toMatch(/Resume/);
});

it('keeps the list scannable while retaining the explanation behind Issue details', () => {
  render(<CloudJobList jobs={[stopped({failureReason:'result_location',attempts:2})]} onResume={vi.fn()}/>);
  expect(screen.getByText('Generated · saving blocked')).toBeVisible();
  expect(screen.getByText('Download the existing file before its link expires.')).toBeVisible();
  expect(screen.getByText(/Generation finished, but automatic saving/)).not.toBeVisible();
  expect(screen.getByText(/Resumed 2 times already/)).not.toBeVisible();
  fireEvent.click(screen.getByText('Issue details'));
  expect(screen.getByText(/Generation finished, but automatic saving/)).toBeVisible();
  expect(screen.getByText(/Resumed 2 times already/)).toBeVisible();
});
