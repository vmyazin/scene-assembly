// cloud/src/provider-adapters/aggregators.ts
import { editPromptMode, editReferenceError, materializeEditReferences, parseEditReferencePlan, splitEditUploads } from '../../../lib/providers/edit-references';
import { referenceClipCountError, referenceClipSetError, referenceClipsFor } from '../../../lib/providers/reference-clips';
import { editHasControl, editPromptImageTokenError, editPromptLengthError, editSettingsError, framePinsFor, isRunwayEditProtocol } from '../../../lib/providers/video-edit';
import { isSeedance25, isSeedanceDraftSize, isSeedanceFinalizeValues, seedanceFinalizeValuesError } from '../../../lib/providers/seedance-draft';
import { piapiCreateImage, piapiCreateVideo, piapiPollTask } from '../../../lib/providers/piapi';
import { findModel, resolveDuration, resolveSize, resolveVideoInput } from '../../../lib/providers/catalog';
import { atlasCreateImage, atlasCreateVideo, atlasPollVideo } from '../../../lib/providers/atlas';
import { runwareCreateImage, runwareCreateVideo, runwarePollImage, runwarePollVideo, runwareStoreMedia, runwareDeleteMedia } from '../../../lib/providers/runware';
import { cometGenerateImage, cometCreateVideo, cometPollVideo, cometPollRunway } from '../../../lib/providers/comet';
import type { ProviderId } from '../../../lib/providers/types';
import type { CloudJobRequest } from '../../../lib/account/contracts';
import type { GenerationAdapter } from '../providers';
import { AccountError } from '../jobs';
import { inputUrls } from '../uploads';
import { credentials } from './queued';
import { inlineReferences, inlineInputs, recoverStagedImage, stageImage } from './media';
import { isLocal } from '../security';
import { jobInputIds } from '../../../lib/account/contracts';
import { moderationValueError } from '../../../lib/moderation/values';
import { moderationCapability } from '../../../lib/moderation/capabilities';
import type { ModerationLevel } from '../../../lib/moderation/level';

/** Each rejection names what was wrong. One shared sentence hid which of a
 *  dozen checks fired, which sent people hunting through the wrong settings —
 *  a first-and-last-frame job read as an image-format problem. */
export function validateAggregatorRequest(r: CloudJobRequest) {
  if (r.provider !== 'runware' && r.provider !== 'atlas' && r.provider !== 'comet' && r.provider !== 'piapi') throw new Error('Unsupported aggregator');
  const model = findModel(r.provider, r.modelId);
  const invalid = (message: string) => { throw new AccountError(message, 400, 'invalid_settings'); };
  const providerLabel = r.provider === 'runware' ? 'Runware' : r.provider === 'atlas' ? 'Atlas Cloud' : r.provider === 'piapi' ? 'PiAPI' : 'Comet';
  if (!model) return invalid(`${providerLabel} does not list the model "${r.modelId}". Pick a model from the list.`);
  if (isSeedanceFinalizeValues(r.values)) {
    if (!isSeedance25(r.modelId) || r.mediaType !== 'video') return invalid('Only a Seedance 2.5 video can be finalized.');
    if (r.referenceIds.length > 0 || r.sourceVideoId || (r.referenceVideoIds?.length ?? 0) > 0 || (r.referenceAudioIds?.length ?? 0) > 0) return invalid('Finalizing a draft cannot include prompt media. Send only the draft ID.');
    const finalizeError = seedanceFinalizeValuesError(r.values);
    if (finalizeError) return invalid(finalizeError);
    return;
  }
  const moderationError = moderationValueError({ provider: r.provider, modelId: r.modelId }, r.values);
  if (moderationError) return invalid(moderationError);
  if (model.kind !== r.mediaType) return invalid(`${model.label} makes ${model.kind}s, not ${r.mediaType}s. Pick a ${r.mediaType} model.`);
  if (!model.modes.includes(r.inputMode)) return invalid(`${model.label} does not offer ${describeMode(r.inputMode)}. Pick another model or input mode.`);
  const count = r.referenceIds.length;
  const referenceVideos = r.referenceVideoIds ?? [];
  const referenceAudios = r.referenceAudioIds ?? [];
  const clipCapability = referenceClipsFor(model, r.inputMode);
  const drivingAudio = r.inputMode === 'edit' && Boolean(model.videoEdit?.references?.audio);
  if (referenceVideos.length > 0 && !clipCapability) return invalid(`${model.label} does not take reference video or audio in ${describeMode(r.inputMode)}.`);
  if (referenceAudios.length > 0 && !clipCapability && !drivingAudio) return invalid(`${model.label} does not take reference video or audio in ${describeMode(r.inputMode)}.`);
  if (drivingAudio && referenceAudios.length > 1) return invalid('This edit takes one audio clip.');
  if (drivingAudio && referenceVideos.length > 0) return invalid(`${model.label} does not take a reference video.`);
  if (clipCapability?.video) {
    const countError = referenceClipCountError(clipCapability.video, referenceVideos.length);
    if (countError) return invalid(countError);
  } else if (referenceVideos.length > 0) return invalid(`${model.label} does not take reference video.`);
  if (clipCapability?.audio) {
    const countError = referenceClipCountError(clipCapability.audio, referenceAudios.length);
    if (countError) return invalid(countError);
  } else if (referenceAudios.length > 0 && !drivingAudio) return invalid(`${model.label} does not take reference audio.`);
  const clipSetError = clipCapability ? referenceClipSetError(clipCapability, { images: count, videos: referenceVideos.length, audios: referenceAudios.length }) : null;
  if (clipSetError) return invalid(clipSetError);
  if (r.inputMode === 'edit') {
    if (!model.videoEdit || !r.sourceVideoId) return invalid('Choose a source video to edit.');
    const promptMode = editPromptMode(model.videoEdit.references);
    if (promptMode === 'required' && !r.prompt.trim()) return invalid('Enter a prompt for this edit.');
    const promptError = editPromptLengthError(model.videoEdit, r.prompt);
    if (promptError) return invalid(promptError);
    const spec = model.videoEdit.references;
    if (spec) {
      let plan;
      try { plan = parseEditReferencePlan(r.editReferencePlan, count); }
      catch (error) { return invalid(error instanceof Error ? error.message : 'Invalid edit references.'); }
      const urls = r.referenceIds.map((_, index) => `https://reference.invalid/${index}`);
      const referenceError = editReferenceError(spec, materializeEditReferences(spec, urls, plan, referenceAudios[0] ? 'https://reference.invalid/audio' : undefined));
      if (referenceError) return invalid(referenceError);
    } else if (count > model.videoEdit.maxImages) return invalid(`Add up to ${model.videoEdit.maxImages} replacement images.`);
    const imageTokenError = editPromptImageTokenError(model.videoEdit, r.prompt);
    if (imageTokenError) return invalid(imageTokenError);
    const settingsError = editSettingsError(model.videoEdit, r.values);
    if (settingsError) return invalid(settingsError);
    const pins = framePinsFor(typeof r.values.frameAnchors === 'string' ? r.values.frameAnchors : undefined, count, model.videoEdit);
    if (typeof pins === 'string') return invalid(pins);
    return;
  }
  if (r.sourceVideoId) return invalid('Source video is only accepted in Edit video mode.');
  if (r.inputMode === 'text' && count !== 0) return invalid('A text-only run cannot include images. Remove them or switch to an image input mode.');
  const clipsStandIn = referenceVideos.length > 0 || (referenceAudios.length > 0 && Boolean(clipCapability && !clipCapability.audioRequiresVisual));
  if (r.inputMode !== 'text' && count === 0 && !clipsStandIn) return invalid(`${describeMode(r.inputMode, true)} needs at least one image.`);
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
  if (r.provider !== 'piapi' && model.aspectRatios && aspectRatio !== undefined && !model.aspectRatios.includes(String(aspectRatio))) return invalid(`"${String(aspectRatio)}" is not an aspect ratio ${model.label} publishes. Pick one from the list.`);
  if (r.provider !== 'piapi' && model.supportsAudio && audio !== undefined && typeof audio !== 'boolean') return invalid('Audio must be on or off for a supported video model.');
  // Only some Atlas image models publish a tier, so the catalog entry is what
  // says whether one is accepted and which labels are real.
  if (r.provider === 'atlas' && resolution !== undefined && (r.mediaType !== 'image' || !model.sizes?.some(s => s.label === String(resolution)))) return invalid(`"${String(resolution)}" is not a resolution ${model.label} publishes. Pick one from the list.`);
  if (aspectRatio !== undefined && !['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'].includes(String(aspectRatio))) return invalid(`"${String(aspectRatio)}" is not an aspect ratio ${model.label} accepts.`);
  if (size !== undefined && (typeof size !== 'string' || !model.sizes?.some(s => s.label === size))) return invalid(`"${String(size)}" is not an output size ${model.label} publishes. Pick one from the list.`);
  if (r.values.draft === true && (!model.draftPreview || typeof size !== 'string' || !isSeedanceDraftSize(size))) return invalid('A Seedance draft is 480p only. Pick a 480p size, or turn Draft off.');
  if (durationSeconds !== undefined && (typeof durationSeconds !== 'number' || resolveDuration(r.provider, r.modelId, durationSeconds) !== durationSeconds)) return invalid(`${String(durationSeconds)} seconds is not a length ${model.label} publishes. Pick one from the list.`);
  const relaxable = moderationCapability({ provider: r.provider, modelId: r.modelId }).relaxable;
  const accepted = r.provider === 'piapi'
    ? ['aspectRatio','size','durationSeconds','resolution','audio']
    : r.provider === 'atlas' ? ['aspectRatio','size','durationSeconds','resolution']
      : ['aspectRatio','size','durationSeconds'];
  if (model.draftPreview) accepted.push('draft');
  if (relaxable) accepted.push('moderation');
  if (model.supportsAudio && !accepted.includes('audio')) accepted.push('audio');
  const stray = Object.keys(r.values).find(key => !accepted.includes(key));
  if (stray) return invalid(`"${stray}" is not a setting this provider accepts.`);
}

/** Ids already in Runware's media store. A later failure must delete them; the poll never sees a handle that was not returned. */
async function releaseStored(apiKey: string, ids: Array<string | undefined>) {
  for (const id of ids) if (id) await runwareDeleteMedia(apiKey, id).catch(() => {});
}

function describeMode(mode: CloudJobRequest['inputMode'], capitalized = false): string {
  const label = mode === 'frames' ? 'first and last frame' : mode === 'reference' ? 'reference images' : mode === 'edit' ? 'edit video' : mode === 'image' ? 'image input' : 'text input';
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
    const moderation: ModerationLevel = r.values.moderation === 'relaxed' ? 'relaxed' : 'standard';
    const common = {
      apiKey: await credentials(env, job), model: r.modelId, prompt: r.prompt, moderation,
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
    if (isSeedanceFinalizeValues(r.values)) {
      const result = await runwareCreateVideo({
        apiKey: common.apiKey, model: r.modelId, prompt: '', inputMode: r.inputMode,
        draftId: String(r.values.draftId), resolution: '1080p',
      }, job.id);
      return {handle: {id: result.taskId}};
    }
    if (r.inputMode === 'edit' && provider === 'comet' && isRunwayEditProtocol(model.videoEdit)) {
      // Aleph takes one https address in production. Locally the provider cannot
      // fetch this machine, so the owned bytes go as a data URI. That URI is
      // capped at 5,242,880 characters; acceptJob refuses a larger clip first.
      let sourceVideo: string;
      if (isLocal(env)) {
        const inputs = await inlineInputs(env, job, [r.sourceVideoId!]);
        const source = inputs[0];
        sourceVideo = `data:${source.mimeType};base64,${source.data}`;
      } else {
        const urls = await inputUrls(env, job);
        const index = jobInputIds(r).indexOf(r.sourceVideoId!);
        const hosted = urls[index];
        if (!hosted) throw new AccountError('Choose a source video to edit.', 400, 'invalid_references');
        sourceVideo = hosted;
      }
      const result = await cometCreateVideo({
        apiKey: common.apiKey, model: r.modelId, prompt: r.prompt, inputMode: 'edit', sourceVideo,
        aspectRatio: typeof r.values.aspectRatio === 'string' ? r.values.aspectRatio : undefined,
      });
      return {handle: {id: result.taskId, protocol: 'runway'}};
    }
    if (r.inputMode === 'edit' && provider === 'atlas') {
      const split = splitEditUploads(r, common.images);
      if (!split.source) throw new AccountError('Choose a source video to edit.', 400, 'invalid_references');
      const sizeLabel = typeof r.values.size === 'string' ? r.values.size : undefined;
      const size = resolveSize(provider, r.modelId, sizeLabel);
      const outputDuration = typeof r.values.outputDuration === 'number' ? r.values.outputDuration : undefined;
      const sourceDurationSeconds = typeof r.values.sourceDurationSeconds === 'number' ? r.values.sourceDurationSeconds : undefined;
      const result = await atlasCreateVideo({
        apiKey: common.apiKey,
        model: r.modelId,
        prompt: r.prompt,
        moderation,
        inputMode: 'edit',
        sourceVideo: split.source,
        images: split.images,
        ...(split.audio ? { referenceAudios: [split.audio] } : {}),
        ...(size?.preset ? { resolution: size.preset } : {}),
        ...(typeof r.values.aspectRatio === 'string' ? { aspectRatio: r.values.aspectRatio } : {}),
        ...(typeof r.values.keepOriginalSound === 'boolean' ? { keepOriginalSound: r.values.keepOriginalSound } : {}),
        ...(outputDuration !== undefined ? { outputDuration } : {}),
        ...(sourceDurationSeconds !== undefined ? { sourceDurationSeconds } : {}),
        ...(typeof r.values.negativePrompt === 'string' ? { negativePrompt: r.values.negativePrompt } : {}),
        ...(typeof r.values.promptExtend === 'boolean' ? { promptExtend: r.values.promptExtend } : {}),
      });
      return { handle: { id: result.taskId } };
    }
    if (r.inputMode === 'edit') {
      // inputUrls keeps the source last, matching jobInputIds; it is never an image.
      let sourceVideo = common.images.pop();
      let sourceMedia: string | undefined;
      try {
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
        const edit = model.videoEdit;
        const encoded = typeof r.values.frameAnchors === 'string' ? r.values.frameAnchors : undefined;
        const pins = edit ? framePinsFor(encoded, r.referenceIds.length, edit) : [];
        if (typeof pins === 'string') throw new AccountError(pins, 400, 'invalid_settings');
        const resolution = edit?.outputResolution ?? (edit?.transport ? undefined : (typeof r.values.size === 'string' ? r.values.size : undefined));
        const result = await runwareCreateVideo({
          ...common, sourceVideo, inputMode: 'edit',
          ...(edit?.transport ? { editTransport: edit.transport } : {}),
          ...(edit?.transport === 'frame-anchors' ? { framePins: pins } : {}),
          ...(editHasControl(edit, 'keepOriginalSound') ? { keepOriginalSound: r.values.keepOriginalSound !== false } : {}),
          ...(edit?.outputResolution ? { outputResolution: edit.outputResolution } : {}),
          ...(resolution ? { resolution } : {}),
          ...(edit?.draftRate || edit?.draftPreview ? { draft: r.values.draft === true } : {}),
        }, job.id);
        return {handle: {id: result.taskId, ...(sourceMedia ? {sourceMedia} : {})}};
      } catch (error) {
        await releaseStored(common.apiKey, [sourceMedia]);
        throw error;
      }
    }
    const videoIds = r.referenceVideoIds ?? [];
    const audioIds = r.referenceAudioIds ?? [];
    // jobInputIds is images, then reference videos, then reference audio. Comet
    // never reaches here with clips: its models have no referenceClips capability.
    let referenceVideos = provider === 'comet' ? [] : common.images.slice(r.referenceIds.length, r.referenceIds.length + videoIds.length);
    let referenceAudios = provider === 'comet' ? [] : common.images.slice(r.referenceIds.length + videoIds.length, r.referenceIds.length + videoIds.length + audioIds.length);
    common.images = common.images.slice(0, r.referenceIds.length);
    const storedMedia: string[] = [];
    try {
      if (provider === 'runware' && isLocal(env) && (videoIds.length > 0 || audioIds.length > 0)) {
        // Seedance rejects data URIs on referenceVideos and referenceAudios, and
        // it cannot fetch a localhost media URL. Store the owned bytes, then
        // delete those UUIDs when the task ends. A store or create that throws
        // before the handle is returned has to delete them here: poll never runs.
        const inputs = await inlineInputs(env, job, [...videoIds, ...audioIds]);
        for (const input of inputs) storedMedia.push(await runwareStoreMedia(common.apiKey, `data:${input.mimeType};base64,${input.data}`));
        referenceVideos = storedMedia.slice(0, videoIds.length);
        referenceAudios = storedMedia.slice(videoIds.length);
      }
      const size = resolveSize(provider, r.modelId, r.values.size as string | undefined);
      const create = provider === 'piapi' ? piapiCreateVideo : provider === 'runware' ? runwareCreateVideo : provider === 'comet' ? cometCreateVideo : atlasCreateVideo;
      const result = await create({
        ...common, inputMode: r.inputMode, ...(provider === 'piapi' || model.supportsAudio ? {audio: r.values.audio === true} : {}),
        inputField: resolveVideoInput(provider, r.modelId, r.inputMode)?.field,
        durationSeconds: resolveDuration(provider, r.modelId, r.values.durationSeconds as number | undefined),
        width: size?.width, height: size?.height, resolution: size?.preset,
        ...(referenceVideos.length > 0 ? {referenceVideos} : {}),
        ...(referenceAudios.length > 0 ? {referenceAudios} : {}),
        ...(r.values.draft === true ? {draft: true} : {}),
      });
      return {handle: {id: result.taskId, ...(storedMedia.length ? {storedMedia} : {})}};
    } catch (error) {
      await releaseStored(common.apiKey, storedMedia);
      throw error;
    }
  },
  async poll(env, job, handle) {
    const r: CloudJobRequest = JSON.parse(job.request_json);
    const poll = job.provider === 'piapi' ? piapiPollTask : job.provider === 'atlas' ? atlasPollVideo : job.provider === 'comet' ? (handle.protocol === 'runway' ? cometPollRunway : cometPollVideo) : r.mediaType === 'image' ? runwarePollImage : runwarePollVideo;
    const result = await poll({apiKey: await credentials(env, job), taskId: handle.id});
    const stored = [...(handle.sourceMedia ? [handle.sourceMedia] : []), ...(handle.storedMedia ?? [])];
    if (stored.length > 0 && (result.state === 'success' || result.state === 'error')) {
      const apiKey = await credentials(env, job);
      for (const id of stored) await runwareDeleteMedia(apiKey, id).catch(() => {});
    }
    if (result.state === 'error') return {state: 'failed', ...(result.error ? {reason: result.error} : {})};
    if (result.state !== 'success') return {state: 'running'};
    if (!result.urls.length) throw new Error('Missing output');
    return {state: 'success', result: {sources: result.urls.map(url => ({url})), ...(result.cost !== undefined ? {cost: result.cost} : {}), ...(result.draftId ? {draftId: result.draftId} : {})}};
  },
};
