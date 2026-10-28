// components/KieGenerationWorkspace.tsx
'use client';

import { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
import { useAccountStore } from '@/store/useAccountStore';
import CloudJobPanel from '@/components/account/CloudJobPanel';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import ReferenceStack from '@/components/ReferenceStack';
import { requestPromptSlug } from '@/lib/micro-ai/browser';
import { fetchKieCredits, submitKieJob, uploadKieFiles } from '@/lib/kie/browser';
import { defaultKieValues, modelsForKieMode, resolveKieVariant, validateKieInput } from '@/lib/kie/catalog';
import { CLOUD_EDIT_REFERENCE_CAP, editPromptMode } from '@/lib/providers/edit-references';
import { prepareSubmissionMedia } from '@/lib/providers/edit-submission';
import ModelListbox from '@/components/ModelListbox';
import { KIE_IMAGE_COLUMNS, KIE_VIDEO_COLUMNS, kieImageSpecs, kieVideoSpecs, railTags } from '@/lib/models/listbox-specs';
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
import { isVideoFile } from '@/lib/video-frame';
import ResultStack, { type ResultStackItem } from '@/components/ResultStack';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import PromptPanel from '@/components/PromptPanel';
import SavedPromptsButton from '@/components/SavedPromptsButton';
import ModelControls, { type ModelControlField } from '@/components/ModelControls';
import AspectMismatchNote from '@/components/AspectMismatchNote';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import ImageWorkspaceLayout, { ImageMainStack } from '@/components/ImageWorkspaceLayout';
import { ImageRailCard, ImageRailStrip } from '@/components/ImageRail';
import ChipPopover from '@/components/ChipPopover';
import RelaxedFilterControl from '@/components/RelaxedFilterControl';
import GenerateActions from '@/components/GenerateActions';
import ResultPanel from '@/components/ResultPanel';
import { ModelControlsCard, WorkspaceCard } from '@/components/WorkspaceCard';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import { trackGenerationResult, trackGenerationSubmitted } from '@/lib/analytics/generation-result';
import { classifyFailure } from '@/lib/moderation/classify';
import { inspectPrompt } from '@/lib/moderation/floors';
import { useRelaxedFilter } from '@/lib/moderation/use-relaxed-filter';
import { AUTO_RETRY_DELAY_SECONDS, isRetryableFailure, useAutoRetry } from '@/lib/providers/auto-retry';
import type { EngineId } from '@/lib/engines/registry';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import { GenExampleButton, PromptHeader } from '@/components/PromptHeader';
import { useExamplePrompt } from '@/hooks/useExamplePrompt';
import { useEditReferenceDraft } from '@/hooks/useEditReferenceDraft';
import { useModelControlValues } from '@/hooks/useModelControlValues';
import { removeReferenceAt, useMountedRef, usePromptScope, useReferenceLimit } from '@/hooks/useWorkspaceLifecycle';
import { ModelNote, ModelPickerCard } from '@/components/ModelPickerCard';
import { FinishedVideoActions, VideoResultStage } from '@/components/VideoResult';
import { useClaimSeedFrame, useReferenceIntake } from '@/hooks/useReferenceIntake';
import EditReferenceTray from '@/components/EditReferenceTray';
import { ReferencePicker } from '@/components/ReferencePicker';
import VideoSourceInput, { type SourceVideo } from '@/components/VideoSourceInput';
import { browserJobTarget } from '@/lib/results/rating';

interface KieGenerationWorkspaceProps {
  mediaType: MediaType;
  inputMode: KieInputMode;
  onBack: () => void;
  onOpenConnections: (provider?: EngineId) => void;
  title?: string;
  description?: string;
  initialPrompt?: string;
  exampleFeatureId?: string;
  /**
   * The rail's engine menu, from the image workspace that hosts this one, so
   * picking Kie leaves it where it was. Images only: the video workspaces pick
   * their engine above this component.
   */
  engineField?: ReactNode;
  /** Switch this workspace to image-to-video, for continuing from a last frame. */
  onContinueFromFrame?: () => void;
  /** Switch to image-to-video, seeded with a finished image result. */
  onUseAsFirstFrame?: () => void;
  /** Open image editing with a finished result; for modes without references. */
  onEditImage?: () => void;
}

type KieModelControlField = Omit<KieFieldDefinition, 'type'> & {
  type: ModelControlField['type'];
};

const isKieModelControlField = (field: KieFieldDefinition): field is KieModelControlField =>
  field.type !== 'file';

const titleFor = (mediaType: MediaType, inputMode: KieInputMode) =>
  inputMode === 'edit' ? `Edit ${mediaType}` : `${inputMode === 'text' ? 'Text' : 'Image'} to ${mediaType}`;

export default function KieGenerationWorkspace({
  mediaType,
  inputMode,
  onBack,
  onOpenConnections,
  title,
  description,
  initialPrompt = '',
  exampleFeatureId,
  engineField,
  onContinueFromFrame,
  onUseAsFirstFrame,
  onEditImage,
}: KieGenerationWorkspaceProps) {
  const geminiApiKey = useAppStore((state) => state.apiKey);
  const imageFormat = useAppStore((state) => state.imageFormat);
  const kieApiKey = useAppStore((state) => state.kieApiKey);
  const kieImageModel = useAppStore((state) => state.kieImageModel);
  const kieVideoModel = useAppStore((state) => state.kieVideoModel);
  const setKieImageModel = useAppStore((state) => state.setKieImageModel);
  const setKieVideoModel = useAppStore((state) => state.setKieVideoModel);
  const railCollapsed = useAppStore((state) => state.imageRailCollapsed);
  const setRailCollapsed = useAppStore((state) => state.setImageRailCollapsed);
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
  const isEdit = inputMode === 'edit';
  const editSpec = isEdit ? variant.edit?.references : undefined;
  const [selectedSource, setSelectedSource] = useState<SourceVideo | null>(null);
  const [editDraft, setEditDraft] = useEditReferenceDraft(variant.modelId);
  const epoch = useAccountStore((state) => state.epoch);
  const source = selectedSource?.epoch === epoch ? selectedSource : null;
  const prompt = useDraftStore((state) => state.prompt);
  const setPrompt = useDraftStore((state) => state.setPrompt);
  usePromptScope(mediaType === 'video' ? 'video' : 'image');
  const references = useDraftStore((state) => state.references);
  const { values, update } = useModelControlValues(variantKey, variant.fields, defaultKieValues(variant));
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
  const mountedRef = useMountedRef();
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

  useReferenceLimit(maxInputImages);

  // Seed the feature's example prompt, but never over something already typed.
  useEffect(() => {
    const draft = useDraftStore.getState();
    if (initialPrompt && !draft.prompt) draft.setPrompt(initialPrompt);
  }, [initialPrompt]);

  const updateValues = (key: string, value: string | number | boolean) => update({ [key]: value });

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
    (mediaType === 'image' ? setKieImageModel : setKieVideoModel)(modelId);
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
    const media = prepareSubmissionMedia({
      inputMode,
      references,
      edit: variant.edit,
      source,
      editDraft,
      cloudCap: cloudWorkspace.cloud ? CLOUD_EDIT_REFERENCE_CAP : undefined,
    });
    if (!media.ok) { setError(media.error); return; }
    const inputError = validateKieInput(variant, { prompt, uploadUrls: media.uploadUrls, references: media.references });
    if (inputError) {
      setError(inputError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const libraryPrompt = prompt.trim() || (editPromptMode(editSpec) === 'absent' ? selectedModel.label : '');
    const submittedValues = { ...values, ...relaxed.attach(), ...(isEdit && source ? { sourceDurationSeconds: source.durationSeconds } : {}) };
    try {
      if(cloudWorkspace.cloud){
        await cloudWorkspace.submit({modelId:selectedModel.id,mediaType,inputMode,prompt:libraryPrompt,values:submittedValues,...(media.plan?{editReferencePlan:media.plan}:{})},media.files,libraryPrompt,isEdit?source?.file:undefined);
        autoRetry.reset();toast.success('Background job accepted. You can leave this page.');return;
      }
      // The balance is read alongside the uploads, before the submit that spends
      // it, so the ledger can bill the drop once the task succeeds.
      const [uploadUrls, creditsBefore] = await Promise.all([
        uploadKieFiles(kieApiKey, isEdit && source ? [...media.files, source.file] : media.files),
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
        ...(media.plan ? { editReferencePlan: media.plan } : {}),
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

  const referenceCard = inputMode === 'image' && (
    <WorkspaceCard
      title={`Reference image${maxInputImages === 1 ? '' : 's'}`}
      description={`Upload up to ${maxInputImages}; files are forwarded to Kie only for this task. Pick a saved clip and its last frame is used.`}
    >
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
        onRemove={removeReferenceAt}
      />
    </WorkspaceCard>
  );

  const promptPanel = (
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
  );

  const generateActions = (
    <GenerateActions
      workspace={cloudWorkspace}
      mediaType={mediaType}
      label={`Generate ${mediaType}`}
      busy={isSubmitting}
      busyLabel="Uploading & starting…"
      onSubmit={() => void submit()}
      error={error}
      refusal={{ providerLabel: 'Kie', modelLabel: selectedModel.label, route: { provider: 'kie', modelId: selectedModel.id }, hasReferences: references.length > 0 }}
      relaxed={relaxed}
      autoRetry={autoRetry}
    />
  );

  const header = (
    <WorkspaceHeader
      provider="kie"
      label="Kie.ai"
      title={title ?? titleFor(mediaType, inputMode)}
      description={description}
      needsKey={needsKey}
      onBack={onBack}
      onOpenConnections={onOpenConnections}
    />
  );

  if (mediaType === 'image') {
    // The same rail, chips and 2-up results every other image engine has (UX
    // audit L1, variant G). Shape and size are on every Kie image model; the
    // rest of a model's fields go behind More settings.
    const controlFields = variant.fields.filter(isKieModelControlField);
    const shapeField = controlFields.find((field) => field.key === 'aspect_ratio');
    const sizeField = controlFields.find((field) => field.key === 'resolution');
    const otherFields = controlFields.filter((field) => field !== shapeField && field !== sizeField);
    const chipValue = (key: string) => (values[key] === undefined || values[key] === '' ? undefined : String(values[key]));
    const latestFailed = latestJob?.state === 'fail';
    return (
      <div className="mx-auto w-full max-w-[1400px] space-y-3.5 sm:space-y-4">
        {header}
        <ImageWorkspaceLayout
          collapsed={railCollapsed}
          rail={
            <ImageRailCard engineField={engineField} onCollapse={() => setRailCollapsed(true)}>
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5">
                <Search aria-hidden="true" size={14} className="pointer-events-none shrink-0 text-[var(--foreground-subtle)]" />
                <input
                  type="search"
                  aria-label="Search compatible models"
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder="Find a model"
                  className="min-w-0 flex-1 border-0 bg-transparent px-0"
                />
              </div>
              <ModelListbox
                label="Model"
                accent="image"
                layout="rail"
                columns={KIE_IMAGE_COLUMNS}
                rows={(matchingModels.length > 0 ? matchingModels : models).map((model) => {
                  const cells = kieImageSpecs(model, inputMode);
                  return {
                    id: model.id,
                    label: model.label,
                    cells,
                    // The first compatible model is the one a fresh browser gets.
                    tags: railTags({ cells, columns: KIE_IMAGE_COLUMNS, isDefault: model.id === models[0]?.id }),
                  };
                })}
                value={selectedModel.id}
                onChange={setModel}
              />
              <p className="px-0.5 text-xs leading-relaxed text-[var(--foreground-muted)]">{selectedModel.description}</p>
            </ImageRailCard>
          }
          collapsedRail={
            <ImageRailStrip engineId="kie" modelLabel={selectedModel.label} onExpand={() => setRailCollapsed(false)} />
          }
        >
          <ConnectionGate
            storage={cloudWorkspace.cloud ? 'account' : 'browser'}
            provider="kie"
            label="Kie.ai"
            needsKey={needsKey}
            hasFinishedWork={cloudWorkspace.cloud ? cloudWorkspace.hasJobs : jobs.length > 0}
            onConnect={() => onOpenConnections('kie')}
          >
            <ImageMainStack
              references={referenceCard || undefined}
              prompt={promptPanel}
              actions={generateActions}
              chips={
                <>
                  {shapeField && (
                    <ChipPopover label="Shape" panelLabel="Aspect ratio" value={chipValue('aspect_ratio')} wide>
                      <ModelControls namespace={`kie-${variantKey}-shape`} fields={[shapeField]} values={values} onChange={updateValues} />
                      <AspectMismatchNote reference={references[0]} candidates={aspectCandidates} current={values.aspect_ratio} />
                    </ChipPopover>
                  )}
                  {sizeField && (
                    <ChipPopover label="Size" panelLabel="Resolution" value={chipValue('resolution')}>
                      <ModelControls namespace={`kie-${variantKey}-size`} fields={[sizeField]} values={values} onChange={updateValues} />
                    </ChipPopover>
                  )}
                  {(otherFields.length > 0 || relaxed.offered) && (
                    <ChipPopover label="More settings" wide>
                      <ModelControls namespace={`kie-${variantKey}-more`} fields={otherFields} values={values} onChange={updateValues} />
                      <RelaxedFilterControl filter={relaxed} />
                    </ChipPopover>
                  )}
                </>
              }
              results={
                cloudWorkspace.cloud ? (
                  <CloudJobPanel provider="kie" mediaType="image" inputMode={inputMode} resultLayout="grid" />
                ) : (
                  <div className="space-y-3">
                    {/* A failed run is reported above the grid rather than in
                        place of it: the earlier results are still worth a look. */}
                    {latestFailed && (
                      <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center text-sm text-red-300">
                        {latestJob?.error || 'Kie could not complete this task. It was not resubmitted.'}
                      </p>
                    )}
                    <ResultStack
                      layout="grid"
                      items={imageFeed}
                      isGenerating={Boolean(latestJob && !isKieJobTerminal(latestJob.state))}
                      pendingLabel="Kie is working on your image."
                      pendingDetail={
                        typeof latestJob?.progress === 'number' ? (
                          <p className="font-mono text-xs text-[var(--neon-cyan)]">{Math.round(latestJob.progress * 100)}%</p>
                        ) : undefined
                      }
                      onDownload={(item) => downloadResult(item)}
                      downloadingId={downloadingId}
                      downloadLabel="Download image"
                      onUseAsFirstFrame={onUseAsFirstFrame}
                      onEditImage={onEditImage}
                      emptyState={
                        <div className="p-5 text-center text-[var(--foreground-muted)]">
                          <Sparkles className="mx-auto mb-3 opacity-35" size={46} />
                          <p>Your generated image will appear here.</p>
                        </div>
                      }
                    />
                  </div>
                )
              }
            />
          </ConnectionGate>
        </ImageWorkspaceLayout>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-3.5 sm:space-y-4">
      {header}

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

          {isEdit && variant.edit && (
            <VideoSourceInput capability={variant.edit} source={source} onChange={setSelectedSource} disabled={isSubmitting} />
          )}
          {editSpec && (
            <EditReferenceTray
              key={variant.modelId}
              spec={editSpec}
              draft={editDraft}
              onChange={setEditDraft}
              disabled={isSubmitting}
              fileCap={1}
              promptSyntax={variant.edit?.promptSyntax}
            />
          )}
          {referenceCard}

          <ModelControlsCard
            description={`Only controls supported by ${selectedModel.label} are shown.`}
            namespace={`kie-${variantKey}`}
            fields={variant.fields.filter(isKieModelControlField)}
            values={values}
            onChange={updateValues}
            relaxed={relaxed}
          >
            <AspectMismatchNote reference={references[0]} candidates={aspectCandidates} current={values.aspect_ratio} />
          </ModelControlsCard>
          </>
        }
        prompt={promptPanel}
        actions={generateActions}
        results={cloudWorkspace.cloud ? <CloudJobPanel provider="kie" mediaType={mediaType} inputMode={inputMode} onContinueFromFrame={onContinueFromFrame} /> :
          <ResultPanel
            modelLabel={latestJob ? models.find(model => model.id === latestJob.modelId)?.label ?? latestJob.modelId : undefined}
            status={latestJob && {
              tone: latestJob.state === 'fail' ? 'danger' : latestJob.state === 'success' ? 'success' : 'warning',
              label: latestJob.state === 'queuing' ? 'Queued' : latestJob.state === 'success' ? 'Done' : latestJob.state === 'fail' ? 'Failed' : 'Generating',
              startedAt: latestJob.createdAt,
              finishedAt: isKieJobTerminal(latestJob.state) ? latestJob.updatedAt : undefined,
            }}
          >
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
                <FinishedVideoActions
                  url={resultUrl}
                  filenameBase={filenameBase}
                  extension={extensionForMedia(mediaType)}
                  busy={Boolean(downloadingId)}
                  label={`Download ${mediaType}`}
                  onDownload={() => void downloadResult()}
                  onContinueFromFrame={onContinueFromFrame}
                  rating={browserJobTarget('kie', latestJob.id)}
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
                onEditImage={onEditImage}
                emptyState={
                  <div className="p-5 text-center text-[var(--foreground-muted)]">
                    <Sparkles className="mx-auto mb-3 opacity-35" size={46} />
                    <p>Your generated {mediaType} will appear here.</p>
                  </div>
                }
              />
            </>
          )}
          </ResultPanel>
        }
      />
      </ConnectionGate>
    </div>
  );
}
