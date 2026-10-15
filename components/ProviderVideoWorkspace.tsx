// components/ProviderVideoWorkspace.tsx
'use client';
// components/ProviderVideoWorkspace.tsx

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
import CloudExecutionNotice from '@/components/account/CloudExecutionNotice';
import CloudJobPanel from '@/components/account/CloudJobPanel';

import VideoSourceInput, { type SourceVideo } from '@/components/VideoSourceInput';
import { useAccountStore } from '@/store/useAccountStore';
import { ALEPH_DATA_URI_MAX, alephDataUriLength, isAlephVideoUri } from '@/lib/providers/comet';
import { EDIT_PROMPTS, isRunwayEditProtocol, validateEditSource } from '@/lib/providers/video-edit';
import { uploadRunwareMedia, uploadRunwareVideo } from '@/lib/providers/upload-video';
import ReferenceClipTray, { type AttachedReferenceClip } from '@/components/ReferenceClipTray';
import { clipToken, fileWithReferenceClipType, referenceClipSetError, referenceClipsFor } from '@/lib/providers/reference-clips';
import LastFrameActions from '@/components/LastFrameActions';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import PromptPanel from '@/components/PromptPanel';
import SavedPromptsButton from '@/components/SavedPromptsButton';
import DescribeSourceButton from '@/components/DescribeSourceButton';
import ModelControls, { type ModelControlField } from '@/components/ModelControls';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import SubmissionError from '@/components/SubmissionError';
import RelaxedFilterControl from '@/components/RelaxedFilterControl';
import { trackGenerationResult, trackGenerationSubmitted, trackQueuedTerminal } from '@/lib/analytics/generation-result';
import { classifyFailure, refusalPresentation } from '@/lib/moderation/classify';
import { inspectPrompt } from '@/lib/moderation/floors';
import { useRelaxedFilter } from '@/lib/moderation/use-relaxed-filter';
import { AUTO_RETRY_DELAY_SECONDS, isRetryableFailure, useAutoRetry } from '@/lib/providers/auto-retry';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import ReferenceStack from '@/components/ReferenceStack';
import { candidatesFromSizes, useAutoAspect } from '@/lib/draft/aspect-match';
import { APPROXIMATE_LEGEND, hasApproximateSize, sizeDimensions, withDimensions } from '@/lib/providers/output-size';
import { resolveCatalogRate } from '@/lib/spend/resolve';
import { carryOverValues } from '@/lib/draft/carry-over';
import { recordFinishedJob } from '@/lib/gallery/record-job';
import FinalizeDraftButton from '@/components/FinalizeDraftButton';
import { runGuestFinalize } from '@/lib/providers/guest-finalize';
import { isSeedanceDraftSize, seedanceDraftSeconds, seedanceDraftSizeLabel } from '@/lib/providers/seedance-draft';
import { playGenerationChime } from '@/lib/notify/chime';
import { captureProviderJob } from '@/lib/spend/capture';
import { downloadRemoteMedia, extensionForMedia, isDownloadableMediaUrl } from '@/lib/media-download';
import { downloadFilenameBase } from '@/lib/download-name';
import { requestPromptSlug } from '@/lib/micro-ai/browser';
import { getProviderVideoStatus, pollDelayMs, releaseRunwareMedia, submitProviderVideo } from '@/lib/providers/browser';
import { followProviderVideo } from '@/lib/providers/follow-video';
import { findModel, modelsFor } from '@/lib/providers/catalog';
import ModelListbox from '@/components/ModelListbox';
import { PROVIDER_VIDEO_COLUMNS, providerVideoSpecs } from '@/lib/models/listbox-specs';
import { frameSlotLabel } from '@/lib/providers/frames';
import type { ProviderId, ProviderMode, ProviderModel } from '@/lib/providers/types';
import type { EngineId } from '@/lib/engines/registry';
import { isVideoFile } from '@/lib/video-frame';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import { useProviderJobsStore, type ProviderJob } from '@/store/useProviderJobsStore';
import { fileAsDataUrl } from '@/lib/file-data-url';
import { JobStatusPill } from '@/components/StatusPill';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import { GenExampleButton, PromptHeader } from '@/components/PromptHeader';
import { useExamplePrompt } from '@/hooks/useExamplePrompt';
import { ModelNote, ModelPickerCard } from '@/components/ModelPickerCard';
import { VideoDownloadLink, VideoResultStage } from '@/components/VideoResult';
import { useClaimSeedFrame, useReferenceIntake } from '@/hooks/useReferenceIntake';
import { ReferencePicker, SwapFramesButton } from '@/components/ReferencePicker';

/**
 * Video for Runware, Atlas Cloud, and CometAPI, laid out the way the Kie and
 * fal workspaces already are: one header, a left column of setup inputs and a
 * right column with Prompt above Result. The shared
 * pieces are literally shared — the draft store, the drop-and-paste handling,
 * the micro-AI example and slug helpers, ModelControls, LastFrameActions — so a
 * prompt or a reference image survives switching providers.
 */
interface ProviderVideoWorkspaceProps {
  provider: ProviderId;
  label: string;
  /**
   * 'frames' is first-and-last: two images, in order. Runware's models that
   * accept two `frameImages` document exactly that reading for a pair, so it
   * needs no positioning beyond the order they are sent in.
   */
  inputMode: ProviderMode;
  onBack: () => void;
  onOpenConnections: (provider?: EngineId) => void;
  /** Switch this workspace to image-to-video, for continuing from a last frame. */
  onContinueFromFrame?: () => void;
}

const isTerminal = (state: ProviderJob['state']) => state === 'success' || state === 'error';

/**
 * The vendor's own constraints, rendered through the same control component the
 * Kie and fal workspaces use. Duration and size are per model — a length or a
 * width/height the model does not publish is rejected outright — so the options
 * come from the catalog entry rather than from a fixed list.
 */
function controlFieldsFor(model: ProviderModel | undefined): ModelControlField[] {
  if (!model) return [];
  const fields: ModelControlField[] = [];

  if (model.duration?.type === 'range') {
    fields.push({
      key: 'duration',
      label: 'Duration',
      type: 'number',
      description: `${model.duration.min}–${model.duration.max} whole seconds.`,
      defaultValue: model.duration.default,
      min: model.duration.min,
      max: model.duration.max,
      step: 1,
    });
  } else if (model.duration?.type === 'options') {
    fields.push({
      key: 'duration',
      label: 'Duration',
      type: 'select',
      defaultValue: model.duration.values[0],
      options: model.duration.values.map((seconds) => ({
        label: `${seconds} seconds`,
        value: seconds,
      })),
    });
  } else if (model.durations?.length) {
    fields.push({
      key: 'duration',
      label: 'Duration',
      type: 'select',
      defaultValue: model.durations[0],
      options: model.durations.map((seconds) => ({ label: `${seconds} seconds`, value: seconds })),
    });
  }
  if (model.sizes?.length) {
    fields.push({
      key: 'size',
      label: 'Output size',
      type: 'select',
      // The pixels are what the vendor returns, and some of these tables round:
      // Seedance's "480p · 9:16" is 496×864, which is not 9:16. The value stays
      // the bare label — the rate table, `resolveSize` and the carry-over rule
      // all key off it — so only what is read changes.
      description: hasApproximateSize(model.sizes)
        ? `Only the combinations this model publishes. ${APPROXIMATE_LEGEND}`
        : 'Only the combinations this model publishes.',
      defaultValue: model.sizes[0].label,
      options: model.sizes.map((size) => ({
        label: withDimensions(size.label, sizeDimensions(size)),
        value: size.label,
      })),
    });
  }
  const sizeNamesAspect = model.sizes?.some((size) => size.label.includes('·')) ?? false;
  if (model.aspectRatios?.length && !sizeNamesAspect) fields.push({ key: 'aspectRatio', label: 'Aspect ratio', type: 'select', defaultValue: model.aspectRatios[0], options: model.aspectRatios.map(value => ({ label: value, value })) });
  if (model.supportsAudio) {
    const silent = model.rate?.usdByResolution;
    const spoken = model.rate?.audioUsdByResolution;
    const audioMovesPrice = !silent || !spoken || Object.keys(spoken).some((key) => spoken[key] !== silent[key]);
    fields.push({
      key: 'audio',
      label: 'Generate audio',
      type: 'boolean',
      defaultValue: false,
      description: audioMovesPrice
        ? 'Audio changes the price per second.'
        : 'Optional synchronized audio. The published rate is the same either way.',
    });
  }
  return fields;
}

function defaultValuesFor(fields: ModelControlField[]): Record<string, string | number | boolean> {
  return Object.fromEntries(
    fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue as string | number | boolean])
  );
}

/**
 * The aspect to send with a run. The control is omitted when a size label
 * already names the ratio, so a fresh Lite draft has no `values.aspectRatio`.
 * `String(undefined)` is the literal "undefined", which the guest route and
 * the account validator both reject. A chosen ratio wins; otherwise the ratio
 * is read out of the selected size (`720p · 9:16`). Nothing is sent when
 * neither is a ratio this model lists.
 */
function submittedAspectRatio(
  model: ProviderModel | undefined,
  values: Record<string, string | number | boolean>,
): string | undefined {
  const listed = model?.aspectRatios;
  if (!listed?.length) return undefined;
  const chosen = values.aspectRatio;
  if (typeof chosen === 'string' && listed.includes(chosen)) return chosen;
  const label = typeof values.size === 'string' ? values.size : '';
  const named = label.match(/(\d+)\s*:\s*(\d+)/);
  const derived = named ? `${named[1]}:${named[2]}` : undefined;
  return derived && listed.includes(derived) ? derived : undefined;
}

/** References are held as Files; every provider here wants a data URI. */
export default function ProviderVideoWorkspace({
  provider,
  label,
  inputMode,
  onBack,
  onOpenConnections,
  onContinueFromFrame,
}: ProviderVideoWorkspaceProps) {
  const cloudWorkspace = useCloudWorkspace(provider);
  const geminiApiKey = useAppStore((state) => state.apiKey);
  const runwareApiKey = useAppStore((state) => state.runwareApiKey);
  const atlasApiKey = useAppStore((state) => state.atlasApiKey);
  const piapiApiKey = useAppStore((state) => state.piapiApiKey);
  const cometApiKey = useAppStore((state) => state.cometApiKey);
  const runwareVideoModel = useAppStore((state) => state.runwareVideoModel);
  const atlasVideoModel = useAppStore((state) => state.atlasVideoModel);
  const piapiVideoModel = useAppStore((state) => state.piapiVideoModel);
  const cometVideoModel = useAppStore((state) => state.cometVideoModel);
  const setProviderModel = useAppStore((state) => state.setProviderModel);

  const apiKey =
    provider === 'runware' ? runwareApiKey : provider === 'atlas' ? atlasApiKey : provider === 'piapi' ? piapiApiKey : cometApiKey;
  const preference =
    provider === 'runware'
      ? runwareVideoModel
      : provider === 'atlas'
        ? atlasVideoModel
        : provider === 'piapi' ? piapiVideoModel : cometVideoModel;

  // Models that cannot take the current input mode are filtered out rather than
  // failing at the vendor — Runware's Wan 2.6 Flash, for one, is image-only.
  const models = useMemo(
    () => modelsFor(provider, 'video').filter((model) => model.modes.includes(inputMode)),
    [inputMode, provider]
  );
  const selectedModel = models.find((model) => model.id === preference) ?? models[0];
  const modelKey = `${provider}:${inputMode}:${selectedModel?.id ?? 'none'}`;
  const isEdit = inputMode === 'edit';
  const fields = useMemo(() => {
    const draftField = {key: 'draftPreview', label: 'Draft', type: 'boolean' as const, defaultValue: false, description: '480p preview. Finalize the one you like at 1080p.'};
    if (!isEdit || !selectedModel?.videoEdit) {
      const next = controlFieldsFor(selectedModel);
      if (selectedModel?.draftPreview) next.push(draftField);
      return next;
    }
    const fields = controlFieldsFor({...selectedModel, duration: undefined, durations: undefined, sizes: selectedModel.videoEdit.sizes, aspectRatios: undefined, supportsAudio: false});
    if (selectedModel.videoEdit.aspectRatios?.length) fields.push({
      key: 'aspectRatio', label: 'Target aspect ratio', type: 'select', defaultValue: '',
      description: 'Letterboxes the source. Leave this on “Keep source frame” to send the clip unchanged.',
      options: [{ label: 'Keep source frame', value: '' }, ...selectedModel.videoEdit.aspectRatios.map(value => ({ label: value, value }))],
    });
    if (selectedModel.videoEdit.draftRate) fields.push({key: 'draft', label: 'Draft mode', type: 'boolean', defaultValue: false, description: 'Faster, lower-quality preview at a lower price. Turn off for Standard quality.'});
    else if (selectedModel.videoEdit.draftPreview) fields.push(draftField);
    return fields;
  }, [selectedModel, isEdit]);
  const epoch = useAccountStore(state => state.epoch);
  const [selectedSource, setSelectedSource] = useState<SourceVideo | null>(null);
  const source = selectedSource?.epoch === epoch ? selectedSource : null;
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadKind, setUploadKind] = useState<'source' | 'video' | 'audio' | null>(null);
  const [clipVideos, setClipVideos] = useState<AttachedReferenceClip[]>([]);
  const [clipAudios, setClipAudios] = useState<AttachedReferenceClip[]>([]);
  const uploadedSource = useRef<{file: File; key: string; id: string} | null>(null);
  const uploadedClips = useRef<Map<File, { key: string; id: string }>>(new Map());
  const submitFlight = useRef(false);
  const clipEpoch = useRef(0);
  const clipScopeKey = `${modelKey}:${epoch}`;
  const [clipScope, setClipScope] = useState(clipScopeKey);
  if (clipScope !== clipScopeKey) {
    setClipScope(clipScopeKey);
    setClipVideos([]);
    setClipAudios([]);
  }
  // A ref write during render is rejected, and a passive effect can lose to the
  // probe's microtask. Layout runs before the browser delivers the next media
  // event, so an in-flight add sees the new epoch and does not write the old
  // clips back. The upload cache goes with them: those ids belonged to the
  // previous model.
  useLayoutEffect(() => {
    clipEpoch.current += 1;
    uploadedClips.current.clear();
  }, [clipScopeKey]);

  const prompt = useDraftStore((state) => state.prompt);
  const setPrompt = useDraftStore((state) => state.setPrompt);

  // Claims the prompt field for this kind of work, dropping a prompt written
  // for the other kind. Declared ahead of every other mount effect here so a
  // stale prompt cannot outlive this line and block what those effects set.
  useEffect(() => {
    useDraftStore.getState().enterPromptScope('video');
  }, []);
  const references = useDraftStore((state) => state.references);
  const controlValues = useDraftStore((state) => state.controlValues);
  const [valuesByModel, setValuesByModel] = useState<
    Record<string, Record<string, string | number | boolean>>
  >({});
  const storedValues =
    valuesByModel[modelKey] ?? carryOverValues(fields, defaultValuesFor(fields), controlValues);
  const seedancePreview = Boolean(isEdit ? selectedModel?.videoEdit?.draftPreview : selectedModel?.draftPreview);
  const draftSizeLabel = seedanceDraftSizeLabel(
    isEdit ? selectedModel?.videoEdit?.sizes : selectedModel?.sizes,
    typeof storedValues.size === 'string' ? storedValues.size : undefined,
  );
  // Read the 480p size while Draft is on. Writing it from an effect fought the
  // control's own render, and a stale 720p would be what the request sent.
  // Seedance remembers `draftPreview`. P-Video-Edit remembers `draft`. One key
  // turned the other model's cheaper mode on when the selection changed.
  const seedanceDraftOn = storedValues.draftPreview === true && seedancePreview;
  const values = seedanceDraftOn && draftSizeLabel
    ? { ...storedValues, size: draftSizeLabel }
    : storedValues;
  const shownFields = useMemo(() => {
    if (!seedanceDraftOn) return fields;
    return fields.map((field) => {
      if (field.key !== 'size' || !field.options) return field;
      const options = field.options.filter((option) => isSeedanceDraftSize(String(option.value)));
      return options.length ? { ...field, options } : field;
    });
  }, [fields, seedanceDraftOn]);
  const relaxed = useRelaxedFilter({
    workspaceKey: 'provider-video',
    provider,
    modelId: selectedModel?.id ?? '',
    prompt,
    hasReferences: references.length > 0 || Boolean(source) || clipVideos.length > 0 || clipAudios.length > 0,
  });

  const [modelSearch, setModelSearch] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isDescribing, setIsDescribing] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoRetry = useAutoRetry();
  // Latest submit, so a queued retry re-runs the button's own path with the
  // prompt and settings on screen now, not the ones from the failed render.
  const submitRef = useRef<() => void>(() => {});
  const [isDownloading, setIsDownloading] = useState(false);
  const mountedRef = useRef(true);
  const isFrames = inputMode === 'frames';
  const describeSources = useMemo(() => {
    // Text mode submits no media. A reference left in the draft from Image
    // mode would otherwise be described and then ignored by the run.
    if (inputMode === 'text') return [];
    const items: { file: File; label: string }[] = [];
    if (source) items.push({ file: source.file, label: 'Source video' });
    references.forEach((reference, index) => {
      items.push({
        file: reference.file,
        label: isFrames ? frameSlotLabel(index) : `Image ${index + 1}`,
      });
    });
    return items;
  }, [inputMode, source, references, isFrames]);
  const isReference = inputMode === 'reference';
  const clipCapability = referenceClipsFor(selectedModel, inputMode);
  const clipSyntax = selectedModel?.videoInputs?.reference?.promptSyntax;
  const imageReferencesOnly = isReference || isEdit;
  const inputCapability = inputMode === 'text' ? undefined : selectedModel?.videoInputs?.[inputMode];
  // Reference arrays can be larger at the provider, but data-URI requests stay
  // practical at five views. The server still enforces the documented hard max.
  const maxInputImages = isEdit ? (selectedModel?.videoEdit?.maxImages ?? 0) : isFrames
    ? 2
    : imageReferencesOnly
      ? (inputCapability?.clientMaxImages ?? Math.min(inputCapability?.maxImages ?? 5, 5))
      : (inputCapability?.maxImages ?? selectedModel?.maxInputImages ?? 1);
  const referenceToken = (index: number) =>
    inputCapability?.promptSyntax === 'at-image-underscore-index' ? `@image_${index + 1}` : inputCapability?.promptSyntax === 'at-image-index' ? `@Image${index + 1}` : `Image ${index + 1}`;
  const matchingModels = models.filter((model) =>
    `${model.label} ${model.id}`.toLowerCase().includes(modelSearch.toLowerCase())
  );

  const allJobs = useProviderJobsStore((state) => state.jobs);
  const needsKey = cloudWorkspace.cloud ? !cloudWorkspace.connected : !apiKey.trim();
  const hasFinishedWork = cloudWorkspace.cloud ? cloudWorkspace.hasJobs : allJobs.some((job) => job.provider === provider);
  const gated = isGated(needsKey, hasFinishedWork);
  const patchJob = useProviderJobsStore((state) => state.patchJob);
  const latestJob = allJobs.find(
    (job) =>
      job.provider === provider && job.inputMode === inputMode
  );
  const resultUrl = latestJob?.state === 'success' ? latestJob.urls[0] : undefined;

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

  const updateValues = (key: string, value: string | number | boolean) => {
    const next = { ...values, [key]: value };
    if (key === 'draftPreview' && value === true) {
      const label = seedanceDraftSizeLabel(isEdit ? selectedModel?.videoEdit?.sizes : selectedModel?.sizes, typeof next.size === 'string' ? next.size : undefined);
      if (label) next.size = label;
    }
    setValuesByModel((current) => ({ ...current, [modelKey]: next }));
    // Remembered globally so the next model inherits whatever it can express.
    useDraftStore.getState().rememberControlValues(key === 'draftPreview' && next.size !== values.size ? { draftPreview: value, size: next.size } : { [key]: value });
  };

  // Adding a reference (or the first frame) snaps "Output size" to the entry
  // in this model's whitelist closest to that image's shape.
  const sizeCandidates = useMemo(() => {
    const sizes = selectedModel?.sizes ?? [];
    const usable = seedanceDraftOn ? sizes.filter((size) => isSeedanceDraftSize(size.label)) : sizes;
    return candidatesFromSizes(usable.length ? usable : sizes);
  }, [selectedModel, seedanceDraftOn]);
  /**
   * What this press will cost, at the settings on screen.
   *
   * The rate and the duration were both already here, and the reader was left
   * to multiply them — once per clip, without mixing up which tier they had
   * selected. Priced through the same resolver the spend ledger uses, so the
   * figure on the button and the figure in the ledger cannot disagree; null
   * whenever the vendor never published a rate for this size, which is a
   * silence rather than a guess.
   */
  const pricedSize = typeof values.size === 'string' ? values.size : undefined;
  const estimate = resolveCatalogRate(
    selectedModel,
    isEdit ? source?.durationSeconds : typeof values.duration === 'number' ? values.duration : undefined,
    1,
    { inputMode, draft: values.draft === true || values.draftPreview === true, size: pricedSize, audio: values.audio === true }
  );

  useAutoAspect(isEdit ? undefined : references[0], sizeCandidates, (value) => {
    if (value !== values.size) updateValues('size', value);
  }, typeof values.size === 'string' ? values.size : undefined);

  const isPickerFull = references.length >= maxInputImages;
  useClaimSeedFrame(inputMode !== 'text' && !isReference && !isEdit, 1, inputMode);
  const { addFiles: addReferences, isReadingFrame, isDragging, isFetching, dropProps } = useReferenceIntake({
    referenceCount: references.length,
    maxImages: maxInputImages,
    accept: (file) =>
      imageReferencesOnly ? file.type.startsWith('image/') : file.type.startsWith('image/') || isVideoFile(file),
    unusableMessage: isReference
      ? 'Choose an image for this character reference.'
      : 'Choose an image, or a video to continue from its last frame.',
    tooManyMessage: isReference
      ? `Add up to ${maxInputImages} character views for this generation.`
      : `This model accepts up to ${maxInputImages} reference image${maxInputImages === 1 ? '' : 's'}.`,
    pasteEnabled: inputMode !== 'text',
    dropDisabled: isPickerFull,
    onError: setError,
  });

  const removeReference = (index: number) => {
    const reference = references[index];
    if (reference) useDraftStore.getState().removeReference(reference.id);
  };

  const example = useExamplePrompt({
    featureId: inputMode === 'text' ? 'text-to-video' : 'image-to-video',
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
  const attachSlug = async (jobId: string, jobPrompt: string) => {
    const slug = await requestPromptSlug(jobPrompt, geminiApiKey);
    if (slug) patchJob(jobId, { slug });
  };

  const pollJob = async (job: ProviderJob) => {
    const reportTerminal = (succeeded: boolean, error?: string) => {
      trackQueuedTerminal({
        engine: provider,
        route: job.modelId,
        model: findModel(provider, job.modelId)?.label ?? job.modelId,
        media: 'video',
        controlValues: job.controlValues,
        succeeded,
        error,
      });
    };
    try {
      const result = await followProviderVideo({
        startedAttempt: job.pollAttempt,
        delayMs: pollDelayMs,
        timeoutMessage: `${label} is taking longer than expected. Check your provider dashboard for this task.`,
        poll: () => getProviderVideoStatus({
          provider,
          apiKey,
          taskId: job.taskId as string,
          model: job.modelId,
          sourceVideo: job.sourceVideoId,
          ...(job.referenceVideoIds?.length ? { referenceVideos: job.referenceVideoIds } : {}),
          ...(job.referenceAudioIds?.length ? { referenceAudios: job.referenceAudioIds } : {}),
        }),
        onUpdate: (patch) => patchJob(job.id, patch),
        onSuccess: (task) => {
          reportTerminal(true);
          const current = useProviderJobsStore.getState().jobs.find((entry) => entry.id === job.id);
          recordFinishedJob(
            provider,
            {
              id: job.id,
              mediaType: 'video',
              prompt: job.prompt,
              slug: current?.slug,
              modelId: job.modelId,
              inputMode: job.inputMode,
              controlValues: job.controlValues,
              mimeType: 'video/mp4',
              ...(task.draftId ? { draftId: task.draftId } : {}),
            },
            task.urls[0]
          );
          captureProviderJob(provider, job, task);
          toast.success('Video ready');
          playGenerationChime();
        },
      });
      if (result.outcome === 'error') {
        reportTerminal(false, result.error);
        toast.error(result.error || `${label} could not finish this video.`);
      } else if (result.outcome === 'timeout') {
        reportTerminal(false, result.error);
      }
    } catch (cause) {
      const current = useProviderJobsStore.getState().jobs.find((entry) => entry.id === job.id);
      if (current?.state === 'success' && current.urls.length > 0) return;
      const message = cause instanceof Error ? cause.message : 'Polling failed.';
      reportTerminal(false, message);
      patchJob(job.id, { state: 'error', error: message });
    }
  };

  const filenameBase = latestJob
    ? downloadFilenameBase({
        prompt: latestJob.prompt,
        mediaType: 'video',
        slug: latestJob.slug,
        provider,
        modelId: latestJob.modelId,
      })
    : '';

  const downloadResult = async () => {
    if (!latestJob || !resultUrl) return;
    if (!isDownloadableMediaUrl(resultUrl)) {
      setError(`This ${label} result URL has expired and can no longer be downloaded.`);
      return;
    }

    setError(null);
    setIsDownloading(true);
    try {
      await downloadRemoteMedia({
        url: resultUrl,
        mediaType: 'video',
        filenameBase,
      });
    } finally {
      if (mountedRef.current) setIsDownloading(false);
    }
  };

  const submit = async () => {
    if (submitFlight.current) return;
    // Says why, as the fal and Kie workspaces already do. This was the only
    // submit guard here that could return without a word, and a press that
    // produces nothing at all reads as a broken button rather than a wait.
    if (cloudWorkspace.checking) {
      setError('Still checking your account. Try again in a moment.');
      return;
    }
    if (needsKey) {
      setError(`Connect your ${label} key before starting a generation.`);
      onOpenConnections(provider);
      return;
    }
    if (!selectedModel) {
      setError(`${label} has no model for this mode.`);
      return;
    }
    if (!prompt.trim()) {
      setError('Describe the clip you want before generating.');
      return;
    }
    const floor = inspectPrompt(prompt, relaxed.levelRef.current);
    if (floor.blocked && floor.message) {
      setError(floor.message);
      return;
    }
    if (inputMode === 'image' && references.length === 0) {
      setError('Add the image this clip should start from.');
      return;
    }
    if (isEdit && !source) { setError('Choose a source video to edit.'); return; }
    if (isReference && references.length === 0) {
      const clipsStandIn = clipVideos.length > 0 || (clipAudios.length > 0 && Boolean(clipCapability && !clipCapability.audioRequiresVisual));
      if (!clipsStandIn) {
        setError(clipCapability ? 'Add a character view, a reference video, or reference audio.' : 'Add at least one character view.');
        return;
      }
    }
    if (clipCapability) {
      const clipSet = referenceClipSetError(clipCapability, {
        images: inputMode === 'text' ? 0 : references.length,
        videos: clipVideos.length,
        audios: clipAudios.length,
      });
      if (clipSet) {
        setError(clipSet);
        return;
      }
    }
    if ((clipVideos.length > 0 || clipAudios.length > 0) && provider === 'atlas' && !cloudWorkspace.cloud) {
      setError('Atlas reference video and audio need a background job, so the files have a hosted address.');
      return;
    }
    if (isFrames && references.length < 2) {
      setError('Add both frames — the first, then the last.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    submitFlight.current = true;
    const referenceVideos: string[] = [];
    const referenceAudios: string[] = [];
    let taskStarted = false;
    const listedEditRatio = typeof values.aspectRatio === 'string' && selectedModel?.videoEdit?.aspectRatios?.includes(values.aspectRatio) ? values.aspectRatio : undefined;
    const aspectRatio = isEdit ? listedEditRatio : submittedAspectRatio(selectedModel, values);
    try {
      if (isEdit && source && selectedModel.videoEdit) validateEditSource(source, selectedModel.videoEdit);
      if (cloudWorkspace.cloud) {
        const submittedSize = typeof values.size === 'string' ? values.size : undefined;
        await cloudWorkspace.submit({modelId:selectedModel.id, mediaType:'video', inputMode, prompt:prompt.trim(), values:{
          ...(!isEdit && typeof values.duration === 'number' ? {durationSeconds:values.duration} : {}),
          ...((!isEdit || selectedModel.videoEdit?.sizes.length) && submittedSize ? {size:submittedSize} : {}),
          ...(isEdit && selectedModel.videoEdit?.draftRate ? {draft:values.draft === true} : {}),
          ...(seedanceDraftOn ? {draft: true} : {}),
          ...(isEdit && selectedModel.videoEdit?.draftPreview && source?.durationSeconds ? {sourceDurationSeconds: source.durationSeconds} : {}),
          ...(!isEdit && selectedModel?.supportsAudio ? {audio:values.audio === true} : {}),
          ...(aspectRatio ? { aspectRatio } : {}),
          ...relaxed.attach(),
        }}, inputMode === 'text' ? [] : references.map(reference => reference.file), prompt.trim(), isEdit ? source?.file : undefined, clipCapability ? { videos: clipVideos.map((clip) => clip.file), audios: clipAudios.map((clip) => clip.file) } : undefined);
        autoRetry.reset();
        return;
      }
      const liveApiKey = () => {
        const state = useAppStore.getState();
        return provider === 'runware' ? state.runwareApiKey : provider === 'atlas' ? state.atlasApiKey : provider === 'piapi' ? state.piapiApiKey : state.cometApiKey;
      };
      let sourceVideo: string | undefined;
      if (isEdit && source) {
        if (provider === 'comet' && isRunwayEditProtocol(selectedModel.videoEdit)) {
          // Length before any bytes are read. Encoding a 100 MB clip and then
          // rejecting the data URI freezes the tab for a check the size already answers.
          if (alephDataUriLength(source.file.size, source.file.type) > ALEPH_DATA_URI_MAX) {
            throw new Error('This clip is too large for a browser Aleph 2 edit. The provider accepts a data URI of at most 5 MB. Sign in and run it as a background job where the file has an https address, or use a smaller clip.');
          }
          sourceVideo = await fileAsDataUrl(source.file, 'Could not read that video.');
          if (!isAlephVideoUri(sourceVideo)) throw new Error('This clip is too large for a browser Aleph 2 edit. The provider accepts a data URI of at most 5 MB. Sign in and run it as a background job where the file has an https address, or use a smaller clip.');
        } else {
          if (uploadedSource.current?.file !== source.file || uploadedSource.current.key !== apiKey) {
            setUploadKind('source');
            setUploadProgress(0);
            const id = await uploadRunwareVideo(source.file, apiKey, setUploadProgress);
            uploadedSource.current = {file: source.file, key: apiKey, id};
          }
          sourceVideo = uploadedSource.current.id;
          setUploadProgress(null);
        }
        if (!mountedRef.current || useAccountStore.getState().epoch !== epoch) throw new Error('Your session changed. Review the edit before submitting.');
      }
      const uploadClip = async (file: File, kind: 'video' | 'audio') => {
        const cached = uploadedClips.current.get(file);
        if (cached?.key === apiKey) return cached.id;
        setUploadKind(kind);
        setUploadProgress(0);
        const id = await uploadRunwareMedia(fileWithReferenceClipType(file, kind), apiKey, setUploadProgress);
        uploadedClips.current.set(file, { key: apiKey, id });
        return id;
      };
      for (const clip of clipVideos) referenceVideos.push(await uploadClip(clip.file, 'video'));
      for (const clip of clipAudios) referenceAudios.push(await uploadClip(clip.file, 'audio'));
      if (referenceVideos.length > 0 || referenceAudios.length > 0) {
        setUploadProgress(null);
        if (!mountedRef.current || useAccountStore.getState().epoch !== epoch || liveApiKey() !== apiKey) throw new Error('Your session changed. Review the generation before submitting.');
      }
      const images = provider === 'piapi' && inputMode === 'text' ? [] : await Promise.all(references.map((reference) => fileAsDataUrl(reference.file, 'Could not read that image.')));
      if (isEdit && (!mountedRef.current || useAccountStore.getState().epoch !== epoch || liveApiKey() !== apiKey)) throw new Error('Your session changed. Review the edit before submitting.');
      const submittedPrompt = prompt.trim();
      const taskId = await submitProviderVideo({
        provider,
        apiKey,
        model: selectedModel.id,
        prompt: submittedPrompt,
        inputMode,
        images,
        sourceVideo,
        ...(referenceVideos.length > 0 ? { referenceVideos } : {}),
        ...(referenceAudios.length > 0 ? { referenceAudios } : {}),
        durationSeconds: isEdit ? undefined : typeof values.duration === 'number' ? values.duration : undefined,
        size: ((!isEdit || selectedModel.videoEdit?.sizes.length) && typeof values.size === 'string' ? values.size : undefined) || undefined,
        ...(isEdit && selectedModel.videoEdit?.draftRate ? {draft:values.draft === true} : {}),
        ...(seedanceDraftOn ? {draft: true} : {}),
        ...(!isEdit && selectedModel?.supportsAudio ? {audio:values.audio === true} : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...relaxed.attach(),
      });
      usePromptLibraryStore.getState().remember(submittedPrompt);
      taskStarted = true;
      uploadedClips.current.clear();
      const jobId = useProviderJobsStore.getState().startJob({
        provider,
        taskId,
        modelId: selectedModel.id,
        ...(sourceVideo ? {sourceVideoId: sourceVideo} : {}),
        ...(referenceVideos.length > 0 ? { referenceVideoIds: referenceVideos } : {}),
        ...(referenceAudios.length > 0 ? { referenceAudioIds: referenceAudios } : {}),
        prompt: submittedPrompt,
        inputMode,
        controlValues: {
          ...values,
          ...relaxed.attach(),
          ...(seedanceDraftOn ? { draft: true } : {}),
          ...(isEdit && source?.durationSeconds ? { sourceDurationSeconds: source.durationSeconds } : {}),
        },
        state: 'queued',
        urls: [],
      });
      if (isEdit) uploadedSource.current = null;
      // Runs alongside the generation so the name is ready before the result is.
      void attachSlug(jobId, submittedPrompt);
      const started = useProviderJobsStore.getState().jobs.find((job) => job.id === jobId);
      if (started) void pollJob(started);
      autoRetry.reset();
      trackGenerationSubmitted({ engine: provider, route: selectedModel.id, model: selectedModel.label, level: relaxed.levelRef.current, media: 'video' });
      toast.success('Task queued.');
    } catch (submissionError) {
      if (!taskStarted && provider === 'runware' && (referenceVideos.length > 0 || referenceAudios.length > 0)) {
        const videos = referenceVideos;
        const audios = referenceAudios;
        uploadedClips.current.clear();
        void releaseRunwareMedia({ apiKey, referenceVideos: videos, referenceAudios: audios }).catch(() => {});
      }
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : `${label} could not start this task.`;
      trackGenerationResult({ engine: provider, route: selectedModel?.id ?? provider, model: selectedModel?.label ?? provider, level: relaxed.levelRef.current, outcome: classifyFailure(message).kind, media: 'video' });
      setError(message);
      // Sent again only when the request never reached a decision — a bad key or
      // an empty balance would fail identically five more times, and the retry
      // would only bury the sentence explaining why.
      const retrying = !isEdit && !cloudWorkspace.cloud && isRetryableFailure(submissionError) && autoRetry.schedule(() => submitRef.current());
      toast.error(retrying ? `${message} Retrying in ${AUTO_RETRY_DELAY_SECONDS}s.` : message);
    } finally {
      submitFlight.current = false;
      if (mountedRef.current) { setIsSubmitting(false); setUploadProgress(null); }
    }
  };

  useEffect(() => {
    submitRef.current = () => void submit();
  });

  const refusal = error
    ? refusalPresentation(error, {
        providerLabel: label,
        modelLabel: selectedModel?.label ?? provider,
        level: relaxed.effective,
        route: { provider, modelId: selectedModel?.id ?? '' },
        hasReferences: references.length > 0 || Boolean(source) || clipVideos.length > 0 || clipAudios.length > 0,
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-3.5 sm:space-y-4">
      <WorkspaceHeader
        provider={provider}
        label={label}
        title={
          isEdit
            ? 'Edit video'
            : isFrames
              ? 'First & last frame to video'
              : isReference
                ? 'Character references'
                : `${inputMode === 'text' ? 'Text' : 'Image'} to video`
        }
        needsKey={needsKey}
        onBack={onBack}
        onOpenConnections={onOpenConnections}
      />

      <ConnectionGate
        storage={cloudWorkspace.cloud ? 'account' : 'browser'}
        provider={provider}
        label={label}
        needsKey={needsKey}
        hasFinishedWork={hasFinishedWork}
        onConnect={() => onOpenConnections(provider)}
      >
      <GenerationWorkspaceLayout
        setup={
          <>
          <ModelPickerCard searchLabel="Search compatible models" search={modelSearch} onSearch={setModelSearch}>
            <ModelListbox
              label="Model"
              accent="video"
              columns={PROVIDER_VIDEO_COLUMNS}
              rows={(matchingModels.length > 0 ? matchingModels : models).map((model) => ({
                id: model.id,
                label: model.label,
                cells: providerVideoSpecs(model, inputMode),
              }))}
              value={selectedModel?.id}
              onChange={(id) => {
                setError(null);
                setProviderModel(provider, 'video', id);
              }}
            />
            {selectedModel && (
              <ModelNote label={selectedModel.label}>
                {isEdit ? selectedModel.videoEdit?.note ?? 'Edit the source clip with optional reference images. Duration and aspect ratio follow the source; changes are guided by your prompt.' : selectedModel.note ??
                  `Billed to your ${label} account at ${selectedModel.price && selectedModel.price !== 'metered' ? selectedModel.price : 'the vendor’s rates'}.`}
              </ModelNote>
            )}
          </ModelPickerCard>

          {isEdit && <VideoSourceInput capability={selectedModel!.videoEdit!} source={source} onChange={setSelectedSource} disabled={isSubmitting}
            youtube={cloudWorkspace.cloud ? {provider, modelId: selectedModel!.id, modelLabel: selectedModel!.label} : undefined} />}
          {inputMode !== 'text' && maxInputImages > 0 && (
            <section className="glass-card space-y-3 p-3.5 md:p-4">
              <div>
                <h3 className="display text-base font-semibold">
                  {isEdit ? 'Replacement images (optional)' : isFrames
                    ? 'First and last frame'
                    : isReference
                      ? 'Add character views'
                      : `Reference image${maxInputImages === 1 ? '' : 's'}`}
                </h3>
                <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                  {isEdit ? `Add up to ${maxInputImages} character, product, or setting images to guide the edit. Address images as ${selectedModel?.videoEdit?.promptSyntax === 'image-index' ? 'image 1, image 2' : '@Image1, @Image2'}, and so on.` : isFrames
                    ? 'Two images, in order: the frame the clip opens on, then the one it ends on. The model builds the motion between them.'
                    : isReference
                      ? `Add up to ${maxInputImages} front, three-quarter, or profile views. Their order becomes ${referenceToken(0)}, ${referenceToken(1)}, and so on in your prompt.`
                      : `Upload up to ${maxInputImages}; files are forwarded to ${label} only for this task. Pick a saved clip and its last frame is used.`}
                </p>
              </div>
              {!isPickerFull && (
                <ReferencePicker
                  accept={imageReferencesOnly ? 'image/*' : 'image/*,video/*'}
                  multiple={maxInputImages > 1}
                  accent="purple"
                  idleLabel={imageReferencesOnly ? 'Drop, upload, or paste reference images' : 'Drop, upload, or paste an image or video'}
                  referenceCount={references.length}
                  referenceLimit={maxInputImages}
                  intake={{ addFiles: addReferences, isReadingFrame, isFetching, isDragging, dropProps }}
                />
              )}
              <ReferenceStack
                layout="grid"
                replaceLimit={maxInputImages}
                captionClassName="text-[0.65rem] font-medium text-[var(--neon-purple)]"
                items={references.map((reference, index) => ({
                  id: reference.id,
                  src: reference.previewUrl,
                  caption: isFrames ? frameSlotLabel(index) : isEdit ? (selectedModel?.videoEdit?.promptSyntax === 'image-index' ? `Image ${index + 1}` : `@Image${index + 1}`) : isReference ? referenceToken(index) : undefined,
                  alt: isFrames
                    ? frameSlotLabel(index)
                    : isReference
                      ? `Image ${index + 1} character reference`
                      : `Reference ${index + 1}`,
                  removeLabel: isFrames
                    ? `Remove ${frameSlotLabel(index).toLowerCase()}`
                    : isReference
                      ? `Remove Image ${index + 1}`
                      : `Remove reference ${index + 1}`,
                  sourceLabel: reference.sourceLabel,
                }))}
                onRemove={removeReference}
              />
              {isFrames && references.length === 2 && <SwapFramesButton />}
            </section>
          )}

          {clipCapability && (
            <ReferenceClipTray
              key={clipScopeKey}
              epoch={clipEpoch}
              capability={clipCapability}
              syntax={clipSyntax}
              videos={clipVideos}
              audios={clipAudios}
              onVideos={setClipVideos}
              onAudios={setClipAudios}
              disabled={isSubmitting}
              hostedOnly={provider === 'atlas' && !cloudWorkspace.cloud}
            />
          )}

          {(fields.length > 0 || relaxed.offered) && (
            <section className="glass-card space-y-3 p-3.5 md:p-4">
              <div>
                <h3 className="display text-base font-semibold">Model controls</h3>
                <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                  {isEdit ? 'Duration and aspect ratio match the source video.' : `Only the lengths and sizes ${selectedModel?.label} publishes are offered.`}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ModelControls
                  namespace={`provider-${modelKey}`}
                  fields={shownFields}
                  values={values}
                  onChange={updateValues}
                />
                <RelaxedFilterControl filter={relaxed} />
              </div>
            </section>
          )}
          </>
        }
        prompt={
          <PromptPanel paused={gated} hasPrompt={prompt.trim().length > 0}>
            <PromptHeader htmlFor="provider-video-prompt">
              <SavedPromptsButton />
              <DescribeSourceButton
                sources={describeSources}
                apiKey={geminiApiKey}
                prompt={prompt}
                disabled={example.generating}
                onPrompt={(next) => {
                  setDescribeError(null);
                  setPrompt(next);
                }}
                onError={(message) => {
                  setDescribeError(message);
                  toast.error(message);
                }}
                onNotice={(message) => {
                  toast.message(message);
                }}
                onBusyChange={(busy) => {
                  setIsDescribing(busy);
                  if (busy) setDescribeError(null);
                }}
              />
              {!isEdit && (
                <GenExampleButton
                  busy={example.generating}
                  disabled={isDescribing}
                  onClick={() => void example.generate()}
                />
              )}
            </PromptHeader>
            {describeError && (
              <p role="alert" className="text-xs text-red-300">{describeError}</p>
            )}
            {isEdit && <div className="flex flex-wrap gap-2">{Object.entries(EDIT_PROMPTS).map(([label, text]) => <button key={label} type="button" className="btn-secondary" onClick={() => setPrompt(selectedModel?.videoEdit?.promptSyntax === 'image-index' ? text.replace('@Video1', 'the source video').replace(/@Image(\d+)/g, 'image $1') : text)}>{label}</button>)}</div>}
            <AutoExpandingPrompt
              id="provider-video-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={isEdit ? (selectedModel?.videoEdit?.namesSource ? 'Describe what to change in @Video1 and what to keep…' : 'Describe what to change in the source video and what to keep…') : clipCapability ? `Describe the motion. Address clips as ${clipToken(clipSyntax, 'Video', 0)} and ${clipToken(clipSyntax, 'Audio', 0)}.` : "Describe the motion, camera, mood, and scene…"}
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
              // A disabled control has to carry its own reason: the guard above
              // can only be reached programmatically, so for a pointer this
              // button going dead is the whole of the explanation on offer.
              title={cloudWorkspace.checking ? 'Still checking your account.' : undefined}
              className="btn-primary w-full"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={21} /> {uploadProgress !== null ? `Uploading ${uploadKind === 'audio' ? 'reference audio' : uploadKind === 'video' ? 'reference video' : 'source'}… ${uploadProgress}%` : 'Starting…'}
                </>
              ) : (
                <>
                  <Sparkles size={21} /> {cloudWorkspace.cloud && cloudWorkspace.fakeGeneration ? 'Run simulation · test video only' : isEdit ? 'Generate edit' : 'Generate video'}
                  {!(cloudWorkspace.cloud && cloudWorkspace.fakeGeneration) && estimate.costUsd !== null && (
                    <span className="font-normal opacity-80">{` · ~$${estimate.costUsd.toFixed(2)}`}</span>
                  )}
                </>
              )}
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
        results={<>
          {cloudWorkspace.cloud ? <CloudJobPanel provider={provider} mediaType="video" inputMode={inputMode} onContinueFromFrame={onContinueFromFrame} /> :
          <section className="glass-card flex min-h-[420px] flex-col gap-4 p-3.5 md:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="display text-base font-semibold">Result</h3>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                Results are temporary — download anything you want to keep.
              </p>
              {/* Read the producing model from the result, not the next-run selection. */}
              {latestJob && (
                <p className="mt-0.5 text-xs text-[var(--foreground-subtle)]">{findModel(latestJob.provider, latestJob.modelId)?.label ?? latestJob.modelId}</p>
              )}
            </div>
            {latestJob && (
              <JobStatusPill
                tone={latestJob.state === 'error' ? 'danger' : latestJob.state === 'success' ? 'success' : 'warning'}
                label={
                  latestJob.state === 'queued'
                    ? 'Queued'
                    : latestJob.state === 'running'
                      ? 'Generating'
                      : latestJob.state === 'success'
                        ? `Done${latestJob.cost !== undefined ? ` · $${latestJob.cost.toFixed(3)}` : ''}`
                        : 'Failed'
                }
                startedAt={latestJob.createdAt}
                finishedAt={isTerminal(latestJob.state) ? latestJob.updatedAt : undefined}
              />
            )}
          </div>
          <VideoResultStage
            resultUrl={resultUrl}
            accent="purple"
            working={
              latestJob && !isTerminal(latestJob.state)
                ? { label: `${label} is working on your video.`, startedAt: latestJob.createdAt, progress: latestJob.progress }
                : undefined
            }
            error={
              latestJob?.state === 'error' ? (
                <>
                  {latestJob.error || `${label} could not complete this task. It was not resubmitted.`}
                  {latestJob.taskId && <span className="mt-2 block break-all font-mono text-xs">Provider task: {latestJob.taskId}</span>}
                </>
              ) : undefined
            }
          />
          {resultUrl && latestJob && (
            <VideoDownloadLink
              href={resultUrl}
              filename={`${filenameBase}.${extensionForMedia('video')}`}
              busy={isDownloading}
              label="Download video"
              onDownload={() => void downloadResult()}
            />
          )}
          {resultUrl && latestJob?.draftId && (
            <FinalizeDraftButton
              inputMode={latestJob.inputMode}
              durationSeconds={seedanceDraftSeconds(latestJob.controlValues)}
              busy={isSubmitting}
              onApprove={async () => {
                const seconds = seedanceDraftSeconds(latestJob.controlValues);
                if (!latestJob.draftId || seconds === undefined) throw new Error('This draft has no saved length, so it cannot be priced.');
                setIsSubmitting(true);
                try {
                  await runGuestFinalize({
                    apiKey, modelId: latestJob.modelId, prompt: latestJob.prompt, inputMode: latestJob.inputMode,
                    draftId: latestJob.draftId, durationSeconds: seconds,
                  });
                  toast.success('1080p video ready.');
                } finally {
                  if (mountedRef.current) setIsSubmitting(false);
                }
              }}
            />
          )}
          {resultUrl && latestJob && (
            <LastFrameActions
              videoUrl={resultUrl}
              filenameBase={filenameBase}
              onContinue={onContinueFromFrame}
            />
          )}
          </section>}
          </>
        }
      />
      </ConnectionGate>
    </div>
  );
}
