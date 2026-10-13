// app/api/providers/video/route.ts
import { cometPollRunway, isAlephVideoUri } from '@/lib/providers/comet';
import { editSettingsError, isRunwayEditProtocol } from '@/lib/providers/video-edit';
import { referenceClipCountError, referenceClipSetError, referenceClipsFor } from '@/lib/providers/reference-clips';
import { SEEDANCE_25_MODEL, isSeedanceDraftSize } from '@/lib/providers/seedance-draft';
import { runwareDeleteMedia } from '@/lib/providers/runware';
import { NextRequest, NextResponse } from 'next/server';

import { getAdapter, isProviderId } from '@/lib/providers';
import {
  findModel,
  resolveDuration,
  resolveModel,
  resolveSize,
  resolveVideoInput,
} from '@/lib/providers/catalog';
import { ProviderError, type ProviderMode } from '@/lib/providers/types';
import { floorRejection, honoredModeration } from '@/lib/moderation/guard';

/**
 * Video for the aggregator providers — one route for all three, because their
 * contracts are the same two calls behind different spellings: submit a job,
 * poll it until a URL appears. The per-vendor differences live in the adapters.
 *
 * Keys arrive per request from the browser and are never stored here, the same
 * BYOK deal the fal and Kie routes already make.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isProviderMode(value: unknown): value is ProviderMode {
  return value === 'text' || value === 'image' || value === 'frames' || value === 'reference' || value === 'edit';
}

const MEDIA_ID = /^[a-f\d-]{36}$/i;

/** Reference clips are uploaded before this route runs. The body carries ids, never bytes. */
function mediaIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !MEDIA_ID.test(item))) return null;
  return value;
}

function failure(error: unknown, fallback: string) {
  const status = error instanceof ProviderError ? error.status : 500;
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !isProviderId(body.provider)) {
    return NextResponse.json(
      { success: false, error: 'A supported provider is required' },
      { status: 400 }
    );
  }

  const adapter = getAdapter(body.provider);
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: `A ${adapter.label} API key is required` },
      { status: 400 }
    );
  }

  if (body.operation === 'discard') {
    const videos = mediaIds(body.referenceVideos);
    const audios = mediaIds(body.referenceAudios);
    if (!videos || !audios) return NextResponse.json({ success: false, error: 'Reference media ids are invalid.' }, { status: 400 });
    if (body.provider === 'runware') {
      for (const id of [...videos, ...audios]) await runwareDeleteMedia(apiKey, id).catch(() => {});
    }
    return NextResponse.json({ success: true });
  }

  if (body.operation === 'status') {
    if (typeof body.taskId !== 'string' || !body.taskId) {
      return NextResponse.json({ success: false, error: 'A task ID is required' }, { status: 400 });
    }
    try {
      // A Runway-protocol edit lives on Runway's task route. The video poll
      // would look up the same id under /v1/videos and report a task that is not there.
      const runway = body.provider === 'comet' && isRunwayEditProtocol(findModel('comet', typeof body.model === 'string' ? body.model : '')?.videoEdit);
      const task = runway
        ? await cometPollRunway({ apiKey, taskId: body.taskId })
        : await adapter.pollVideo({ apiKey, taskId: body.taskId });
      if (body.provider === 'runware' && (task.state === 'success' || task.state === 'error')) {
        const stored = [
          ...(typeof body.sourceVideo === 'string' && MEDIA_ID.test(body.sourceVideo) ? [body.sourceVideo] : []),
          ...(Array.isArray(body.referenceVideos) ? body.referenceVideos.filter((id): id is string => typeof id === 'string' && MEDIA_ID.test(id)) : []),
          ...(Array.isArray(body.referenceAudios) ? body.referenceAudios.filter((id): id is string => typeof id === 'string' && MEDIA_ID.test(id)) : []),
        ];
        for (const id of stored) await runwareDeleteMedia(apiKey, id).catch(() => {});
      }
      return NextResponse.json({ success: true, task });
    } catch (error) {
      return failure(error, `${adapter.label} could not report this task.`);
    }
  }

  if (body.operation === 'finalize') {
    const model = typeof body.model === 'string' ? body.model : '';
    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';
    const forbidden = ['prompt', 'images', 'sourceVideo', 'referenceVideos', 'referenceAudios', 'size', 'durationSeconds', 'width', 'height', 'aspectRatio', 'audio', 'draft', 'inputField']
      .filter((key) => body[key] !== undefined);
    if (model !== SEEDANCE_25_MODEL || !draftId || forbidden.length > 0) {
      return NextResponse.json({
        success: false,
        error: forbidden.length > 0
          ? 'Finalizing a Seedance draft cannot resend the prompt, duration, audio, or media. Send only the draft ID.'
          : 'A Seedance 2.5 draft ID is required to finalize.',
      }, { status: 400 });
    }
    try {
      const { taskId } = await adapter.createVideo({ apiKey, model, prompt: '', draftId, resolution: '1080p' });
      return NextResponse.json({ success: true, taskId });
    } catch (error) {
      return failure(error, 'Could not finalize this draft.');
    }
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
  }
  const blocked = floorRejection(prompt);
  if (blocked) return blocked;

  const images = Array.isArray(body.images)
    ? body.images.filter((image): image is string => typeof image === 'string' && image.startsWith('data:'))
    : [];
  const referenceVideos = mediaIds(body.referenceVideos);
  const referenceAudios = mediaIds(body.referenceAudios);
  if (!referenceVideos || !referenceAudios) {
    return NextResponse.json({ success: false, error: 'Reference video and audio must already be uploaded.' }, { status: 400 });
  }
  const moderation = await honoredModeration({
    requested: body.moderation,
    prompt,
    hasReferences: images.length > 0 || referenceVideos.length > 0 || referenceAudios.length > 0 || typeof body.sourceVideo === 'string',
    request,
  });

  const model = resolveModel(
    body.provider,
    'video',
    typeof body.model === 'string' ? body.model : undefined
  );
  const hasExplicitInputMode = body.inputMode !== undefined;
  const inputMode = hasExplicitInputMode
    ? body.inputMode
    : images.length === 0
      ? 'text'
      : 'image';
  if (!isProviderMode(inputMode)) {
    return NextResponse.json(
      { success: false, error: 'A supported video input mode is required' },
      { status: 400 }
    );
  }
  const modelRecord = findModel(body.provider, model);
  // Old clients did not send a semantic mode; preserve their route behavior.
  // New clients always send it and receive capability/count validation here.
  if (hasExplicitInputMode && !modelRecord?.modes.includes(inputMode)) {
    return NextResponse.json(
      { success: false, error: `Model ${model} does not support ${inputMode} video input` },
      { status: 400 }
    );
  }
  if (hasExplicitInputMode && inputMode === 'text' && images.length > 0) {
    return NextResponse.json(
      { success: false, error: 'Text video input cannot include images' },
      { status: 400 }
    );
  }
  if (inputMode === 'edit') {
    if (referenceVideos.length > 0 || referenceAudios.length > 0) {
      return NextResponse.json({ success: false, error: 'Edit mode takes a source video, not reference video or audio.' }, { status: 400 });
    }
    const capability = modelRecord?.videoEdit;
    const sourceVideo = typeof body.sourceVideo === 'string' ? body.sourceVideo : '';
    const sourceOk = body.provider === 'runware' ? MEDIA_ID.test(sourceVideo) : body.provider === 'comet' && isAlephVideoUri(sourceVideo);
    if (!capability || !sourceOk) return NextResponse.json({success: false, error: 'Upload a source video for this editing model.'}, {status: 400});
    const lockedShape = body.durationSeconds !== undefined || body.width !== undefined || body.height !== undefined || (body.aspectRatio !== undefined && !capability.aspectRatios?.length);
    if (lockedShape) return NextResponse.json({success: false, error: 'Edits inherit source duration and aspect ratio.'}, {status: 400});
    const size = capability.sizes.find(size => size.label === body.size);
    const settingsError = editSettingsError(capability, {size: body.size, draft: body.draft, audio: body.audio, resolution: body.resolution, aspectRatio: body.aspectRatio});
    if (settingsError || images.length > capability.maxImages) return NextResponse.json({success: false, error: settingsError ?? `Add up to ${capability.maxImages} replacement images.`}, {status: 400});
    try {
      const {taskId} = await adapter.createVideo({apiKey, model, prompt, inputMode, sourceVideo, images, resolution: size?.preset, ...(typeof body.aspectRatio === 'string' ? {aspectRatio: body.aspectRatio} : {}), ...(capability.draftRate || (model === SEEDANCE_25_MODEL && body.draft === true) ? {draft: body.draft === true} : {}), ...(moderation === 'relaxed' ? {moderation} : {})});
      return NextResponse.json({success: true, taskId});
    } catch (error) { return failure(error, 'Could not start this video edit.'); }
  }
  if (body.sourceVideo !== undefined) return NextResponse.json({success: false, error: 'Source video requires Edit video mode.'}, {status: 400});
  const clipCapability = referenceClipsFor(modelRecord, inputMode);
  if ((referenceVideos.length > 0 || referenceAudios.length > 0) && !clipCapability) {
    return NextResponse.json({ success: false, error: 'This model does not take reference video or audio in this mode.' }, { status: 400 });
  }
  if (clipCapability?.video && referenceVideos.length > 0) {
    const countError = referenceClipCountError(clipCapability.video, referenceVideos.length);
    if (countError) return NextResponse.json({ success: false, error: countError }, { status: 400 });
  }
  if (clipCapability?.audio && referenceAudios.length > 0) {
    const countError = referenceClipCountError(clipCapability.audio, referenceAudios.length);
    if (countError) return NextResponse.json({ success: false, error: countError }, { status: 400 });
  }
  if (!clipCapability?.video && referenceVideos.length > 0) {
    return NextResponse.json({ success: false, error: 'This model does not take reference video.' }, { status: 400 });
  }
  if (!clipCapability?.audio && referenceAudios.length > 0) {
    return NextResponse.json({ success: false, error: 'This model does not take reference audio.' }, { status: 400 });
  }
  const clipSetError = clipCapability
    ? referenceClipSetError(clipCapability, { images: images.length, videos: referenceVideos.length, audios: referenceAudios.length })
    : null;
  if (clipSetError) return NextResponse.json({ success: false, error: clipSetError }, { status: 400 });
  if ((referenceVideos.length > 0 || referenceAudios.length > 0) && body.provider !== 'runware') {
    return NextResponse.json({ success: false, error: 'Reference video and audio on this provider need a background job, so the files have a hosted address.' }, { status: 400 });
  }
  const clipsStandIn = referenceVideos.length > 0 || (referenceAudios.length > 0 && clipCapability && !clipCapability.audioRequiresVisual);
  const videoInput = resolveVideoInput(body.provider, model, inputMode);
  if (hasExplicitInputMode && inputMode !== 'text') {
    if (!videoInput) {
      return NextResponse.json(
        { success: false, error: 'This model has no supported video image input' },
        { status: 400 }
      );
    }
    const required = inputMode === 'frames' ? 2 : 1;
    if (images.length < required && !(inputMode === 'reference' && clipsStandIn)) {
      return NextResponse.json(
        {
          success: false,
          error:
            inputMode === 'frames'
              ? 'Exactly two frame images are required'
              : 'At least one image is required',
        },
        { status: 400 }
      );
    }
    if (images.length > videoInput.maxImages) {
      return NextResponse.json(
        { success: false, error: `This model accepts at most ${videoInput.maxImages} images` },
        { status: 400 }
      );
    }
  }

  // Whitelisted per model: Runware answers an unlisted width/height with
  // "Unsupported width/height combination for this model architecture".
  const size = resolveSize(
    body.provider,
    model,
    typeof body.size === 'string' ? body.size : undefined
  );

  if (body.provider === 'piapi' && body.audio !== undefined && typeof body.audio !== 'boolean') return NextResponse.json({success:false,error:'Audio must be on or off.'},{status:400});

  const requestedDuration = typeof body.durationSeconds === 'number' ? body.durationSeconds : undefined;
  // Other models snap a stale length to the nearest one they list. Lite's
  // validator rejects instead, so a 5s or 4K request cannot leave as a 4s 720p
  // clip the caller did not ask for.
  if (model === 'google:veo@3.1-lite') {
    if (requestedDuration !== undefined && resolveDuration(body.provider, model, requestedDuration) !== requestedDuration) {
      return NextResponse.json({ success: false, error: 'Veo 3.1 Lite accepts only 4, 6, or 8 seconds.' }, { status: 400 });
    }
    if (typeof body.size === 'string' && !modelRecord?.sizes?.some((option) => option.label === body.size)) {
      return NextResponse.json({ success: false, error: 'Veo 3.1 Lite accepts only 720p or 1080p at 16:9 or 9:16.' }, { status: 400 });
    }
    if (typeof body.aspectRatio === 'string' && modelRecord?.aspectRatios && !modelRecord.aspectRatios.includes(body.aspectRatio)) {
      return NextResponse.json({ success: false, error: 'Veo 3.1 Lite accepts only 16:9 or 9:16.' }, { status: 400 });
    }
  }

  if (model === SEEDANCE_25_MODEL && body.draft === true && !isSeedanceDraftSize(size?.label)) {
    return NextResponse.json({ success: false, error: 'A Seedance draft is 480p only. Pick a 480p size, or turn Draft off.' }, { status: 400 });
  }

  try {
    const { taskId } = await adapter.createVideo({
      apiKey,
      model,
      prompt,
      images,
      inputMode,
      inputField: videoInput?.field,
      // Snapped to a length this model accepts — vendors reject anything else,
      // and a model that counts frames instead gets no duration at all.
      durationSeconds: resolveDuration(
        body.provider,
        model,
        requestedDuration
      ),
      width: size?.width,
      height: size?.height,
      ...(referenceVideos.length > 0 ? { referenceVideos } : {}),
      ...(referenceAudios.length > 0 ? { referenceAudios } : {}),
      resolution: size?.preset,
      ...(body.provider === 'piapi' || modelRecord?.supportsAudio ? {audio: body.audio === true} : {}),
      ...(model === SEEDANCE_25_MODEL && body.draft === true ? {draft: true} : {}),
      aspectRatio: typeof body.aspectRatio === 'string' ? body.aspectRatio : undefined,
      ...(moderation === 'relaxed' ? {moderation} : {}),
    });
    return NextResponse.json({ success: true, taskId });
  } catch (error) {
    return failure(error, `${adapter.label} could not start this video.`);
  }
}
