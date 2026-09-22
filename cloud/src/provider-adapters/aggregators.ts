import { editSettingsError } from '../../../lib/providers/video-edit';
import { piapiCreateImage, piapiCreateVideo, piapiPollTask } from '../../../lib/providers/piapi';
import { findModel, resolveDuration, resolveSize, resolveVideoInput } from '../../../lib/providers/catalog';
import { atlasCreateImage, atlasCreateVideo, atlasPollVideo } from '../../../lib/providers/atlas';
import { runwareCreateImage, runwareCreateVideo, runwarePollImage, runwarePollVideo, runwareStoreMedia, runwareDeleteMedia } from '../../../lib/providers/runware';
import { cometGenerateImage, cometCreateVideo, cometPollVideo } from '../../../lib/providers/comet';
import type { ProviderId } from '../../../lib/providers/types';
import type { CloudJobRequest } from '../../../lib/account/contracts';
import type { GenerationAdapter } from '../providers';
import { AccountError } from '../jobs';
import { inputUrls } from '../uploads';
import { credentials } from './queued';
import { inlineReferences, inlineInputs, recoverStagedImage, stageImage } from './media';
import { isLocal } from '../security';
import { jobInputIds } from '../../../lib/account/contracts';

/** Each rejection names what was wrong. One shared sentence hid which of a
 *  dozen checks fired, which sent people hunting through the wrong settings —
 *  a first-and-last-frame job read as an image-format problem. */
export function validateAggregatorRequest(r: CloudJobRequest) {
  if (r.provider !== 'runware' && r.provider !== 'atlas' && r.provider !== 'comet' && r.provider !== 'piapi') throw new Error('Unsupported aggregator');
  const model = findModel(r.provider, r.modelId);
  const invalid = (message: string) => { throw new AccountError(message, 400, 'invalid_settings'); };
  const providerLabel = r.provider === 'runware' ? 'Runware' : r.provider === 'atlas' ? 'Atlas Cloud' : r.provider === 'piapi' ? 'PiAPI' : 'Comet';
  if (!model) return invalid(`${providerLabel} does not list the model "${r.modelId}". Pick a model from the list.`);
  if (model.kind !== r.mediaType) return invalid(`${model.label} makes ${model.kind}s, not ${r.mediaType}s. Pick a ${r.mediaType} model.`);
  if (!model.modes.includes(r.inputMode)) return invalid(`${model.label} does not offer ${describeMode(r.inputMode)}. Pick another model or input mode.`);
  const count = r.referenceIds.length;
  if (r.inputMode === 'edit') {
    if (!model.videoEdit || !r.sourceVideoId) return invalid('Choose a source video to edit.');
    if (count > model.videoEdit.maxImages) return invalid(`Add up to ${model.videoEdit.maxImages} replacement images.`);
    const settingsError = editSettingsError(model.videoEdit, r.values);
    if (settingsError) return invalid(settingsError);
    return;
  }
  if (r.sourceVideoId) return invalid('Source video is only accepted in Edit video mode.');
  if (r.inputMode === 'text' && count !== 0) return invalid('A text-only run cannot include images. Remove them or switch to an image input mode.');
  if (r.inputMode !== 'text' && count === 0) return invalid(`${describeMode(r.inputMode, true)} needs at least one image.`);
  if (r.mediaType === 'image') {
    // Atlas's editors are the reason this is not a flat 1: Nano Banana 2 Edit
    // takes 14 references and GPT Image 2.5 Edit 16, and the adapter sends them
    // as the `images` array the endpoints document. Capping Atlas at one here
    // would make the limit on the model card a lie in cloud mode. 16 is the
    // ceiling `validateCloudJobRequest` already puts on `referenceIds`.
    const maxImages = Math.min(model.maxInputImages ?? 1, r.provider === 'piapi' ? 14 : r.provider === 'atlas' ? 16 : r.provider === 'runware' ? 4 : 1);
    if (count > maxImages) return invalid(`${model.label} takes up to ${maxImages} input image${maxImages === 1 ? '' : 's'} in a background job. Remove ${count - maxImages}.`);
  } else if (r.inputMode !== 'text') {
    const capability = resolveVideoInput(r.provider, r.modelId, r.inputMode);
    if (!capability) return invalid(`${model.label} does not accept images for ${describeMode(r.inputMode)}.`);
    if (r.inputMode === 'frames' && count !== 2) return invalid('First and last frame needs exactly two images: the frame the clip opens on, then the one it ends on.');
    if (count > capability.maxImages) return invalid(`${model.label} takes up to ${capability.maxImages} input image${capability.maxImages === 1 ? '' : 's'}. Remove ${count - capability.maxImages}.`);
    // Comet's video route takes a single `input_reference`; Atlas maps a second
    // image to `last_image`, so only Comet is held to one.
    if (r.provider === 'comet' && count > 1) return invalid('Comet background jobs accept one input image, so first-and-last-frame runs are not available there yet.');
  }
  const {aspectRatio, size, durationSeconds, resolution, audio} = r.values;
  if (r.provider === 'piapi') {
    if (resolution !== undefined && (r.mediaType !== 'image' || !['1K','2K','4K'].includes(String(resolution)))) return invalid('Choose 1K, 2K or 4K for Nano Banana 2.');
    if (audio !== undefined && (!model.supportsAudio || typeof audio !== 'boolean')) return invalid('Audio must be on or off for a supported video model.');
    if (aspectRatio !== undefined && model.aspectRatios && !model.aspectRatios.includes(String(aspectRatio))) return invalid('Choose an aspect ratio this model supports.');
  }
  // Only some Atlas image models publish a tier, so the catalog entry is what
  // says whether one is accepted and which labels are real.
  if (r.provider === 'atlas' && resolution !== undefined && (r.mediaType !== 'image' || !model.sizes?.some(s => s.label === String(resolution)))) return invalid(`"${String(resolution)}" is not a resolution ${model.label} publishes. Pick one from the list.`);
  if (aspectRatio !== undefined && !['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'].includes(String(aspectRatio))) return invalid(`"${String(aspectRatio)}" is not an aspect ratio ${model.label} accepts.`);
  if (size !== undefined && (typeof size !== 'string' || !model.sizes?.some(s => s.label === size))) return invalid(`"${String(size)}" is not an output size ${model.label} publishes. Pick one from the list.`);
  if (durationSeconds !== undefined && (typeof durationSeconds !== 'number' || resolveDuration(r.provider, r.modelId, durationSeconds) !== durationSeconds)) return invalid(`${String(durationSeconds)} seconds is not a length ${model.label} publishes. Pick one from the list.`);
  const accepted = r.provider === 'piapi'
    ? ['aspectRatio','size','durationSeconds','resolution','audio']
    : r.provider === 'atlas' ? ['aspectRatio','size','durationSeconds','resolution']
      : ['aspectRatio','size','durationSeconds'];
  const stray = Object.keys(r.values).find(key => !accepted.includes(key));
  if (stray) return invalid(`"${stray}" is not a setting this provider accepts.`);
}

function describeMode(mode: CloudJobRequest['inputMode'], capitalized = false): string {
  const label = mode === 'frames' ? 'first and last frame' : mode === 'reference' ? 'reference images' : mode === 'image' ? 'image input' : 'text input';
  return capitalized ? label[0].toUpperCase() + label.slice(1) : label;
}

export const aggregatorAdapter: GenerationAdapter = {
  async recover(env,job) {
    const r:CloudJobRequest=JSON.parse(job.request_json);
    return r.provider==='comet'&&r.mediaType==='image' ? recoverStagedImage(env,job) : undefined;
  },
  async submit(env, job) {
    const r: CloudJobRequest = JSON.parse(job.request_json);
    validateAggregatorRequest(r);
    const provider = r.provider as ProviderId;
    const model = findModel(provider, r.modelId)!;
    const common = {
      apiKey: await credentials(env, job), model: r.modelId, prompt: r.prompt,
      images: provider === 'comet' ? (await inlineReferences(env,job)).map(ref=>`data:${ref.mimeType};base64,${ref.data}`) : await inputUrls(env, job), aspectRatio: r.values.aspectRatio as string | undefined,
    };
    if (r.mediaType === 'image') {
      if (provider === 'comet') {
        const result = await cometGenerateImage(common);
        if (result.base64) return {result:await stageImage(env,job,result.base64,result.mimeType || 'image/png')};
        if (result.url) return {result:{sources:[{url:result.url}]}};
        throw new Error('Missing output');
      }
      const create = provider === 'piapi' ? piapiCreateImage : provider === 'runware' ? runwareCreateImage : atlasCreateImage;
      const result = await create({...common, imageInput: model.imageInput, ...(provider === 'piapi' || provider === 'atlas' ? {resolution: r.values.resolution as string | undefined} : {})});
      return {handle: {id: result.taskId}};
    }
    if (r.inputMode === 'edit') {
      // inputUrls keeps the source last, matching jobInputIds; it is never an image.
      let sourceVideo = common.images.pop();
      let sourceMedia: string | undefined;
      if (isLocal(env)) {
        // The provider cannot fetch localhost capabilities. Transfer owned bytes
        // to its media store first; production retains scoped HTTPS R2 URLs.
        const inputs = await inlineInputs(env, job, jobInputIds(r));
        const source = inputs.pop()!;
        sourceMedia = await runwareStoreMedia(common.apiKey, `data:${source.mimeType};base64,${source.data}`);
        sourceVideo = sourceMedia;
        common.images = inputs.map(input => `data:${input.mimeType};base64,${input.data}`);
      }
      // The durable job ID remains available even when submission throws, so
      // getTaskDetails can diagnose the attempt without another paid request.
      const result = await runwareCreateVideo({...common, sourceVideo, inputMode: 'edit', resolution: typeof r.values.size === 'string' ? r.values.size : undefined, ...(model.videoEdit?.draftRate ? {draft: r.values.draft === true} : {})}, job.id);
      return {handle: {id: result.taskId, ...(sourceMedia ? {sourceMedia} : {})}};
    }
    const size = resolveSize(provider, r.modelId, r.values.size as string | undefined);
    const create = provider === 'piapi' ? piapiCreateVideo : provider === 'runware' ? runwareCreateVideo : provider === 'comet' ? cometCreateVideo : atlasCreateVideo;
    const result = await create({
      ...common, inputMode: r.inputMode, ...(provider === 'piapi' ? {audio: r.values.audio === true} : {}),
      inputField: resolveVideoInput(provider, r.modelId, r.inputMode)?.field,
      durationSeconds: resolveDuration(provider, r.modelId, r.values.durationSeconds as number | undefined),
      width: size?.width, height: size?.height, resolution: size?.preset,
    });
    return {handle: {id: result.taskId}};
  },
  async poll(env, job, handle) {
    const r: CloudJobRequest = JSON.parse(job.request_json);
    const poll = job.provider === 'piapi' ? piapiPollTask : job.provider === 'atlas' ? atlasPollVideo : job.provider === 'comet' ? cometPollVideo : r.mediaType === 'image' ? runwarePollImage : runwarePollVideo;
    const result = await poll({apiKey: await credentials(env, job), taskId: handle.id});
    if (handle.sourceMedia && (result.state === 'success' || result.state === 'error')) {
      await runwareDeleteMedia(await credentials(env, job), handle.sourceMedia).catch(() => {});
    }
    if (result.state === 'error') return {state: 'failed', ...(result.error ? {reason: result.error} : {})};
    if (result.state !== 'success') return {state: 'running'};
    if (!result.urls.length) throw new Error('Missing output');
    return {state: 'success', result: {sources: result.urls.map(url => ({url})), ...(result.cost !== undefined ? {cost: result.cost} : {})}};
  },
};
