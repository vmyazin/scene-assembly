// components/GeminiVideoWorkspace.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import PromptPanel from '@/components/PromptPanel';
import ProviderLogo from '@/components/ProviderLogo';
import ReferenceStack from '@/components/ReferenceStack';
import StoredImagePicker from '@/components/StoredImagePicker';
import SubmissionError from '@/components/SubmissionError';
import { prepareReferences } from '@/lib/draft/ingest';
import { useFileDrop } from '@/lib/drop/use-file-drop';
import { geminiGenerateVideo } from '@/lib/engines/gemini';
import { GEMINI_VIDEO_MODELS } from '@/lib/engines/gemini-video-catalog';
import { keepUploadedImages } from '@/lib/gallery/keep-upload';
import { geminiVideoCost, geminiVideoRateLabel } from '@/lib/spend/rates';
import { FRAME_EXTRACTION_ERROR, isVideoFile, lastFrameAsImageFile } from '@/lib/video-frame';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';
import type { EngineId } from '@/lib/engines/registry';

interface GeminiVideoWorkspaceProps {
  inputMode: 'text' | 'image';
  onBack: () => void;
  onOpenConnections: (provider?: EngineId) => void;
}

/** Veo image-to-video takes one still; the shared picker and stack enforce it. */
const MAX_INPUT_IMAGES = 1;

/** References are held as Files; the stub (and later the SDK) wants bare base64. */
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

export default function GeminiVideoWorkspace({
  inputMode,
  onOpenConnections,
}: GeminiVideoWorkspaceProps) {
  const apiKey = useAppStore((state) => state.apiKey);
  const geminiVideoModel = useAppStore((state) => state.geminiVideoModel);
  const imageFormat = useAppStore((state) => state.imageFormat);
  const prompt = useDraftStore((state) => state.prompt);
  const setPrompt = useDraftStore((state) => state.setPrompt);
  const references = useDraftStore((state) => state.references);

  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [duration, setDuration] = useState<4 | 6 | 8>(8);
  const [error, setError] = useState<string | null>(null);
  const [isReadingFrame, setIsReadingFrame] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addReferencesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const mountedRef = useRef(true);

  const needsKey = !apiKey;
  const gated = isGated(needsKey, false);
  const currentModel = GEMINI_VIDEO_MODELS.find((m) => m.id === geminiVideoModel) || GEMINI_VIDEO_MODELS[0];
  const costEstimate = geminiVideoCost(geminiVideoModel, resolution, duration);
  const rateLabel = geminiVideoRateLabel(geminiVideoModel, resolution);
  const isImageMode = inputMode === 'image';

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

    setError(null);
    try {
      let image: string | undefined;
      if (isImageMode && references[0]) {
        image = bareBase64(await fileAsDataUrl(references[0].file));
      }
      await geminiGenerateVideo({
        model: geminiVideoModel,
        prompt: prompt.trim(),
        image,
        apiKey,
        config: { resolution, durationSeconds: duration },
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Gemini video generation coming soon! For now, try the other providers.';
      toast.info(message);
    }
  };

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

          <div className="grid gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Resolution</span>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                {currentModel.resolutions.map((res) => (
                  <option key={res} value={res}>{res}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Duration</span>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) as 4 | 6 | 8)}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                {currentModel.durations.map((dur) => (
                  <option key={dur} value={dur}>{dur}s</option>
                ))}
              </select>
            </label>
          </div>

          {costEstimate > 0 && (
            <div className="text-sm text-[var(--foreground-muted)]">
              Estimated: ${costEstimate.toFixed(3)} {rateLabel && `(${rateLabel})`}
            </div>
          )}
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

  const actions = (
    <div className="space-y-3">
      <button
        onClick={() => void handleGenerate()}
        disabled={needsKey}
        className="w-full rounded-lg bg-[var(--neon-purple)] px-4 py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Sparkles className="inline-block mr-2 h-4 w-4" />
        Generate video
      </button>

      {error && <SubmissionError message={error} />}

      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-600">
        <strong>Note:</strong> Gemini video generation is now available in the catalog!
        Full async polling support coming in the next update. For now, use other providers for video generation.
      </div>
    </div>
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
        results={null}
      />
    </ConnectionGate>
  );
}
