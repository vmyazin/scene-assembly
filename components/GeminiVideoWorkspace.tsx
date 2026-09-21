// components/GeminiVideoWorkspace.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, Sparkles, Video } from 'lucide-react';
import { toast } from 'sonner';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import JobElapsed from '@/components/JobElapsed';
import LastFrameActions from '@/components/LastFrameActions';
import ModelControls, { type ModelControlField } from '@/components/ModelControls';
import PromptPanel from '@/components/PromptPanel';
import ProviderLogo from '@/components/ProviderLogo';
import ReferenceStack from '@/components/ReferenceStack';
import StoredImagePicker from '@/components/StoredImagePicker';
import SubmissionError from '@/components/SubmissionError';
import VideoPlayer from '@/components/video/VideoPlayer';
import { prepareReferences } from '@/lib/draft/ingest';
import { downloadFilenameBase } from '@/lib/download-name';
import { useFileDrop } from '@/lib/drop/use-file-drop';
import {
  GEMINI_VIDEO_TIMEOUT_MS,
  geminiDownloadVideo,
  geminiGenerateVideo,
  geminiPollVideoOperation,
  geminiVideoWait,
} from '@/lib/engines/gemini';
import {
  GEMINI_VIDEO_MODELS,
  geminiVideoDuration,
  geminiVideoDurationOptions,
  type GeminiVideoModel,
} from '@/lib/engines/gemini-video-catalog';
import { keepUploadedImages } from '@/lib/gallery/keep-upload';
import { extensionForMedia } from '@/lib/media-download';
import { requestPromptSlug } from '@/lib/micro-ai/browser';
import { playGenerationChime } from '@/lib/notify/chime';
import { isRetryableFailure, useAutoRetry } from '@/lib/providers/auto-retry';
import { captureGeminiVideo } from '@/lib/spend/capture';
import { geminiVideoCost, geminiVideoRateLabel } from '@/lib/spend/rates';
import { FRAME_EXTRACTION_ERROR, isVideoFile, lastFrameAsImageFile } from '@/lib/video-frame';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useGalleryStore } from '@/store/useGalleryStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';
import type { EngineId } from '@/lib/engines/registry';

interface GeminiVideoWorkspaceProps {
  inputMode: 'text' | 'image';
  onBack: () => void;
  onOpenConnections: (provider?: EngineId) => void;
  /** Switch this workspace to image-to-video, for continuing from a last frame. */
  onContinueFromFrame?: () => void;
}

/** Veo image-to-video takes one still; the shared picker and stack enforce it. */
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
function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

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
 * Same ModelControls the fal/Kie video workspaces use, so duration sits in a
 * compact field beside resolution toggles instead of a second stacked dropdown.
 * Duration stays a discrete select (4/6/8) because Veo rejects freeform lengths;
 * resolution uses the shared segmented control because Lite only publishes two.
 */
function geminiVideoControlFields(
  model: GeminiVideoModel,
  resolution: string
): ModelControlField[] {
  return [
    {
      key: 'duration',
      label: 'Duration',
      type: 'select',
      defaultValue: geminiVideoDuration(model, undefined, resolution),
      options: geminiVideoDurationOptions(model, resolution).map((seconds) => ({
        label: String(seconds),
        value: seconds,
      })),
    },
    {
      key: 'resolution',
      label: 'Resolution',
      type: 'select',
      defaultValue: model.resolutions[0],
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

function isGeminiResolution(value: string | number | boolean): value is '720p' | '1080p' {
  return value === '720p' || value === '1080p';
}

function isGeminiDuration(value: string | number | boolean): value is 4 | 6 | 8 {
  return value === 4 || value === 6 || value === 8;
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
  const imageFormat = useAppStore((state) => state.imageFormat);
  const prompt = useDraftStore((state) => state.prompt);
  const setPrompt = useDraftStore((state) => state.setPrompt);
  const references = useDraftStore((state) => state.references);

  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [duration, setDuration] = useState<4 | 6 | 8>(8);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [error, setError] = useState<string | null>(null);
  const [isReadingFrame, setIsReadingFrame] = useState(false);
  const [phase, setPhase] = useState<'start' | 'poll' | 'download' | null>(null);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
  const [clips, setClips] = useState<GeminiClip[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addReferencesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const mountedRef = useRef(true);
  const generateRef = useRef<() => void>(() => {});
  const runTokenRef = useRef(0);
  const autoRetry = useAutoRetry();

  const needsKey = !apiKey;
  const gated = isGated(needsKey, false);
  const currentModel = GEMINI_VIDEO_MODELS.find((m) => m.id === geminiVideoModel) || GEMINI_VIDEO_MODELS[0];
  const effectiveDuration = geminiVideoDuration(currentModel, duration, resolution) as 4 | 6 | 8;
  const costEstimate = geminiVideoCost(geminiVideoModel, resolution, effectiveDuration);
  const rateLabel = geminiVideoRateLabel(geminiVideoModel, resolution);
  const isImageMode = inputMode === 'image';
  const isGenerating = phase !== null;

  // Claims the prompt field for motion, so a still-image prompt is not left
  // sitting in this workspace after a tab switch.
  useEffect(() => {
    useDraftStore.getState().enterPromptScope('video');
  }, []);

  // Claim a frame handed over by "Continue from last frame". Switching into
  // image-to-video remounts this workspace, which is why the seed lives in a store.
  useEffect(() => {
    if (!isImageMode) return;
    const seed = useSeedFrameStore.getState().takeSeedFrame();
    if (!seed) return;
    const draft = useDraftStore.getState();
    draft.clearReferences();
    draft.addReferences(
      [{ file: seed.file, sourceLabel: `Last frame of ${seed.sourceLabel.replace(/-/g, ' ')}` }],
      MAX_INPUT_IMAGES
    );
    if (!draft.prompt) {
      draft.setPrompt(`Continue the scene from ${seed.sourceLabel.replace(/-/g, ' ')}.`);
    }
  }, [isImageMode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    useDraftStore.getState().limitReferences(MAX_INPUT_IMAGES);
  }, []);

  useEffect(() => {
    if (!isImageMode) return;

    const onPaste = (event: ClipboardEvent) => {
      const pastedFiles = Array.from(event.clipboardData?.files ?? []).filter(
        (file) => file.type.startsWith('image/') || isVideoFile(file)
      );
      if (pastedFiles.length === 0) return;
      event.preventDefault();
      void addReferencesRef.current(pastedFiles);
    };

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [isImageMode]);

  const addReferences = async (files: File[]) => {
    const usable = files.filter((file) => file.type.startsWith('image/') || isVideoFile(file));
    if (usable.length === 0) {
      setError('Choose an image, or a video to continue from its last frame.');
      return;
    }
    if (references.length + usable.length > MAX_INPUT_IMAGES) {
      setError('This model accepts up to 1 reference image.');
      return;
    }

    setError(null);
    const hasVideo = usable.some(isVideoFile);
    if (hasVideo) setIsReadingFrame(true);
    try {
      const prepared = await Promise.all(
        usable.map(async (file) =>
          isVideoFile(file)
            ? { file: await lastFrameAsImageFile(file), sourceLabel: `Last frame of ${file.name}` }
            : { file, sourceLabel: undefined }
        )
      );
      const converted = await prepareReferences(prepared, imageFormat);
      if (!mountedRef.current) return;
      useDraftStore.getState().addReferences(converted, MAX_INPUT_IMAGES);
      void keepUploadedImages(converted);
    } catch {
      if (mountedRef.current) setError(FRAME_EXTRACTION_ERROR);
    } finally {
      if (mountedRef.current && hasVideo) setIsReadingFrame(false);
    }
  };

  useEffect(() => {
    addReferencesRef.current = addReferences;
  });

  const { isDragging, isFetching, dropProps } = useFileDrop({
    onFiles: (files) => addReferencesRef.current(files),
    onError: setError,
  });

  const removeReference = (index: number) => {
    const reference = references[index];
    if (reference) useDraftStore.getState().removeReference(reference.id);
  };

  const updateControl = (key: string, value: string | number | boolean) => {
    if (key === 'resolution' && isGeminiResolution(value)) {
      setResolution(value);
      if (value === '1080p') setDuration(8);
      return;
    }
    if (key === 'duration' && isGeminiDuration(value)) {
      setDuration(geminiVideoDuration(currentModel, value, resolution) as 4 | 6 | 8);
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
    const started = Date.now();
    setError(null);
    setPhase('start');
    setStartedAt(started);

    let startedOperation = false;
    try {
      let image: string | undefined;
      let imageMimeType: string | undefined;
      if (isImageMode && references[0]) {
        image = bareBase64(await fileAsDataUrl(references[0].file));
        imageMimeType = references[0].file.type || 'image/png';
      }
      const startedJob = await geminiGenerateVideo({
        model: geminiVideoModel,
        prompt: submittedPrompt,
        image,
        imageMimeType,
        apiKey,
        singleAttempt: true,
        config: { resolution, durationSeconds: effectiveDuration, aspectRatio },
      });
      startedOperation = true;
      if (!isCurrent()) return;
      usePromptLibraryStore.getState().remember(submittedPrompt);
      autoRetry.reset();

      let operation = startedJob;
      const deadline = started + GEMINI_VIDEO_TIMEOUT_MS;
      while (!operation.done) {
        if (!isCurrent()) return;
        if (Date.now() >= deadline) {
          throw new Error(
            'Gemini video generation timed out. The job may still finish in AI Studio if you were charged.'
          );
        }
        if (operation.error) break;
        setPhase('poll');
        await geminiVideoWait();
        if (!isCurrent()) return;
        operation = await geminiPollVideoOperation(apiKey, operation.operation, { singleAttempt: true });
      }
      if (operation.error) throw new Error(operation.error);
      if (!operation.videoUri && !operation.videoBytes) {
        throw new Error('Gemini finished without a video. Please try again.');
      }

      setPhase('download');
      const blob = await geminiDownloadVideo(apiKey, operation.videoUri ?? '', {
        singleAttempt: true,
        videoBytes: operation.videoBytes,
        mimeType: operation.mimeType,
      });
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
        finishedAt: Date.now(),
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
        captureGeminiVideo({
          modelId: geminiVideoModel,
          prompt: submittedPrompt,
          inputMode: isImageMode ? 'image' : 'text',
          resolution,
          durationSeconds: effectiveDuration,
          galleryRecordId: record?.id,
        });
      } catch {
        captureGeminiVideo({
          modelId: geminiVideoModel,
          prompt: submittedPrompt,
          inputMode: isImageMode ? 'image' : 'text',
          resolution,
          durationSeconds: effectiveDuration,
        });
      }
    } catch (err) {
      if (!isCurrent()) return;
      const message =
        err instanceof Error ? err.message : 'Gemini could not generate this video.';
      setError(message);
      toast.error(message);
      // A start that never received an operation can be sent again. Poll and
      // download failures belong to a job Google already accepted.
      if (!startedOperation && isRetryableFailure(err)) {
        autoRetry.schedule(() => generateRef.current());
      }
    } finally {
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
              fields={geminiVideoControlFields(currentModel, resolution)}
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            aria-label="Reference image file"
            className="hidden"
            onChange={(event) => {
              void addReferences(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              {...dropProps}
              className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed py-3.5 text-sm transition-colors sm:flex-1 ${isDragging ? 'border-[var(--neon-purple)] bg-[var(--neon-purple)]/10 text-[var(--neon-purple)]' : 'border-[var(--neon-purple)]/30 text-[var(--foreground-muted)] hover:border-[var(--neon-purple)] hover:bg-[var(--neon-purple)]/5 hover:text-[var(--neon-purple)]'}`}
            >
              {isReadingFrame || isFetching ? <Loader2 className="animate-spin" size={28} /> : <ImagePlus size={28} />}
              {isReadingFrame
                ? 'Reading last frame…'
                : isFetching
                  ? 'Fetching dropped image…'
                  : isDragging
                    ? 'Drop to use as a source'
                    : 'Drop, upload, or paste an image or video'}
            </button>
            {references.length < MAX_INPUT_IMAGES && (
              <StoredImagePicker referenceLimit={MAX_INPUT_IMAGES} />
            )}
          </div>
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
            onRemove={removeReference}
          />
        </section>
      )}
    </>
  );

  const phaseLabel =
    phase === 'download' ? 'Downloading video…' : phase === 'poll' ? 'Waiting for Veo…' : 'Starting…';

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
            {costEstimate > 0 && (
              <span className="font-normal opacity-80">{` · ~$${costEstimate.toFixed(2)}`}</span>
            )}
          </>
        )}
      </button>
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
    <section className="glass-card min-h-[420px] space-y-3 p-3.5 md:p-4">
      <div>
        <h3 className="display text-base font-semibold">Result</h3>
        <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
          Finished clips stay here while you keep generating.
        </p>
      </div>
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
        return (
          <article key={clip.id} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]/60 p-4">
            <VideoPlayer src={clip.src} label="Generated video" className="max-h-[520px] w-full rounded-lg" />
            <button
              type="button"
              onClick={() => {
                setDownloadingId(clip.id);
                try {
                  downloadBlob(clip.blob, `${filenameBase}.${extensionForMedia('video', clip.blob.type)}`);
                } finally {
                  setDownloadingId(null);
                }
              }}
              className="btn-secondary flex w-full items-center justify-center gap-2"
            >
              {downloadingId === clip.id ? <Loader2 className="animate-spin" size={17} /> : <Download size={17} />}
              {downloadingId === clip.id ? 'Preparing download…' : 'Download video'}
            </button>
            <LastFrameActions
              videoUrl={clip.src}
              filenameBase={filenameBase}
              onContinue={onContinueFromFrame}
            />
          </article>
        );
      })}
    </section>
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
            <AutoExpandingPrompt
              aria-label="Prompt"
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
