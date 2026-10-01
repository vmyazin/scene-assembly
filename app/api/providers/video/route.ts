// app/api/providers/video/route.ts
import { editSettingsError } from '@/lib/providers/video-edit';
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

  if (body.operation === 'status') {
    if (typeof body.taskId !== 'string' || !body.taskId) {
      return NextResponse.json({ success: false, error: 'A task ID is required' }, { status: 400 });
    }
    try {
      const task = await adapter.pollVideo({ apiKey, taskId: body.taskId });
      if(body.provider==='runware' && (task.state==='success'||task.state==='error') && typeof body.sourceVideo==='string' && /^[a-f\d-]{36}$/i.test(body.sourceVideo)) await runwareDeleteMedia(apiKey,body.sourceVideo).catch(()=>{});
      return NextResponse.json({ success: true, task });
    } catch (error) {
      return failure(error, `${adapter.label} could not report this task.`);
    }
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
  }

  const images = Array.isArray(body.images)
    ? body.images.filter((image): image is string => typeof image === 'string' && image.startsWith('data:'))
    : [];

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
    const capability = modelRecord?.videoEdit;
    if (!capability || body.provider !== 'runware' || typeof body.sourceVideo !== 'string' || !/^[a-f\d-]{36}$/i.test(body.sourceVideo)) return NextResponse.json({success: false, error: 'Upload a source video for this editing model.'}, {status: 400});
    if (body.durationSeconds !== undefined || body.aspectRatio !== undefined || body.width !== undefined || body.height !== undefined) return NextResponse.json({success: false, error: 'Edits inherit source duration and aspect ratio.'}, {status: 400});
    const size = capability.sizes.find(size => size.label === body.size);
    const settingsError = editSettingsError(capability, {size: body.size, draft: body.draft, audio: body.audio, resolution: body.resolution});
    if (settingsError || images.length > capability.maxImages) return NextResponse.json({success: false, error: settingsError ?? `Add up to ${capability.maxImages} replacement images.`}, {status: 400});
    try {
      const {taskId} = await adapter.createVideo({apiKey, model, prompt, inputMode, sourceVideo: body.sourceVideo, images, resolution: size?.preset, ...(capability.draftRate ? {draft: body.draft === true} : {})});
      return NextResponse.json({success: true, taskId});
    } catch (error) { return failure(error, 'Could not start this video edit.'); }
  }
  if (body.sourceVideo !== undefined) return NextResponse.json({success: false, error: 'Source video requires Edit video mode.'}, {status: 400});
  const videoInput = resolveVideoInput(body.provider, model, inputMode);
  if (hasExplicitInputMode && inputMode !== 'text') {
    if (!videoInput) {
      return NextResponse.json(
        { success: false, error: 'This model has no supported video image input' },
        { status: 400 }
      );
    }
    const required = inputMode === 'frames' ? 2 : 1;
    if (images.length < required) {
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
      resolution: size?.preset,
      ...(body.provider === 'piapi' || modelRecord?.supportsAudio ? {audio: body.audio === true} : {}),
      aspectRatio: typeof body.aspectRatio === 'string' ? body.aspectRatio : undefined,
    });
    return NextResponse.json({ success: true, taskId });
  } catch (error) {
    return failure(error, `${adapter.label} could not start this video.`);
  }
}
