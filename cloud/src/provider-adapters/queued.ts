import { inputUrls } from '../uploads';
import { buildFalInput, resolveFalVariant, validateFalInput } from '../../../lib/fal/catalog';
import { getFalTask, submitFalTask } from '../../../lib/fal/server';
import { KIE_MODELS, resolveKieVariant, validateKieInput } from '../../../lib/kie/catalog';
import { createKieTask, getKieTask } from '../../../lib/kie/client';
import type { CloudJobRequest } from '../../../lib/account/contracts';
import type { GenerationAdapter } from '../providers';
import { AccountError, type JobRow } from '../jobs';
import type { Env } from '../security';
import { resolveConnection } from '../vault';

export async function credentials(env: Env, job: JobRow) {
  if (!job.connection_id || job.connection_revision === null) throw new Error('Connection unavailable');
  const connection = await resolveConnection(env, job.user_id, job.connection_id, job.connection_revision);
  if (connection.provider !== job.provider) throw new Error('Connection mismatch');
  return connection.secret.apiKey;
}
function request(job: JobRow): CloudJobRequest { return JSON.parse(job.request_json); }

/** Validate before reserving quota or entering the non-retrying submit step. */
export function validateQueuedRequest(r: CloudJobRequest) {
  const references=r.referenceIds.map(id=>`https://reference.invalid/${id}`);
  if(r.inputMode==='edit'||r.inputMode==='reference'||r.provider==='kie'&&r.inputMode==='frames')throw new AccountError('This reference mode is not supported by the selected provider.',400,'invalid_settings');
  try {
    if (r.provider === 'fal') {
      const variant = resolveFalVariant(r.modelId, r.mediaType, r.inputMode);
      const error = validateFalInput(variant, {prompt:r.prompt, uploadUrls:references});
      if (error) throw new Error(error);
      buildFalInput(variant, {prompt:r.prompt, uploadUrls:references, values:r.values});
    } else if (r.provider === 'kie') {
      const model = KIE_MODELS.find(m => m.id === r.modelId && m.mediaType === r.mediaType);
      if (!model) throw new Error('Unknown model');
      const variant = resolveKieVariant(r.modelId, r.inputMode as 'text'|'image');
      const error = validateKieInput(variant, {prompt:r.prompt, uploadUrls:references});
      if (error) throw new Error(error);
      for (const field of variant.fields) {
        const value = r.values[field.key] ?? field.defaultValue;
        if (value === undefined) { if (field.required && field.type !== 'file') throw new Error('Missing setting'); continue; }
        if (field.type === 'select' && !field.options?.some(option=>option.value === value)) throw new Error('Invalid option');
        if (field.type === 'boolean' && typeof value !== 'boolean') throw new Error('Invalid boolean');
        if (field.type === 'text' && typeof value !== 'string') throw new Error('Invalid text');
        if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || field.min !== undefined && value < field.min || field.max !== undefined && value > field.max)) throw new Error('Invalid number');
      }
    }
  } catch { throw new AccountError('Review the selected model and generation settings.', 400, 'invalid_settings'); }
}
export const falAdapter: GenerationAdapter = {
  async submit(env, job) {
    const r = request(job);
    const result = await submitFalTask({...r, inputMode:r.inputMode as 'text'|'image'|'frames', uploadUrls:await inputUrls(env,job), apiKey:await credentials(env,job)});
    return {handle:{id:result.requestId}};
  },
  async poll(env, job, handle) {
    const r = request(job);
    const result = await getFalTask({...r, inputMode:r.inputMode as 'text'|'image'|'frames', requestId:handle.id, apiKey:await credentials(env,job)});
    if (result.state !== 'success') return {state:'running'};
    if (!result.resultUrl) throw new Error('Missing output');
    return {state:'success',result:{sources:[{url:result.resultUrl,mimeType:result.mimeType}]}};
  },
};
export const kieAdapter: GenerationAdapter = {
  async submit(env, job) {
    const r = request(job);
    const result = await createKieTask({apiKey:await credentials(env,job),variant:resolveKieVariant(r.modelId,r.inputMode as 'text'|'image'),prompt:r.prompt,values:r.values,uploadUrls:await inputUrls(env,job)});
    return {handle:{id:result.taskId,protocol:result.protocol}};
  },
  async poll(env, job, handle) {
    if (handle.protocol !== 'market' && handle.protocol !== 'veo') throw new Error('Invalid protocol');
    const result = await getKieTask({apiKey:await credentials(env,job),protocol:handle.protocol,taskId:handle.id});
    if (result.state === 'fail') return {state:'failed', ...(result.error ? {reason:result.error} : {})};
    if (result.state !== 'success') return {state:'running'};
    if (!result.resultUrls.length) throw new Error('Missing output');
    return {state:'success',result:{sources:result.resultUrls.map(url=>({url}))}};
  },
};
