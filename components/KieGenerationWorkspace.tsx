'use client';

import { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
import CloudExecutionNotice from '@/components/account/CloudExecutionNotice';
import CloudJobPanel from '@/components/account/CloudJobPanel';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, ImagePlus, Loader2, Search, Sparkles, Video } from 'lucide-react';
import { toast } from 'sonner';
import ProviderLogo from '@/components/ProviderLogo';
import ReferenceStack from '@/components/ReferenceStack';
import { useFileDrop } from '@/lib/drop/use-file-drop';
import { requestExamplePrompt, requestPromptSlug } from '@/lib/micro-ai/browser';
import { fetchKieCredits, submitKieJob, uploadKieFiles } from '@/lib/kie/browser';
import { defaultKieValues, modelsForKieMode, resolveKieVariant, validateKieInput } from '@/lib/kie/catalog';
import ModelListbox from '@/components/ModelListbox';
import { KIE_IMAGE_COLUMNS, KIE_VIDEO_COLUMNS, kieImageSpecs, kieVideoSpecs } from '@/lib/models/listbox-specs';
import { currentKieTime, isKieJobTerminal } from '@/lib/kie/queue';
import type { KieFieldDefinition, KieInputMode, KieJob, MediaType } from '@/lib/kie/types';
import {
  downloadRemoteMedia,
  extensionForMedia,
  isDownloadableMediaUrl,
} from '@/lib/media-download';
import { downloadFilenameBase } from '@/lib/download-name';
import { useAppStore } from '@/store/useAppStore';
import { useKieJobsStore } from '@/store/useKieJobsStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';
import { prepareReferences } from '@/lib/draft/ingest';
import { keepUploadedImages } from '@/lib/gallery/keep-upload';
import { useDraftStore } from '@/store/useDraftStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import { candidatesFromValues, useAutoAspect } from '@/lib/draft/aspect-match';
import { carryOverValues } from '@/lib/draft/carry-over';
import { FRAME_EXTRACTION_ERROR, isVideoFile, lastFrameAsImageFile } from '@/lib/video-frame';
import LastFrameActions from '@/components/LastFrameActions';
import ResultStack, { type ResultStackItem } from '@/components/ResultStack';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import PromptPanel from '@/components/PromptPanel';
import ModelControls, { type ModelControlField } from '@/components/ModelControls';
import StoredImagePicker from '@/components/StoredImagePicker';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import SubmissionError from '@/components/SubmissionError';
import {
  AUTO_RETRY_DELAY_SECONDS,
  isRetryableFailure,
  useAutoRetry,
} from '@/lib/providers/auto-retry';
import type { EngineId } from '@/lib/engines/registry';
import VideoPlayer from '@/components/video/VideoPlayer';
import JobElapsed from '@/components/JobElapsed';

interface KieGenerationWorkspaceProps {
  mediaType: MediaType;
  inputMode: KieInputMode;
  onBack: () => void;
  onOpenConnections: (provider?: EngineId) => void;
  title?: string;
  description?: string;
  initialPrompt?: string;
  exampleFeatureId?: string;
  engineSelector?: ReactNode;
  /** Switch this workspace to image-to-video, for continuing from a last frame. */
  onContinueFromFrame?: () => void;
  /** Switch to image-to-video, seeded with a finished image result. */
  onUseAsFirstFrame?: () => void;
}

type KieModelControlField = Omit<KieFieldDefinition, 'type'> & {
  type: ModelControlField['type'];
};

const isKieModelControlField = (field: KieFieldDefinition): field is KieModelControlField =>
  field.type !== 'file';

const titleFor = (mediaType: MediaType, inputMode: KieInputMode) =>
  `${inputMode === 'text' ? 'Text' : 'Image'} to ${mediaType}`;

function modelPreferenceKey(mediaType: MediaType): 'kieImageModel' | 'kieVideoModel' {
  return mediaType === 'image' ? 'kieImageModel' : 'kieVideoModel';
}

export default function KieGenerationWorkspace({
  mediaType,
  inputMode,
  onBack,
  onOpenConnections,
  title,
  description,
  initialPrompt = '',
  exampleFeatureId,
  engineSelector,
  onContinueFromFrame,
  onUseAsFirstFrame,
}: KieGenerationWorkspaceProps) {
  const geminiApiKey = useAppStore((state) => state.apiKey);
  const imageFormat = useAppStore((state) => state.imageFormat);
  const kieApiKey = useAppStore((state) => state.kieApiKey);
  const kieImageModel = useAppStore((state) => state.kieImageModel);
  const kieVideoModel = useAppStore((state) => state.kieVideoModel);
  const setKieImageModel = useAppStore((state) => state.setKieImageModel);
  const setKieVideoModel = useAppStore((state) => state.setKieVideoModel);
  const jobs = useKieJobsStore((state) => state.jobs);
  const cloudWorkspace=useCloudWorkspace('kie');
  const needsKey = cloudWorkspace.cloud ? !cloudWorkspace.connected : !kieApiKey.trim();
  const gated = isGated(needsKey, cloudWorkspace.cloud ? cloudWorkspace.hasJobs : jobs.length > 0);
  const upsertJob = useKieJobsStore((state) => state.upsertJob);

  const models = useMemo(() => modelsForKieMode(mediaType, inputMode), [inputMode, mediaType]);
  const preference = mediaType === 'image' ? kieImageModel : kieVideoModel;
  const selectedModel = models.find((model) => model.id === preference) ?? models[0];
  const variant = resolveKieVariant(selectedModel.id, inputMode);
  const variantKey = `${selectedModel.id}:${inputMode}`;
  const prompt = useDraftStore((state) => state.prompt);
  const setPrompt = useDraftStore((state) => state.setPrompt);

  // Claims the prompt field for this kind of work, dropping a prompt written
  // for the other kind. Declared ahead of every other mount effect here so a
  // stale prompt cannot outlive this line and block what those effects set.
  useEffect(() => {
    useDraftStore.getState().enterPromptScope(mediaType === 'video' ? 'video' : 'image');
  }, [mediaType]);
  const references = useDraftStore((state) => state.references);
  const controlValues = useDraftStore((state) => state.controlValues);
  const [valuesByVariant, setValuesByVariant] = useState<
    Record<string, Record<string, string | number | boolean>>
  >({});
  const values =
    valuesByVariant[variantKey] ??
    carryOverValues(variant.fields, defaultKieValues(variant), controlValues);
  const [modelSearch, setModelSearch] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isGeneratingExample, setIsGeneratingExample] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isReadingFrame, setIsReadingFrame] = useState(false);
  const autoRetry = useAutoRetry();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Latest addReferences, so the paste listener attaches once instead of per render.
  const addReferencesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const mountedRef = useRef(true);
  const maxInputImages = variant.maxInputImages ?? 1;
  const matchingModels = models.filter((model) =>
    `${model.label} ${model.provider}`.toLowerCase().includes(modelSearch.toLowerCase())
  );
  const matchingJobs = jobs.filter(
    (job) => job.modelId === selectedModel.id && job.mediaType === mediaType && job.inputMode === inputMode
  );
  const latestJob = matchingJobs[0];
  const resultUrl = latestJob?.state === 'success' ? latestJob.resultUrls[0] : undefined;
  /**
   * The image stack, straight off the job list this panel already keeps —
   * no parallel state, so results stay visible for exactly as long as the
   * store lists them.
   */
  const imageResults: ResultStackItem[] =
    mediaType === 'image'
      ? matchingJobs.flatMap((job) =>
          job.state === 'success' && job.resultUrls[0]
            ? [
                {
                  id: job.id,
                  src: job.resultUrls[0],
                  provider: 'kie',
                  modelId: job.modelId,
                  createdAt: job.createdAt,
                  // `updatedAt` is the poll that saw it finish, so this is
                  // submit-to-result including queue time. Kie reports no cost
                  // per task — only a credit balance — so the footer omits it.
                  startedAt: job.createdAt,
                  finishedAt: job.updatedAt,
                },
              ]
            : []
        )
      : [];
  const resolvedExampleFeatureId =
    exampleFeatureId ?? (mediaType === 'video' ? `${inputMode}-to-video` : 'text-to-image');

  // Claim a frame handed over by "Continue from last frame".
  useEffect(() => {
    if (inputMode !== 'image') return;
    const seed = useSeedFrameStore.getState().takeSeedFrame();
    if (!seed) return;
    const draft = useDraftStore.getState();
    draft.clearReferences();
    draft.addReferences(
      [{ file: seed.file, sourceLabel: `Last frame of ${seed.sourceLabel.replace(/-/g, ' ')}` }],
      1
    );
    if (!draft.prompt) {
      draft.setPrompt(`Continue the scene from ${seed.sourceLabel.replace(/-/g, ' ')}.`);
    }
  }, [inputMode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A stricter model must not keep more references than it accepts.
  useEffect(() => {
    useDraftStore.getState().limitReferences(maxInputImages);
  }, [maxInputImages]);

  // Seed the feature's example prompt, but never over something already typed.
  useEffect(() => {
    const draft = useDraftStore.getState();
    if (initialPrompt && !draft.prompt) draft.setPrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (inputMode !== 'image') return;

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
  }, [inputMode]);

  const updateValues = (key: string, value: string | number | boolean) => {
    setValuesByVariant((current) => ({
      ...current,
      [variantKey]: { ...values, [key]: value },
    }));
    // Remembered globally so the next model inherits whatever it can express.
    useDraftStore.getState().rememberControlValues({ [key]: value });
  };

  // Adding a reference snaps the aspect ratio to the closest one this
  // variant publishes.
  const aspectField = variant.fields.find(
    (field) => field.key === 'aspect_ratio' && field.type === 'select'
  );
  const aspectCandidates = candidatesFromValues(
    (aspectField?.options ?? []).map((option) => option.value)
  );
  useAutoAspect(references[0], aspectCandidates, (value) => {
    if (value !== values.aspect_ratio) updateValues('aspect_ratio', value);
  });

  const setModel = (modelId: string) => {
    setError(null);
    autoRetry.reset();
    const setter = modelPreferenceKey(mediaType) === 'kieImageModel' ? setKieImageModel : setKieVideoModel;
    setter(modelId);
  };

  const addReferences = async (files: File[]) => {
    const usable = files.filter((file) => file.type.startsWith('image/') || isVideoFile(file));
    if (usable.length === 0) {
      setError('Choose an image, or a video to continue from its last frame.');
      return;
    }
    if (references.length + usable.length > maxInputImages) {
      setError(`This model accepts up to ${maxInputImages} reference image${maxInputImages === 1 ? '' : 's'}.`);
      return;
    }

    setError(null);
    const hasVideo = usable.some(isVideoFile);
    if (hasVideo) setIsReadingFrame(true);
    try {
      // A picked video stands in for its final frame, so a clip saved earlier
      // can seed the next one without a round trip through a provider.
      const prepared = await Promise.all(
        usable.map(async (file) =>
          isVideoFile(file)
            ? { file: await lastFrameAsImageFile(file), sourceLabel: `Last frame of ${file.name}` }
            : { file, sourceLabel: undefined }
        )
      );
      // Re-encoded before any provider sees it: nano banana returns PNG, which
      // is both the largest upload and the format providers handle worst.
      const converted = await prepareReferences(prepared, imageFormat);
      if (!mountedRef.current) return;
      useDraftStore.getState().addReferences(converted, maxInputImages);
      // Kept for next time, in this browser and in the cloud library when
      // there is an account to hold it. Deliberately not awaited: the
      // reference is already in the draft, and storing it must not delay the
      // press that follows.
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

  // Served by the shared micro-AI tier when the deployment has one, otherwise by
  // the user's own Gemini key; the route says which when neither is available.
  const generateExample = async () => {
    setIsGeneratingExample(true);
    setError(null);
    try {
      setPrompt(await requestExamplePrompt(resolvedExampleFeatureId, geminiApiKey));
    } catch (exampleError) {
      const message = exampleError instanceof Error
        ? exampleError.message
        : 'Could not generate an example prompt.';
      setError(message);
      toast.error(message);
    } finally {
      setIsGeneratingExample(false);
    }
  };

  // Ask flash-lite for a short evocative filename slug and pin it to the job, so
  // the download is named after the prompt rather than the provider's task ID.
  // Fire-and-forget — downloadResult() falls back to a client-side slug.
  const attachSlug = async (jobId: string, jobPrompt: string) => {
    const slug = await requestPromptSlug(jobPrompt, geminiApiKey);
    if (!slug) return;
    const latest = useKieJobsStore.getState().jobs.find((job) => job.id === jobId);
    if (!latest || latest.slug) return;
    upsertJob({ ...latest, slug });
  };

  const filenameBaseFor = (job: KieJob) =>
    downloadFilenameBase({
      prompt: job.prompt,
      mediaType,
      slug: job.slug,
      provider: 'kie',
      modelId: job.modelId,
    });

  const filenameBase = latestJob ? filenameBaseFor(latestJob) : '';

  /** Saves the card that was clicked; defaults to the newest for the video panel. */
  const downloadResult = async (item?: ResultStackItem) => {
    const job = item ? matchingJobs.find((candidate) => candidate.id === item.id) : latestJob;
    const url = item?.src ?? resultUrl;
    if (!job || !url) return;
    if (!isDownloadableMediaUrl(url)) {
      setError('This Kie result URL has expired and can no longer be downloaded.');
      return;
    }

    setError(null);
    setDownloadingId(job.id);
    try {
      await downloadRemoteMedia({
        url,
        mediaType,
        filenameBase: filenameBaseFor(job),
        imageFormat,
      });
    } finally {
      if (mountedRef.current) {
        setDownloadingId((current) => (current === job.id ? null : current));
      }
    }
  };

  const submit = async () => {
    if (cloudWorkspace.checking) { setError('Checking your account…'); return; }
    if (needsKey) {
      setError('Connect your Kie API key before starting a generation.');
      onOpenConnections('kie');
      return;
    }
    const inputError = validateKieInput(variant, {
      prompt,
      uploadUrls: references.map((reference) => reference.previewUrl),
    });
    if (inputError) {
      setError(inputError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      if(cloudWorkspace.cloud){
        await cloudWorkspace.submit({modelId:selectedModel.id,mediaType,inputMode,prompt:prompt.trim(),values},(inputMode==='text'?[]:references).map(r=>r.file));
        autoRetry.reset();toast.success('Background job accepted. You can leave this page.');return;
      }
      // The balance is read alongside the uploads, before the submit that spends
      // it, so the ledger can bill the drop once the task succeeds.
      const [uploadUrls, creditsBefore] = await Promise.all([
        uploadKieFiles(kieApiKey, references.map((reference) => reference.file)),
        fetchKieCredits(kieApiKey),
      ]);
      const { taskId, protocol } = await submitKieJob({
        apiKey: kieApiKey,
        modelId: selectedModel.id,
        mediaType,
        inputMode,
        prompt: prompt.trim(),
        uploadUrls,
        values,
      });
      const now = currentKieTime();
      const submittedPrompt = prompt.trim();
      usePromptLibraryStore.getState().remember(submittedPrompt);
      upsertJob({
        id: taskId,
        taskId,
        protocol,
        state: 'queuing',
        resultUrls: [],
        modelId: selectedModel.id,
        mediaType,
        inputMode,
        prompt: submittedPrompt,
        controlValues: values,
        creditsBefore: creditsBefore ?? undefined,
        createdAt: now,
        updatedAt: now,
        pollAttempt: 0,
      });
      // Runs alongside the generation so the name is ready before the result is.
      void attachSlug(taskId, submittedPrompt);
      autoRetry.reset();
      toast.success('Task queued.');
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : 'Kie could not start this task.';
      setError(message);
      // Kie goes away for seconds at a time, and the person watching the button
      // can do nothing about it but press it again — so the workspace presses it.
      // Only for failures that never reached a decision: a rejected key or an
      // empty balance would fail identically five more times, and the retry
      // would only bury the sentence explaining why.
      const retrying = !cloudWorkspace.cloud && isRetryableFailure(submissionError) && autoRetry.schedule(() => void submit());
      toast.error(retrying ? `${message} Retrying in ${AUTO_RETRY_DELAY_SECONDS}s.` : message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-3.5 sm:space-y-4">
      <section className="glass-card p-3.5 md:p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button type="button" onClick={onBack} className="btn-secondary shrink-0 px-3 py-2 text-sm">
              ← Back
            </button>
            <div className="min-w-0">
              <div className="eyebrow mb-1 flex items-center gap-1.5 text-[var(--neon-cyan)]">
                <ProviderLogo provider="kie" size={13} /> Kie.ai
              </div>
              <h2 className="display text-lg font-semibold text-[var(--foreground)] sm:text-xl">
                {title ?? titleFor(mediaType, inputMode)}
              </h2>
              {description && (
                <p className="mt-1 max-w-2xl text-sm text-[var(--foreground-muted)]">{description}</p>
              )}
            </div>
          </div>
          {/* One call to action per state: while the key is missing the callout
              below owns it, so the header keeps only the connected-state status
              button rather than repeating the same ask two rows apart. */}
          {!needsKey && (
            <button
              type="button"
              onClick={() => onOpenConnections('kie')}
              className="btn-secondary shrink-0 px-3 py-2 text-xs"
            >
              Kie.ai key connected
            </button>
          )}
        </div>
      </section>

      {engineSelector}

      <ConnectionGate
        storage={cloudWorkspace.cloud ? 'account' : 'browser'}
        provider="kie"
        label="Kie.ai"
        needsKey={needsKey}
        hasFinishedWork={cloudWorkspace.cloud ? cloudWorkspace.hasJobs : jobs.length > 0}
        onConnect={() => onOpenConnections('kie')}
      >
      <GenerationWorkspaceLayout
        setup={
          <>
          <section className="glass-card space-y-3 p-3.5 md:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="display text-base font-semibold">Model</h3>
              </div>
              <div className="flex w-40 max-w-[48%] items-center gap-2">
                <Search className="pointer-events-none shrink-0 text-[var(--foreground-subtle)]" size={14} />
                <input
                  aria-label="Search compatible models"
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder="Find a model"
                  className="min-w-0 flex-1 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="space-y-2">
              <ModelListbox
                label="Model"
                accent={mediaType}
                columns={mediaType === 'video' ? KIE_VIDEO_COLUMNS : KIE_IMAGE_COLUMNS}
                rows={(matchingModels.length > 0 ? matchingModels : models).map((model) => ({
                  id: model.id,
                  label: model.label,
                  cells: mediaType === 'video' ? kieVideoSpecs(model, inputMode) : kieImageSpecs(model, inputMode),
                }))}
                value={selectedModel.id}
                onChange={setModel}
              />
              <p className="px-0.5 text-sm leading-relaxed text-[var(--foreground-muted)]">
                <span className="font-medium text-[var(--foreground)]">{selectedModel.label}:</span> {selectedModel.description}
              </p>
            </div>
          </section>

          {inputMode === 'image' && (
            <section className="glass-card space-y-3 p-3.5 md:p-4">
              <div>
                <h3 className="display text-base font-semibold">Reference image{maxInputImages === 1 ? '' : 's'}</h3>
                <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">Upload up to {maxInputImages}; files are forwarded to Kie only for this task. Pick a saved clip and its last frame is used.</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple={maxInputImages > 1}
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
                  className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed py-3.5 text-sm transition-colors sm:flex-1 ${isDragging ? 'border-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]' : 'border-[var(--neon-cyan)]/30 text-[var(--foreground-muted)] hover:border-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/5 hover:text-[var(--neon-cyan)]'}`}
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
                {references.length < maxInputImages && (
                  <StoredImagePicker referenceLimit={maxInputImages} />
                )}
              </div>
              <ReferenceStack
                layout="grid"
                replaceLimit={maxInputImages}
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

          <section className="glass-card space-y-3 p-3.5 md:p-4">
            <div>
              <h3 className="display text-base font-semibold">Model controls</h3>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">Only controls supported by {selectedModel.label} are shown.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ModelControls
                namespace={`kie-${variantKey}`}
                fields={variant.fields.filter(isKieModelControlField)}
                values={values}
                onChange={updateValues}
              />
            </div>
          </section>
          </>
        }
        prompt={
          <PromptPanel paused={gated} hasPrompt={prompt.trim().length > 0}>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="kie-prompt" className="display block text-base font-semibold">Prompt</label>
              <button
                type="button"
                onClick={() => void generateExample()}
                disabled={isGeneratingExample}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--brand-accent)]/30 bg-[var(--brand-accent)]/10 px-2.5 py-1.5 text-xs font-medium text-[var(--brand-accent)] transition-colors hover:text-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
                title="Generate an example prompt with the shared fast model, or your own Gemini key"
              >
                {isGeneratingExample ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                {isGeneratingExample ? 'Thinking…' : 'Gen Example'}
              </button>
            </div>
            <AutoExpandingPrompt
              id="kie-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={mediaType === 'video' ? 'Describe the motion, camera, mood, and scene…' : 'Describe the image you want to create…'}
            />
          </PromptPanel>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                // A deliberate press is a fresh start: it drops any queued attempt
                // and hands back the full retry budget.
                autoRetry.reset();
                void submit();
              }}
              disabled={isSubmitting || cloudWorkspace.checking}
              className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? <><Loader2 className="animate-spin" size={21} /> Uploading & starting…</> : <><Sparkles size={21} /> Generate {mediaType}</>}
            </button>
            <CloudExecutionNotice workspace={cloudWorkspace} />
            {error && (
              <SubmissionError message={error} retry={autoRetry.pending} onCancelRetry={autoRetry.cancel} />
            )}
          </>
        }
        results={cloudWorkspace.cloud ? <CloudJobPanel provider="kie" modelId={selectedModel.id} mediaType={mediaType} inputMode={inputMode} onContinueFromFrame={onContinueFromFrame} /> :
          <section className="glass-card flex min-h-[420px] flex-col gap-4 p-3.5 md:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="display text-base font-semibold">Result</h3>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">Results are temporary — download anything you want to keep.</p>
              {/* The result on screen belongs to this model — the same name the
                  download is tagged with. */}
              {latestJob && <p className="mt-0.5 text-xs text-[var(--foreground-subtle)]">{selectedModel.label}</p>}
            </div>
            {latestJob && (
              <span className={`rounded-full border px-2.5 py-1 text-xs ${latestJob.state === 'fail' ? 'border-red-500/30 bg-red-500/10 text-red-300' : latestJob.state === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
                <span>{latestJob.state === 'queuing' ? 'Queued' : latestJob.state === 'generating' ? 'Generating' : latestJob.state}</span>
                <span aria-hidden="true">{' · '}</span>
                <JobElapsed
                  startedAt={latestJob.createdAt}
                  finishedAt={isKieJobTerminal(latestJob.state) ? latestJob.updatedAt : undefined}
                />
              </span>
            )}
          </div>
          {mediaType === 'video' ? (
            <>
              <div className="flex min-h-[300px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]/70">
                {resultUrl ? (
                  <VideoPlayer src={resultUrl} label="Generated video" className="h-full max-h-[520px] w-full" />
                ) : latestJob && !isKieJobTerminal(latestJob.state) ? (
                  <div className="space-y-3 p-5 text-center">
                    <Loader2 className="mx-auto animate-spin text-[var(--neon-cyan)]" size={34} />
                    <p className="text-sm text-[var(--foreground-muted)]">
                      Kie is working on your {mediaType}.{' '}
                      <JobElapsed startedAt={latestJob.createdAt} className="text-[var(--foreground)]" />
                    </p>
                    {typeof latestJob.progress === 'number' && <p className="font-mono text-xs text-[var(--neon-cyan)]">{Math.round(latestJob.progress * 100)}%</p>}
                  </div>
                ) : latestJob?.state === 'fail' ? (
                  <p className="max-w-sm p-5 text-center text-sm text-red-300">{latestJob.error || 'Kie could not complete this task. It was not resubmitted.'}</p>
                ) : (
                  <div className="p-5 text-center text-[var(--foreground-muted)]">
                    <Video className="mx-auto mb-3 opacity-35" size={46} />
                    <p>Your generated {mediaType} will appear here.</p>
                  </div>
                )}
              </div>
              {resultUrl && latestJob && (
                <a
                  href={resultUrl}
                  download={`${filenameBase}.${extensionForMedia(mediaType)}`}
                  onClick={(event) => {
                    // Kie serves results cross-origin, where the download attribute is
                    // ignored — fetch the bytes so the semantic name survives.
                    event.preventDefault();
                    void downloadResult();
                  }}
                  className="btn-secondary flex w-full items-center justify-center gap-2"
                >
                  {downloadingId ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
                  {downloadingId ? 'Preparing download…' : `Download ${mediaType}`}
                </a>
              )}
              {resultUrl && latestJob && (
                <LastFrameActions
                  videoUrl={resultUrl}
                  filenameBase={filenameBase}
                  onContinue={onContinueFromFrame}
                />
              )}
            </>
          ) : (
            <>
              {/* A failed run is reported above the stack rather than in place of
                  it: the earlier results are still worth looking at. */}
              {latestJob?.state === 'fail' && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-300">
                  {latestJob.error || 'Kie could not complete this task. It was not resubmitted.'}
                </p>
              )}
              <ResultStack
                items={imageResults}
                isGenerating={Boolean(latestJob && !isKieJobTerminal(latestJob.state))}
                pendingLabel={`Kie is working on your ${mediaType}.`}
                pendingDetail={
                  typeof latestJob?.progress === 'number' ? (
                    <p className="font-mono text-xs text-[var(--neon-cyan)]">{Math.round(latestJob.progress * 100)}%</p>
                  ) : undefined
                }
                onDownload={(item) => downloadResult(item)}
                downloadingId={downloadingId}
                downloadLabel={`Download ${mediaType}`}
                onUseAsFirstFrame={onUseAsFirstFrame}
                emptyState={
                  <div className="p-5 text-center text-[var(--foreground-muted)]">
                    <Sparkles className="mx-auto mb-3 opacity-35" size={46} />
                    <p>Your generated {mediaType} will appear here.</p>
                  </div>
                }
              />
            </>
          )}
          </section>
        }
      />
      </ConnectionGate>
    </div>
  );
}
