// components/GeminiVideoWorkspace.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, Video } from 'lucide-react';
import { toast } from 'sonner';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import JobElapsed from '@/components/JobElapsed';
import ModelControls, { type ModelControlField } from '@/components/ModelControls';
import PromptPanel from '@/components/PromptPanel';
import SavedPromptsButton from '@/components/SavedPromptsButton';
import ProviderLogo from '@/components/ProviderLogo';
import ReferenceStack from '@/components/ReferenceStack';
import ResultPanel from '@/components/ResultPanel';
import SubmissionError from '@/components/SubmissionError';
import { FinishedVideoActions } from '@/components/VideoResult';
import VideoPlayer from '@/components/video/VideoPlayer';
import { downloadFilenameBase } from '@/lib/download-name';
import {
  GEMINI_VIDEO_POLL_FAILURE_LIMIT,
  GEMINI_VIDEO_SAFETY_MESSAGE,
  GEMINI_VIDEO_TIMEOUT_MS,
  geminiDeleteVideoInteraction,
  geminiDownloadVideo,
  geminiGenerateVideo,
  geminiPollVideoOperation,
  geminiVideoWait,
} from '@/lib/engines/gemini';
import { GEMINI_VIDEO_MODELS, geminiVideoDuration, geminiVideoDurationOptions, type GeminiVideoModel } from '@/lib/engines/gemini-video-catalog';
import { extensionForMedia } from '@/lib/media-download';
import { requestPromptSlug } from '@/lib/micro-ai/browser';
import { playGenerationChime } from '@/lib/notify/chime';
import { isRetryableFailure, useAutoRetry } from '@/lib/providers/auto-retry';
import { routeStatus } from '@/lib/providers/route-error';
import { captureGeminiVideo } from '@/lib/spend/capture';
import { geminiVideoCost, geminiVideoPriceNotice, geminiVideoRateLabel } from '@/lib/spend/rates';
import { isVideoFile } from '@/lib/video-frame';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useGalleryStore } from '@/store/useGalleryStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import type { EngineId } from '@/lib/engines/registry';
import { fileAsDataUrl } from '@/lib/file-data-url';
import { useClaimSeedFrame, useReferenceIntake } from '@/hooks/useReferenceIntake';
import { ReferencePicker } from '@/components/ReferencePicker';
import { removeReferenceAt, useMountedRef, usePromptScope, useReferenceLimit } from '@/hooks/useWorkspaceLifecycle';

interface GeminiVideoWorkspaceProps {
  inputMode: 'text' | 'image';
  onBack: () => void;
  onOpenConnections: (provider?: EngineId) => void;
  /** Switch this workspace to image-to-video, for continuing from a last frame. */
  onContinueFromFrame?: () => void;
}

/** Omni image-to-video takes one still; the shared picker and stack enforce it. */
const MAX_INPUT_IMAGES = 1;

interface GeminiClip {
  id: string;
  src: string;
  blob: Blob;
  prompt: string;
  slug?: string;
  modelId: string;
  startedAt: number;
  finishedAt: number;
  costUsd: number;
}

/** References are held as Files; the SDK wants bare base64. */
function bareBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * At module scope because the purity lint reads the component body as render
 * scope and rejects a `Date.now()` there, even inside an async handler.
 */
const now = () => Date.now();

/**
 * Same ModelControls the fal/Kie video workspaces use, so duration sits in a
 * compact field beside resolution toggles instead of a second stacked dropdown.
 * Duration stays a discrete select (3–10) because Omni rejects freeform lengths;
 * resolution uses the shared segmented control.
 */
function geminiVideoControlFields(model: GeminiVideoModel): ModelControlField[] {
  return [
    {
      key: 'duration',
      label: 'Duration',
      type: 'select',
      defaultValue: geminiVideoDuration(model, undefined),
      options: geminiVideoDurationOptions(model).map((seconds) => ({
        label: String(seconds),
        value: seconds,
      })),
    },
    {
      key: 'resolution',
      label: 'Resolution',
      type: 'select',
      defaultValue: model.defaultResolution,
      options: model.resolutions.map((value) => ({ label: value, value })),
    },
    {
      key: 'aspectRatio',
      label: 'Aspect ratio',
      type: 'select',
      defaultValue: model.aspectRatios[0],
      options: model.aspectRatios.map((value) => ({ label: value, value })),
    },
  ];
}

function isGeminiResolution(value: string | number | boolean, resolutions: readonly string[]): value is string {
  return typeof value === 'string' && resolutions.includes(value);
}

function isGeminiDuration(value: string | number | boolean): value is number {
  return typeof value === 'number' && value >= 3 && value <= 10;
}

function isGeminiAspectRatio(value: string | number | boolean): value is '16:9' | '9:16' {
  return value === '16:9' || value === '9:16';
}

export default function GeminiVideoWorkspace({
  inputMode,
  onOpenConnections,
  onContinueFromFrame,
}: GeminiVideoWorkspaceProps) {
  const apiKey = useAppStore((state) => state.apiKey);
  const geminiVideoModel = useAppStore((state) => state.geminiVideoModel);
  const prompt = useDraftStore((state) => state.prompt);
  const setPrompt = useDraftStore((state) => state.setPrompt);
  const references = useDraftStore((state) => state.references);

  const [resolution, setResolution] = useState(GEMINI_VIDEO_MODELS[0].defaultResolution);
  const [duration, setDuration] = useState(GEMINI_VIDEO_MODELS[0].defaultDuration);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'start' | 'poll' | 'download' | null>(null);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const [clips, setClips] = useState<GeminiClip[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const mountedRef = useMountedRef();
  const generateRef = useRef<() => void>(() => {});
  const runTokenRef = useRef(0);
  const autoRetry = useAutoRetry();

  const needsKey = !apiKey;
  const gated = isGated(needsKey, false);
  const currentModel = GEMINI_VIDEO_MODELS.find((m) => m.id === geminiVideoModel) || GEMINI_VIDEO_MODELS[0];
  // Number() tells React Compiler this is a primitive. Otherwise it treats the
  // helper's result as mutable and, because handleGenerate captures it, reports
  // that handler's Date.now() calls as impure work during render.
  const effectiveDuration = Number(geminiVideoDuration(currentModel, duration));
  const costEstimate = geminiVideoCost(geminiVideoModel, resolution, effectiveDuration);
  const priceNotice = geminiVideoPriceNotice(geminiVideoModel, resolution, effectiveDuration);
  const rateLabel = geminiVideoRateLabel(geminiVideoModel, resolution);
  const isImageMode = inputMode === 'image';
  const isGenerating = phase !== null;

  // Claims the prompt field for motion, so a still-image prompt is not left
  // sitting in this workspace after a tab switch.
  usePromptScope('video');
  useReferenceLimit(MAX_INPUT_IMAGES);

  // Switching into image-to-video remounts this workspace, which is why the
  // seed lives in a store.
  useClaimSeedFrame(isImageMode, MAX_INPUT_IMAGES, String(isImageMode));
  const { addFiles: addReferences, isReadingFrame, isDragging, isFetching, dropProps } = useReferenceIntake({
    referenceCount: references.length,
    maxImages: MAX_INPUT_IMAGES,
    accept: (file) => file.type.startsWith('image/') || isVideoFile(file),
    unusableMessage: 'Choose an image, or a video to continue from its last frame.',
    tooManyMessage: 'This model accepts up to 1 reference image.',
    pasteEnabled: isImageMode,
    onError: setError,
  });

  const updateControl = (key: string, value: string | number | boolean) => {
    if (key === 'resolution' && isGeminiResolution(value, currentModel.resolutions)) {
      setResolution(value);
      return;
    }
    if (key === 'duration' && isGeminiDuration(value)) {
      setDuration(geminiVideoDuration(currentModel, value));
      return;
    }
    if (key === 'aspectRatio' && isGeminiAspectRatio(value)) {
      setAspectRatio(value);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Enter a prompt for your video');
      toast.error('Enter a prompt for your video');
      return;
    }
    if (isImageMode && references.length === 0) {
      setError('Add the image this clip should start from.');
      return;
    }
    if (needsKey) {
      setError('A Gemini API key is required.');
      return;
    }

    const submittedPrompt = prompt.trim();
    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;
    const isCurrent = () => mountedRef.current && runTokenRef.current === runToken;
    const started = now();
    setError(null);
    setPhase('start');
    setStartedAt(started);

    let startedOperation = false;
    // Google said the job failed or was blocked, so there is no charge to record.
    let reportedFailure = false;
    let generated = false;
    let galleryRecordId: string | undefined;
    try {
      let image: string | undefined;
      let imageMimeType: string | undefined;
      if (isImageMode && references[0]) {
        image = bareBase64(await fileAsDataUrl(references[0].file, 'Could not read that image.'));
        imageMimeType = references[0].file.type || 'image/png';
      }
      const startedJob = await geminiGenerateVideo({
        model: geminiVideoModel,
        prompt: submittedPrompt,
        image,
        imageMimeType,
        apiKey,
        config: { resolution, durationSeconds: effectiveDuration, aspectRatio },
      });
      startedOperation = true;
      if (!isCurrent()) return;
      usePromptLibraryStore.getState().remember(submittedPrompt);
      autoRetry.reset();

      let operation = startedJob;
      const deadline = started + GEMINI_VIDEO_TIMEOUT_MS;
      let pollFailures = 0;
      let skipWait = false;
      while (!operation.done) {
        if (!isCurrent()) return;
        if (now() >= deadline) {
          throw new Error(
            'Gemini video generation timed out. The job may still finish in AI Studio if you were charged.'
          );
        }
        if (operation.error) break;
        setPhase('poll');
        if (!skipWait) await geminiVideoWait();
        if (!isCurrent()) return;
        const previousKind = operation.kind;
        try {
          operation = await geminiPollVideoOperation(apiKey, operation);
        } catch (pollError) {
          // The job is already running and paid for. A blip must not abandon
          // it, so a retryable failure waits for the next poll.
          pollFailures += 1;
          if (isRetryableFailure(pollError) && pollFailures < GEMINI_VIDEO_POLL_FAILURE_LIMIT) {
            skipWait = false;
            continue;
          }
          const reason = pollError instanceof Error ? pollError.message : 'Gemini could not check this video job.';
          // A block is Google's answer, not a lost job: nothing to check in AI Studio.
          if (reason === GEMINI_VIDEO_SAFETY_MESSAGE) {
            reportedFailure = true;
            throw pollError;
          }
          throw new Error(`${reason} The video may still finish in AI Studio. Check there before trying again.`);
        }
        pollFailures = 0;
        // The interaction just handed over its file, which is often ready
        // already, so check it without another full wait.
        skipWait = previousKind === 'interaction' && operation.kind === 'file';
      }
      if (operation.error) {
        reportedFailure = true;
        throw new Error(operation.error);
      }
      if (!operation.videoUri && !operation.videoBytes) {
        throw new Error('Gemini finished without a video. Please try again.');
      }

      // Google has completed the paid generation even if transfer or storage fails.
      generated = true;
      setPhase('download');
      const blob = await geminiDownloadVideo(apiKey, operation.videoUri ?? '', {
        videoBytes: operation.videoBytes,
        mimeType: operation.mimeType,
      });
      // The clip is local now. Background mode stored the prompt and any
      // reference image with the interaction, so clear it.
      void geminiDeleteVideoInteraction(apiKey, operation.interactionId);
      if (!isCurrent()) return;

      const slug = await requestPromptSlug(submittedPrompt, apiKey);
      const src = URL.createObjectURL(blob);
      const clip: GeminiClip = {
        id: `gemini-video-${started}`,
        src,
        blob,
        prompt: submittedPrompt,
        slug: slug ?? undefined,
        modelId: geminiVideoModel,
        startedAt: started,
        finishedAt: now(),
        costUsd: costEstimate,
      };
      setClips((current) => [clip, ...current]);
      playGenerationChime();
      toast.success('Video generated');

      try {
        const record = await useGalleryStore.getState().record({
          kind: 'video',
          prompt: submittedPrompt,
          slug: slug ?? undefined,
          provider: 'gemini',
          modelId: geminiVideoModel,
          inputMode: isImageMode ? 'image' : 'text',
          controlValues: {
            resolution,
            duration: effectiveDuration,
            aspect_ratio: aspectRatio,
          },
          mimeType: blob.type || 'video/mp4',
          blob,
        });
        galleryRecordId = record?.id;
      } catch {
        // Library persistence is best effort; the completed generation still costs money.
      }
    } catch (err) {
      if (!isCurrent()) return;
      const message =
        err instanceof Error ? err.message : 'Gemini could not generate this video.';
      setError(message);
      toast.error(message);
      // Only an explicit quota rejection is safe to resubmit automatically. A
      // lost response or server error may hide an already accepted paid job.
      if (!startedOperation && routeStatus(err) === 429) {
        autoRetry.schedule(() => generateRef.current());
      }
    } finally {
      // A started job that ended without a clip or a reported failure (timed
      // out, lost its polls, or the tab moved on) may still be billed, so it
      // gets an unknown-cost row instead of none.
      if (generated || (startedOperation && !reportedFailure)) {
        captureGeminiVideo({
          modelId: geminiVideoModel,
          prompt: submittedPrompt,
          inputMode: isImageMode ? 'image' : 'text',
          resolution,
          durationSeconds: effectiveDuration,
          galleryRecordId,
          ...(generated ? {} : { unconfirmed: true }),
        });
      }
      if (isCurrent()) {
        setPhase(null);
      }
    }
  };

  useEffect(() => {
    generateRef.current = () => void handleGenerate();
  });

  const setup = (
    <>
      <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)] p-4">
        <div className="flex items-center gap-2">
          <ProviderLogo provider="gemini" size={20} />
          <h3 className="font-semibold">Gemini · {currentModel.label}</h3>
        </div>

        <div className="space-y-3">
          <div className="text-sm text-[var(--foreground-muted)]">
            {currentModel.note}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ModelControls
              namespace="gemini-video"
              fields={geminiVideoControlFields(currentModel)}
              values={{ duration: effectiveDuration, resolution, aspectRatio }}
              onChange={updateControl}
            />
          </div>
        </div>
      </div>

      {isImageMode && (
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)] p-4">
          <div>
            <h3 className="display text-base font-semibold">Reference image</h3>
            <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
              Upload one still; files are forwarded to Gemini only for this task. Pick a saved clip and its last frame is used.
            </p>
          </div>
          <ReferencePicker
            accept="image/*,video/*"
            multiple={false}
            inputLabel="Reference image file"
            accent="purple"
            idleLabel="Drop, upload, or paste an image or video"
            referenceCount={references.length}
            referenceLimit={MAX_INPUT_IMAGES}
            intake={{ addFiles: addReferences, isReadingFrame, isFetching, isDragging, dropProps }}
          />
          <ReferenceStack
            layout="grid"
            replaceLimit={MAX_INPUT_IMAGES}
            captionClassName="text-[0.65rem] font-medium text-[var(--neon-purple)]"
            items={references.map((reference, index) => ({
              id: reference.id,
              src: reference.previewUrl,
              alt: `Reference ${index + 1}`,
              removeLabel: `Remove reference ${index + 1}`,
              sourceLabel: reference.sourceLabel,
            }))}
            onRemove={removeReferenceAt}
          />
        </section>
      )}
    </>
  );

  const phaseLabel =
    phase === 'download' ? 'Downloading video…' : phase === 'poll' ? 'Waiting for Omni…' : 'Starting…';

  const actions = (
    <div className="space-y-3">
      <button
        onClick={() => {
          autoRetry.reset();
          void handleGenerate();
        }}
        disabled={needsKey || isGenerating}
        className="w-full rounded-lg bg-[var(--neon-purple)] px-4 py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isGenerating ? (
          <>
            <Loader2 className="inline-block mr-2 h-4 w-4 animate-spin" />
            {phaseLabel}
          </>
        ) : (
          <>
            <Sparkles className="inline-block mr-2 h-4 w-4" />
            Generate video
            {costEstimate > 0 ? (
              <span className="font-normal opacity-80">{` · ~$${costEstimate.toFixed(2)}`}</span>
            ) : priceNotice ? (
              <span className="font-normal opacity-80"> · price unknown</span>
            ) : null}
          </>
        )}
      </button>
      {priceNotice && !isGenerating && (
        <p className="text-sm text-[var(--foreground-muted)]">{priceNotice}</p>
      )}
      {isGenerating && (
        <p className="text-sm text-[var(--foreground-muted)]">
          {phaseLabel}{' '}
          <JobElapsed startedAt={startedAt} />
          {rateLabel ? ` · ${rateLabel}` : ''}
        </p>
      )}

      {error && (
        <SubmissionError message={error} retry={autoRetry.pending} onCancelRetry={autoRetry.cancel} />
      )}
    </div>
  );

  const results = (
    <ResultPanel description="Finished clips stay here while you keep generating.">
      {isGenerating && clips.length === 0 && (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] p-5 text-center text-[var(--foreground-muted)]">
          <Loader2 className="animate-spin opacity-60" size={36} />
          <p>{phaseLabel}</p>
        </div>
      )}
      {!isGenerating && clips.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] p-5 text-center text-[var(--foreground-muted)]">
          <Video className="mx-auto mb-3 opacity-35" size={46} />
          <p>Your videos will appear here.</p>
        </div>
      )}
      {clips.map((clip) => {
        const filenameBase = downloadFilenameBase({
          prompt: clip.prompt,
          mediaType: 'video',
          slug: clip.slug,
          provider: 'gemini',
          modelId: clip.modelId,
        });
        const extension = extensionForMedia('video', clip.blob.type);
        return (
          <article key={clip.id} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]/60 p-4">
            <VideoPlayer src={clip.src} label="Generated video" className="max-h-[520px] w-full rounded-lg" />
            <FinishedVideoActions
              url={clip.src}
              filenameBase={filenameBase}
              extension={extension}
              busy={downloadingId === clip.id}
              onDownload={() => {
                setDownloadingId(clip.id);
                try {
                  downloadBlob(clip.blob, `${filenameBase}.${extension}`);
                } finally {
                  setDownloadingId(null);
                }
              }}
              onContinueFromFrame={onContinueFromFrame}
            />
          </article>
        );
      })}
    </ResultPanel>
  );

  return (
    <ConnectionGate
      provider="gemini"
      label="Gemini"
      storage="browser"
      needsKey={needsKey}
      onConnect={() => onOpenConnections('gemini')}
    >
      <GenerationWorkspaceLayout
        setup={setup}
        prompt={
          <PromptPanel paused={gated} hasPrompt={prompt.trim().length > 0}>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="gemini-video-prompt" className="display block text-base font-semibold">Prompt</label>
              <SavedPromptsButton />
            </div>
            <AutoExpandingPrompt
              id="gemini-video-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Describe the video you want to create${isImageMode ? ' (the image will be animated)' : ''}...`}
            />
          </PromptPanel>
        }
        actions={actions}
        results={results}
      />
    </ConnectionGate>
  );
}
