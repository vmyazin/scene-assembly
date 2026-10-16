// components/KieGenerationWorkspace.tsx
'use client';

import { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
import { useAccountStore } from '@/store/useAccountStore';
import CloudExecutionNotice from '@/components/account/CloudExecutionNotice';
import CloudJobPanel from '@/components/account/CloudJobPanel';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import ReferenceStack from '@/components/ReferenceStack';
import { requestPromptSlug } from '@/lib/micro-ai/browser';
import { fetchKieCredits, submitKieJob, uploadKieFiles } from '@/lib/kie/browser';
import { defaultKieValues, modelsForKieMode, resolveKieVariant, validateKieInput } from '@/lib/kie/catalog';
import { CLOUD_EDIT_REFERENCE_CAP, editPromptMode, materializeEditReferences, packEditReferences, type EditReferencePlan } from '@/lib/providers/edit-references';
import { validateEditSource, validateEditVideo } from '@/lib/providers/video-edit';
import ModelListbox from '@/components/ModelListbox';
import { KIE_IMAGE_COLUMNS, KIE_VIDEO_COLUMNS, kieImageSpecs, kieVideoSpecs } from '@/lib/models/listbox-specs';
import { currentKieTime, isKieJobTerminal } from '@/lib/kie/queue';
import type { KieFieldDefinition, KieInputMode, KieJob, MediaType } from '@/lib/kie/types';
import { downloadRemoteMedia, extensionForMedia, isDownloadableMediaUrl } from '@/lib/media-download';
import { downloadFilenameBase } from '@/lib/download-name';
import { downloadImageResult, IMAGE_DOWNLOAD_ERROR } from '@/lib/results/download-image';
import { useImageResultFeed } from '@/lib/results/image-feed';
import { useAppStore } from '@/store/useAppStore';
import { useKieJobsStore } from '@/store/useKieJobsStore';
import { useDraftStore } from '@/store/useDraftStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import { candidatesFromValues, useAutoAspect } from '@/lib/draft/aspect-match';
import { carryOverValues } from '@/lib/draft/carry-over';
import { isVideoFile } from '@/lib/video-frame';
import LastFrameActions from '@/components/LastFrameActions';
import ResultStack, { type ResultStackItem } from '@/components/ResultStack';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import PromptPanel from '@/components/PromptPanel';
import SavedPromptsButton from '@/components/SavedPromptsButton';
import ModelControls, { type ModelControlField } from '@/components/ModelControls';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import SubmissionError from '@/components/SubmissionError';
import RelaxedFilterControl from '@/components/RelaxedFilterControl';
import { trackGenerationResult, trackGenerationSubmitted } from '@/lib/analytics/generation-result';
import { classifyFailure, refusalPresentation } from '@/lib/moderation/classify';
import { inspectPrompt } from '@/lib/moderation/floors';
import { useRelaxedFilter } from '@/lib/moderation/use-relaxed-filter';
import { AUTO_RETRY_DELAY_SECONDS, isRetryableFailure, useAutoRetry } from '@/lib/providers/auto-retry';
import type { EngineId } from '@/lib/engines/registry';
import { JobStatusPill } from '@/components/StatusPill';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import { GenExampleButton, PromptHeader } from '@/components/PromptHeader';
import { useExamplePrompt } from '@/hooks/useExamplePrompt';
import { ModelNote, ModelPickerCard } from '@/components/ModelPickerCard';
import { VideoDownloadLink, VideoResultStage } from '@/components/VideoResult';
import { useClaimSeedFrame, useReferenceIntake } from '@/hooks/useReferenceIntake';
import EditReferenceTray, { emptyEditReferenceDraft } from '@/components/EditReferenceTray';
import { ReferencePicker } from '@/components/ReferencePicker';
import VideoSourceInput, { type SourceVideo } from '@/components/VideoSourceInput';

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
  inputMode === 'edit' ? `Edit ${mediaType}` : `${inputMode === 'text' ? 'Text' : 'Image'} to ${mediaType}`;

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
  const editSpec = inputMode === 'edit' ? variant.edit?.references : undefined;
  const [selectedSource, setSelectedSource] = useState<SourceVideo | null>(null);
  const [editDraft, setEditDraft] = useState(emptyEditReferenceDraft);
  const [editDraftModel, setEditDraftModel] = useState(variant.modelId);
  if (editDraftModel !== variant.modelId) {
    setEditDraftModel(variant.modelId);
    setEditDraft(emptyEditReferenceDraft());
  }
  const epoch = useAccountStore((state) => state.epoch);
  const source = selectedSource?.epoch === epoch ? selectedSource : null;
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
  const relaxed = useRelaxedFilter({
    workspaceKey: 'kie',
    provider: 'kie',
    modelId: selectedModel.id,
    prompt,
    hasReferences: references.length > 0,
  });
  const [modelSearch, setModelSearch] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const autoRetry = useAutoRetry();
  // Latest submit, so a queued retry re-runs the button's own path with the
  // prompt and settings on screen now, not the ones from the failed render.
  const submitRef = useRef<() => void>(() => {});
  const mountedRef = useRef(true);
  const maxInputImages = variant.maxInputImages ?? 1;
  const matchingModels = models.filter((model) =>
    `${model.label} ${model.provider}`.toLowerCase().includes(modelSearch.toLowerCase())
  );
  const matchingJobs = jobs.filter(
    (job) => job.mediaType === mediaType && job.inputMode === inputMode
  );
  const latestJob = matchingJobs[0];
  const resultUrl = latestJob?.state === 'success' ? latestJob.resultUrls[0] : undefined;
  /**
   * The shared image feed rather than this model's slice: every image finished
   * this session, Kie's straight off the job list and the other engines' from
   * `useImageResultsStore`, so switching model or engine hides nothing.
   */
  const imageFeed = useImageResultFeed();
  const resolvedExampleFeatureId =
    exampleFeatureId ?? (mediaType === 'video' ? `${inputMode}-to-video` : 'text-to-image');

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

  useClaimSeedFrame(inputMode === 'image', 1, inputMode);
  const { addFiles: addReferences, isReadingFrame, isDragging, isFetching, dropProps } = useReferenceIntake({
    referenceCount: references.length,
    maxImages: maxInputImages,
    accept: (file) => file.type.startsWith('image/') || isVideoFile(file),
    unusableMessage: 'Choose an image, or a video to continue from its last frame.',
    tooManyMessage: `This model accepts up to ${maxInputImages} reference image${maxInputImages === 1 ? '' : 's'}.`,
    pasteEnabled: inputMode === 'image',
    onError: setError,
  });

  const removeReference = (index: number) => {
    const reference = references[index];
    if (reference) useDraftStore.getState().removeReference(reference.id);
  };

  const example = useExamplePrompt({
    featureId: resolvedExampleFeatureId,
    apiKey: geminiApiKey,
    onStart: () => setError(null),
    onPrompt: setPrompt,
    onError: (message) => {
      setError(message);
      toast.error(message);
    },
  });

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
    // A card from another engine, or from a Kie model no longer selected, has
    // no job in `matchingJobs`; the shared helper knows every source's path.
    if (item && !matchingJobs.some((candidate) => candidate.id === item.id)) {
      setError(null);
      setDownloadingId(item.id);
      try {
        await downloadImageResult(item, {
          filenameBase: downloadFilenameBase({
            prompt: item.prompt ?? '',
            mediaType: 'image',
            slug: item.slug,
            provider: item.provider,
            modelId: item.modelId,
          }),
          imageFormat,
        });
      } catch (caught) {
        if (mountedRef.current) setError(caught instanceof Error ? caught.message : IMAGE_DOWNLOAD_ERROR);
      } finally {
        if (mountedRef.current) setDownloadingId((current) => (current === item.id ? null : current));
      }
      return;
    }
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
    const floor = inspectPrompt(prompt, relaxed.levelRef.current);
    if (floor.blocked && floor.message) {
      setError(floor.message);
      return;
    }
    if (inputMode === 'edit' && !source) { setError('Choose a source video to edit.'); return; }
    if (inputMode === 'edit' && variant.edit && source) {
      try { validateEditVideo(source.file, variant.edit); validateEditSource(source, variant.edit); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Choose a source video this model accepts.'); return; }
    }
    let packedPlan: EditReferencePlan | undefined;
    let packedFiles = inputMode === 'text' || editSpec ? [] : references.map((reference) => reference.file);
    if (editSpec) {
      const packed = packEditReferences(editDraft, editSpec);
      if (!packed.ok) { setError(packed.error); return; }
      if (cloudWorkspace.cloud && packed.packed.files.length > CLOUD_EDIT_REFERENCE_CAP) {
        setError(`A background job can attach ${CLOUD_EDIT_REFERENCE_CAP} reference images.`);
        return;
      }
      packedPlan = packed.packed.plan;
      packedFiles = packed.packed.files;
    }
    const referenceUrls = packedFiles.map((_, index) => `https://reference.invalid/${index}`);
    const materialized = editSpec ? { ...materializeEditReferences(editSpec, referenceUrls, packedPlan), video: 'https://source.invalid/video' } : undefined;
    const inputError = validateKieInput(variant, {
      prompt,
      uploadUrls: inputMode === 'edit' ? [...referenceUrls, 'https://source.invalid/video'] : references.map((reference) => reference.previewUrl),
      references: materialized,
    });
    if (inputError) {
      setError(inputError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const libraryPrompt = prompt.trim() || (editPromptMode(editSpec) === 'absent' ? selectedModel.label : '');
    const submittedValues = { ...values, ...relaxed.attach(), ...(inputMode === 'edit' && source ? { sourceDurationSeconds: source.durationSeconds } : {}) };
    try {
      if(cloudWorkspace.cloud){
        await cloudWorkspace.submit({modelId:selectedModel.id,mediaType,inputMode,prompt:libraryPrompt,values:submittedValues,...(packedPlan?{editReferencePlan:packedPlan}:{})},packedFiles,libraryPrompt,inputMode==='edit'?source?.file:undefined);
        autoRetry.reset();toast.success('Background job accepted. You can leave this page.');return;
      }
      // The balance is read alongside the uploads, before the submit that spends
      // it, so the ledger can bill the drop once the task succeeds.
      const [uploadUrls, creditsBefore] = await Promise.all([
        uploadKieFiles(kieApiKey, inputMode === 'edit' && source ? [...packedFiles, source.file] : references.map((reference) => reference.file)),
        fetchKieCredits(kieApiKey),
      ]);
      const { taskId, protocol } = await submitKieJob({
        apiKey: kieApiKey,
        modelId: selectedModel.id,
        mediaType,
        inputMode,
        prompt: libraryPrompt,
        uploadUrls,
        values: submittedValues,
        ...(packedPlan ? { editReferencePlan: packedPlan } : {}),
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
        controlValues: submittedValues,
        creditsBefore: creditsBefore ?? undefined,
        createdAt: now,
        updatedAt: now,
        pollAttempt: 0,
      });
      // Runs alongside the generation so the name is ready before the result is.
      void attachSlug(taskId, submittedPrompt);
      autoRetry.reset();
      trackGenerationSubmitted({ engine: 'kie', route: selectedModel.id, model: selectedModel.label, level: relaxed.levelRef.current, media: mediaType });
      toast.success('Task queued.');
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : 'Kie could not start this task.';
      trackGenerationResult({ engine: 'kie', route: selectedModel.id, model: selectedModel.label, level: relaxed.levelRef.current, outcome: classifyFailure(message).kind, media: mediaType });
      setError(message);
      // Kie goes away for seconds at a time, and the person watching the button
      // can do nothing about it but press it again — so the workspace presses it.
      // Only for failures that never reached a decision: a rejected key or an
      // empty balance would fail identically five more times, and the retry
      // would only bury the sentence explaining why.
      const retrying = !cloudWorkspace.cloud && isRetryableFailure(submissionError) && autoRetry.schedule(() => submitRef.current());
      toast.error(retrying ? `${message} Retrying in ${AUTO_RETRY_DELAY_SECONDS}s.` : message);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    submitRef.current = () => void submit();
  });

  const refusal = error
    ? refusalPresentation(error, {
        providerLabel: 'Kie',
        modelLabel: selectedModel.label,
        level: relaxed.effective,
        route: { provider: 'kie', modelId: selectedModel.id },
        hasReferences: references.length > 0,
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-3.5 sm:space-y-4">
      <WorkspaceHeader
        provider="kie"
        label="Kie.ai"
        title={title ?? titleFor(mediaType, inputMode)}
        description={description}
        needsKey={needsKey}
        onBack={onBack}
        onOpenConnections={onOpenConnections}
      />

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
          <ModelPickerCard searchLabel="Search compatible models" search={modelSearch} onSearch={setModelSearch}>
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
            <ModelNote label={selectedModel.label}>{selectedModel.description}</ModelNote>
          </ModelPickerCard>

          {inputMode === 'edit' && variant.edit && (
            <VideoSourceInput capability={variant.edit} source={source} onChange={setSelectedSource} disabled={isSubmitting} />
          )}
          {editSpec && (
            <EditReferenceTray
              spec={editSpec}
              draft={editDraft}
              onChange={setEditDraft}
              disabled={isSubmitting}
              fileCap={1}
              promptSyntax={variant.edit?.promptSyntax}
            />
          )}
          {inputMode === 'image' && (
            <section className="glass-card space-y-3 p-3.5 md:p-4">
              <div>
                <h3 className="display text-base font-semibold">Reference image{maxInputImages === 1 ? '' : 's'}</h3>
                <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">Upload up to {maxInputImages}; files are forwarded to Kie only for this task. Pick a saved clip and its last frame is used.</p>
              </div>
              <ReferencePicker
                accept="image/*,video/*"
                multiple={maxInputImages > 1}
                accent="cyan"
                idleLabel="Drop, upload, or paste an image or video"
                referenceCount={references.length}
                referenceLimit={maxInputImages}
                intake={{ addFiles: addReferences, isReadingFrame, isFetching, isDragging, dropProps }}
              />
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
              <RelaxedFilterControl filter={relaxed} />
            </div>
          </section>
          </>
        }
        prompt={
          <PromptPanel paused={gated} hasPrompt={prompt.trim().length > 0}>
            <PromptHeader htmlFor="kie-prompt">
              <SavedPromptsButton />
              <GenExampleButton busy={example.generating} onClick={() => void example.generate()} />
            </PromptHeader>
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
              className="btn-primary w-full"
            >
              {isSubmitting ? <><Loader2 className="animate-spin" size={21} /> Uploading & starting…</> : <><Sparkles size={21} /> Generate {mediaType}</>}
            </button>
            <CloudExecutionNotice workspace={cloudWorkspace} />
            {error && (
              <SubmissionError
                message={refusal?.message ?? error}
                retry={autoRetry.pending}
                onCancelRetry={autoRetry.cancel}
                offerTryRelaxed={Boolean(refusal?.offerTryRelaxed && relaxed.offered)}
                onTryRelaxed={() => relaxed.requestRelaxed(() => void submit())}
              />
            )}
          </>
        }
        results={cloudWorkspace.cloud ? <CloudJobPanel provider="kie" mediaType={mediaType} inputMode={inputMode} onContinueFromFrame={onContinueFromFrame} /> :
          <section className="glass-card flex min-h-[420px] flex-col gap-4 p-3.5 md:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="display text-base font-semibold">Result</h3>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">Results are temporary — download anything you want to keep.</p>
              {/* The producing model stays attached when the next-run selection changes. */}
              {latestJob && <p className="mt-0.5 text-xs text-[var(--foreground-subtle)]">{models.find(model => model.id === latestJob.modelId)?.label ?? latestJob.modelId}</p>}
            </div>
            {latestJob && (
              <JobStatusPill
                tone={latestJob.state === 'fail' ? 'danger' : latestJob.state === 'success' ? 'success' : 'warning'}
                label={latestJob.state === 'queuing' ? 'Queued' : latestJob.state === 'success' ? 'Done' : latestJob.state === 'fail' ? 'Failed' : 'Generating'}
                startedAt={latestJob.createdAt}
                finishedAt={isKieJobTerminal(latestJob.state) ? latestJob.updatedAt : undefined}
              />
            )}
          </div>
          {mediaType === 'video' ? (
            <>
              <VideoResultStage
                resultUrl={resultUrl}
                accent="cyan"
                working={
                  latestJob && !isKieJobTerminal(latestJob.state)
                    ? { label: `Kie is working on your ${mediaType}.`, startedAt: latestJob.createdAt, progress: latestJob.progress }
                    : undefined
                }
                error={latestJob?.state === 'fail' ? latestJob.error || 'Kie could not complete this task. It was not resubmitted.' : undefined}
              />
              {resultUrl && latestJob && (
                <VideoDownloadLink
                  href={resultUrl}
                  filename={`${filenameBase}.${extensionForMedia(mediaType)}`}
                  busy={Boolean(downloadingId)}
                  label={`Download ${mediaType}`}
                  onDownload={() => void downloadResult()}
                />
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
                items={imageFeed}
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
