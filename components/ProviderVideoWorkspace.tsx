'use client';
// components/ProviderVideoWorkspace.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Download, ImagePlus, Loader2, Search, Sparkles, Video } from 'lucide-react';
import { toast } from 'sonner';
import { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
import CloudExecutionNotice from '@/components/account/CloudExecutionNotice';
import CloudJobPanel from '@/components/account/CloudJobPanel';

import VideoSourceInput, { type SourceVideo } from '@/components/VideoSourceInput';
import { useAccountStore } from '@/store/useAccountStore';
import { EDIT_PROMPTS, validateEditSource } from '@/lib/providers/video-edit';
import { uploadRunwareVideo } from '@/lib/providers/upload-video';
import LastFrameActions from '@/components/LastFrameActions';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import PromptPanel from '@/components/PromptPanel';
import SavedPromptsButton from '@/components/SavedPromptsButton';
import ModelControls, { type ModelControlField } from '@/components/ModelControls';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import SubmissionError from '@/components/SubmissionError';
import {
  AUTO_RETRY_DELAY_SECONDS,
  isRetryableFailure,
  useAutoRetry,
} from '@/lib/providers/auto-retry';
import ProviderLogo from '@/components/ProviderLogo';
import StoredImagePicker from '@/components/StoredImagePicker';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import ReferenceStack from '@/components/ReferenceStack';
import { candidatesFromSizes, useAutoAspect } from '@/lib/draft/aspect-match';
import {
  APPROXIMATE_LEGEND,
  hasApproximateSize,
  sizeDimensions,
  withDimensions,
} from '@/lib/providers/output-size';
import { resolveCatalogRate } from '@/lib/spend/resolve';
import { carryOverValues } from '@/lib/draft/carry-over';
import { useFileDrop } from '@/lib/drop/use-file-drop';
import { recordFinishedJob } from '@/lib/gallery/record-job';
import { playGenerationChime } from '@/lib/notify/chime';
import { captureProviderJob } from '@/lib/spend/capture';
import {
  downloadRemoteMedia,
  extensionForMedia,
  isDownloadableMediaUrl,
} from '@/lib/media-download';
import { downloadFilenameBase } from '@/lib/download-name';
import { requestExamplePrompt, requestPromptSlug } from '@/lib/micro-ai/browser';
import { getProviderVideoStatus, pollDelayMs, submitProviderVideo } from '@/lib/providers/browser';
import { modelsFor } from '@/lib/providers/catalog';
import ModelListbox from '@/components/ModelListbox';
import { PROVIDER_VIDEO_COLUMNS, providerVideoSpecs } from '@/lib/models/listbox-specs';
import { frameSlotLabel } from '@/lib/providers/frames';
import type { ProviderId, ProviderMode, ProviderModel } from '@/lib/providers/types';
import type { EngineId } from '@/lib/engines/registry';
import { FRAME_EXTRACTION_ERROR, isVideoFile, lastFrameAsImageFile } from '@/lib/video-frame';
import { useAppStore } from '@/store/useAppStore';
import { prepareReferences } from '@/lib/draft/ingest';
import { keepUploadedImages } from '@/lib/gallery/keep-upload';
import { useDraftStore } from '@/store/useDraftStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import { useProviderJobsStore, type ProviderJob } from '@/store/useProviderJobsStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';
import VideoPlayer from '@/components/video/VideoPlayer';
import JobElapsed from '@/components/JobElapsed';

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

/** A job stops polling after this many attempts (~7 minutes at the top delay). */
const MAX_POLL_ATTEMPTS = 60;

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
function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

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
  const imageFormat = useAppStore((state) => state.imageFormat);
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
    if (!isEdit || !selectedModel?.videoEdit) return controlFieldsFor(selectedModel);
    const fields = controlFieldsFor({...selectedModel, duration: undefined, durations: undefined, sizes: selectedModel.videoEdit.sizes, aspectRatios: undefined, supportsAudio: false});
    if (selectedModel.videoEdit.draftRate) fields.push({key: 'draft', label: 'Draft mode', type: 'boolean', defaultValue: false, description: 'Faster, lower-quality preview at a lower price. Turn off for Standard quality.'});
    return fields;
  }, [selectedModel, isEdit]);
  const epoch = useAccountStore(state => state.epoch);
  const [selectedSource, setSelectedSource] = useState<SourceVideo | null>(null);
  const source = selectedSource?.epoch === epoch ? selectedSource : null;
  const [submittedEditJob, setSubmittedEditJob] = useState<{jobId: string; epoch: number} | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const uploadedSource = useRef<{file: File; key: string; id: string} | null>(null);
  const submitFlight = useRef(false);

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
  const values =
    valuesByModel[modelKey] ?? carryOverValues(fields, defaultValuesFor(fields), controlValues);

  const [modelSearch, setModelSearch] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isGeneratingExample, setIsGeneratingExample] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoRetry = useAutoRetry();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isReadingFrame, setIsReadingFrame] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Latest addReferences, so the paste listener attaches once instead of per render.
  const addReferencesRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  const mountedRef = useRef(true);
  const isFrames = inputMode === 'frames';
  const isReference = inputMode === 'reference';
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
      job.provider === provider && job.modelId === selectedModel?.id && job.inputMode === inputMode
  );
  const resultUrl = latestJob?.state === 'success' ? latestJob.urls[0] : undefined;

  // Claim a frame handed over by "Continue from last frame".
  useEffect(() => {
    if (inputMode === 'text' || isReference || isEdit) return;
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
  }, [inputMode, isReference, isEdit]);

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

  useEffect(() => {
    if (inputMode === 'text') return;

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
    setValuesByModel((current) => ({ ...current, [modelKey]: { ...values, [key]: value } }));
    // Remembered globally so the next model inherits whatever it can express.
    useDraftStore.getState().rememberControlValues({ [key]: value });
  };

  // Adding a reference (or the first frame) snaps "Output size" to the entry
  // in this model's whitelist closest to that image's shape.
  const sizeCandidates = useMemo(
    () => candidatesFromSizes(selectedModel?.sizes ?? []),
    [selectedModel]
  );
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
  const estimate = resolveCatalogRate(
    selectedModel,
    isEdit ? source?.durationSeconds : typeof values.duration === 'number' ? values.duration : undefined,
    1,
    { inputMode, draft: values.draft === true, size: typeof values.size === 'string' ? values.size : undefined, audio: values.audio === true }
  );

  useAutoAspect(isEdit ? undefined : references[0], sizeCandidates, (value) => {
    if (value !== values.size) updateValues('size', value);
  }, typeof values.size === 'string' ? values.size : undefined);

  const addReferences = async (files: File[]) => {
    const usable = files.filter((file) =>
      imageReferencesOnly ? file.type.startsWith('image/') : file.type.startsWith('image/') || isVideoFile(file)
    );
    if (usable.length === 0) {
      setError(
        isReference
          ? 'Choose an image for this character reference.'
          : 'Choose an image, or a video to continue from its last frame.'
      );
      return;
    }
    if (references.length + usable.length > maxInputImages) {
      setError(
        isReference
          ? `Add up to ${maxInputImages} character views for this generation.`
          : `This model accepts up to ${maxInputImages} reference image${maxInputImages === 1 ? '' : 's'}.`
      );
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

  const isPickerFull = references.length >= maxInputImages;
  const { isDragging, isFetching, dropProps } = useFileDrop({
    onFiles: (files) => addReferencesRef.current(files),
    onError: setError,
    disabled: isPickerFull,
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
      setPrompt(
        await requestExamplePrompt(
          inputMode === 'text' ? 'text-to-video' : 'image-to-video',
          geminiApiKey
        )
      );
    } catch (exampleError) {
      const message =
        exampleError instanceof Error ? exampleError.message : 'Could not generate an example prompt.';
      setError(message);
      toast.error(message);
    } finally {
      setIsGeneratingExample(false);
    }
  };

  // Ask flash-lite for a short evocative filename slug and pin it to the job, so
  // the download is named after the prompt rather than the provider's task ID.
  const attachSlug = async (jobId: string, jobPrompt: string) => {
    const slug = await requestPromptSlug(jobPrompt, geminiApiKey);
    if (slug) patchJob(jobId, { slug });
  };

  const pollJob = async (job: ProviderJob) => {
    let attempt = job.pollAttempt;
    try {
      while (attempt < MAX_POLL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs(attempt)));
        attempt += 1;
        const task = await getProviderVideoStatus({
          provider,
          apiKey,
          taskId: job.taskId as string,
          sourceVideo: job.sourceVideoId,
        });
        patchJob(job.id, {
          state: task.state,
          progress: task.progress,
          urls: task.urls,
          cost: task.cost,
          error: task.error,
          pollAttempt: attempt,
        });

        if (task.state === 'success') {
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
            },
            task.urls[0]
          );
          captureProviderJob(provider, job, task);
          toast.success('Video ready');
          playGenerationChime();
          return;
        }
        if (task.state === 'error') {
          toast.error(task.error || `${label} could not finish this video.`);
          return;
        }
      }
      patchJob(job.id, {
        state: 'error',
        error: `${label} is taking longer than expected. Check your provider dashboard for this task.`,
      });
    } catch (cause) {
      patchJob(job.id, {
        state: 'error',
        error: cause instanceof Error ? cause.message : 'Polling failed.',
      });
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
    if (inputMode === 'image' && references.length === 0) {
      setError('Add the image this clip should start from.');
      return;
    }
    if (isEdit && !source) { setError('Choose a source video to edit.'); return; }
    if (isReference && references.length === 0) {
      setError('Add at least one character view.');
      return;
    }
    if (isFrames && references.length < 2) {
      setError('Add both frames — the first, then the last.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    submitFlight.current = true;
    const aspectRatio = !isEdit ? submittedAspectRatio(selectedModel, values) : undefined;
    try {
      if (isEdit && source && selectedModel.videoEdit) validateEditSource(source, selectedModel.videoEdit);
      if (cloudWorkspace.cloud) {
        const job = await cloudWorkspace.submit({modelId:selectedModel.id, mediaType:'video', inputMode, prompt:prompt.trim(), values:{
          ...(!isEdit && typeof values.duration === 'number' ? {durationSeconds:values.duration} : {}),
          ...((!isEdit || selectedModel.videoEdit?.sizes.length) && typeof values.size === 'string' ? {size:values.size} : {}),
          ...(isEdit && selectedModel.videoEdit?.draftRate ? {draft:values.draft === true} : {}),
          ...(!isEdit && selectedModel?.supportsAudio ? {audio:values.audio === true} : {}),
          ...(aspectRatio ? { aspectRatio } : {}),
        }}, inputMode === 'text' ? [] : references.map(reference => reference.file), prompt.trim(), isEdit ? source?.file : undefined);
        if (isEdit && source) setSubmittedEditJob({epoch: source.epoch, jobId: job.id});
        autoRetry.reset();
        return;
      }
      let sourceVideo: string | undefined;
      if (isEdit && source) {
        if (uploadedSource.current?.file !== source.file || uploadedSource.current.key !== apiKey) {
          setUploadProgress(0);
          const id = await uploadRunwareVideo(source.file, apiKey, setUploadProgress);
          uploadedSource.current = {file: source.file, key: apiKey, id};
        }
        sourceVideo = uploadedSource.current.id;
        setUploadProgress(null);
        if (!mountedRef.current || useAccountStore.getState().epoch !== epoch) throw new Error('Your session changed. Review the edit before submitting.');
      }
      const images = provider === 'piapi' && inputMode === 'text' ? [] : await Promise.all(references.map((reference) => fileAsDataUrl(reference.file)));
      if (isEdit && (!mountedRef.current || useAccountStore.getState().epoch !== epoch || useAppStore.getState().runwareApiKey !== apiKey)) throw new Error('Your session changed. Review the edit before submitting.');
      const submittedPrompt = prompt.trim();
      const taskId = await submitProviderVideo({
        provider,
        apiKey,
        model: selectedModel.id,
        prompt: submittedPrompt,
        inputMode,
        images,
        sourceVideo,
        durationSeconds: isEdit ? undefined : typeof values.duration === 'number' ? values.duration : undefined,
        size: (!isEdit || selectedModel.videoEdit?.sizes.length) && typeof values.size === 'string' ? values.size : undefined,
        ...(isEdit && selectedModel.videoEdit?.draftRate ? {draft:values.draft === true} : {}),
        ...(!isEdit && selectedModel?.supportsAudio ? {audio:values.audio === true} : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
      });
      usePromptLibraryStore.getState().remember(submittedPrompt);
      const jobId = useProviderJobsStore.getState().startJob({
        provider,
        taskId,
        modelId: selectedModel.id,
        ...(sourceVideo ? {sourceVideoId: sourceVideo} : {}),
        prompt: submittedPrompt,
        inputMode,
        controlValues: values,
        state: 'queued',
        urls: [],
      });
      if (isEdit) uploadedSource.current = null;
      // Runs alongside the generation so the name is ready before the result is.
      void attachSlug(jobId, submittedPrompt);
      const started = useProviderJobsStore.getState().jobs.find((job) => job.id === jobId);
      if (started) void pollJob(started);
      autoRetry.reset();
      toast.success('Task queued.');
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : `${label} could not start this task.`;
      setError(message);
      // Sent again only when the request never reached a decision — a bad key or
      // an empty balance would fail identically five more times, and the retry
      // would only bury the sentence explaining why.
      const retrying = !isEdit && !cloudWorkspace.cloud && isRetryableFailure(submissionError) && autoRetry.schedule(() => void submit());
      toast.error(retrying ? `${message} Retrying in ${AUTO_RETRY_DELAY_SECONDS}s.` : message);
    } finally {
      submitFlight.current = false;
      if (mountedRef.current) { setIsSubmitting(false); setUploadProgress(null); }
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
              <div className="eyebrow mb-1 flex items-center gap-1.5 text-[var(--neon-purple)]">
                <ProviderLogo provider={provider} size={13} /> {label}
              </div>
              <h2 className="display text-lg font-semibold text-[var(--foreground)] sm:text-xl">
                {isEdit ? 'Edit video' : isFrames
                  ? 'First & last frame to video'
                  : isReference
                    ? 'Character references'
                    : `${inputMode === 'text' ? 'Text' : 'Image'} to video`}
              </h2>
            </div>
          </div>
          {/* One call to action per state: while the key is missing the callout
              below owns it, so the header keeps only the connected-state status
              button rather than repeating the same ask two rows apart. */}
          {!needsKey && (
            <button
              type="button"
              onClick={() => onOpenConnections(provider)}
              className="btn-secondary shrink-0 px-3 py-2 text-xs"
            >
              {label} key connected
            </button>
          )}
        </div>
      </section>

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
          <section className="glass-card space-y-3 p-3.5 md:p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="display text-base font-semibold">Model</h3>
              <div className="flex w-40 max-w-[48%] items-center gap-2">
                <Search
                  className="pointer-events-none shrink-0 text-[var(--foreground-subtle)]"
                  size={14}
                />
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
                <p className="px-0.5 text-sm leading-relaxed text-[var(--foreground-muted)]">
                  <span className="font-medium text-[var(--foreground)]">{selectedModel.label}:</span>{' '}
                  {isEdit ? selectedModel.videoEdit?.note ?? 'Edit the source clip with optional reference images. Duration and aspect ratio follow the source; changes are guided by your prompt.' : selectedModel.note ??
                    `Billed to your ${label} account at ${selectedModel.price && selectedModel.price !== 'metered' ? selectedModel.price : 'the vendor’s rates'}.`}
                </p>
              )}
            </div>
          </section>

          {isEdit && <VideoSourceInput capability={selectedModel!.videoEdit!} source={source} onChange={setSelectedSource} disabled={isSubmitting} />}
          {inputMode !== 'text' && (
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
              <input
                ref={fileInputRef}
                type="file"
                accept={imageReferencesOnly ? 'image/*' : 'image/*,video/*'}
                multiple={maxInputImages > 1}
                className="hidden"
                onChange={(event) => {
                  void addReferences(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
              {!isPickerFull && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    {...dropProps}
                    className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed py-3.5 text-sm transition-colors sm:flex-1 ${isDragging ? 'border-[var(--neon-purple)] bg-[var(--neon-purple)]/10 text-[var(--neon-purple)]' : 'border-[var(--neon-purple)]/30 text-[var(--foreground-muted)] hover:border-[var(--neon-purple)] hover:bg-[var(--neon-purple)]/5 hover:text-[var(--neon-purple)]'}`}
                  >
                    {isReadingFrame || isFetching ? (
                      <Loader2 className="animate-spin" size={28} />
                    ) : (
                      <ImagePlus size={28} />
                    )}
                    {isReadingFrame
                      ? 'Reading last frame…'
                      : isFetching
                        ? 'Fetching dropped image…'
                        : isDragging
                          ? 'Drop to use as a source'
                          : imageReferencesOnly
                            ? 'Drop, upload, or paste reference images'
                            : 'Drop, upload, or paste an image or video'}
                  </button>
                  {references.length < maxInputImages && (
                    <StoredImagePicker referenceLimit={maxInputImages} />
                  )}
                </div>
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
              {/* Which image opens the clip and which closes it is the whole of
                  this mode, and picking them in the wrong order is a two-file
                  re-upload without this. */}
              {isFrames && references.length === 2 && (
                <button
                  type="button"
                  onClick={() => useDraftStore.getState().reorderReference(0, 1)}
                  className="btn-secondary flex w-full items-center justify-center gap-2 text-sm"
                >
                  <ArrowUpDown size={15} /> Swap first and last
                </button>
              )}
            </section>
          )}

          {fields.length > 0 && (
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
                  fields={fields}
                  values={values}
                  onChange={updateValues}
                />
              </div>
            </section>
          )}
          </>
        }
        prompt={
          <PromptPanel paused={gated} hasPrompt={prompt.trim().length > 0}>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="provider-video-prompt" className="display block text-base font-semibold">
                Prompt
              </label>
              <div className="flex items-center gap-1.5">
                <SavedPromptsButton />
                {!isEdit && <button
                  type="button"
                  onClick={() => void generateExample()}
                  disabled={isGeneratingExample}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--brand-accent)]/30 bg-[var(--brand-accent)]/10 px-2.5 py-1.5 text-xs font-medium text-[var(--brand-accent)] transition-colors hover:text-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
                  title="Generate an example prompt with the shared fast model, or your own Gemini key"
                >
                  {isGeneratingExample ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {isGeneratingExample ? 'Thinking…' : 'Gen Example'}
                </button>}
              </div>
            </div>
            {isEdit && <div className="flex flex-wrap gap-2">{Object.entries(EDIT_PROMPTS).map(([label, text]) => <button key={label} type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setPrompt(selectedModel?.videoEdit?.promptSyntax === 'image-index' ? text.replace('@Video1', 'the source video').replace(/@Image(\d+)/g, 'image $1') : text)}>{label}</button>)}</div>}
            <AutoExpandingPrompt
              id="provider-video-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={isEdit ? "Describe what to change in @Video1 and what to keep…" : "Describe the motion, camera, mood, and scene…"}
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
              className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-base disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={21} /> {uploadProgress !== null ? `Uploading source… ${uploadProgress}%` : 'Starting…'}
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
              <SubmissionError message={error} retry={autoRetry.pending} onCancelRetry={autoRetry.cancel} />
            )}
          </>
        }
        results={<>
          {cloudWorkspace.cloud ? <CloudJobPanel provider={provider} modelId={selectedModel?.id ?? ''} mediaType="video" inputMode={inputMode} resultJobId={isEdit && submittedEditJob?.epoch === epoch ? submittedEditJob.jobId : undefined} onContinueFromFrame={onContinueFromFrame} /> :
          <section className="glass-card flex min-h-[420px] flex-col gap-4 p-3.5 md:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="display text-base font-semibold">Result</h3>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                Results are temporary — download anything you want to keep.
              </p>
              {/* The result on screen belongs to this model — the same name the
                  download is tagged with. */}
              {latestJob && selectedModel && (
                <p className="mt-0.5 text-xs text-[var(--foreground-subtle)]">{selectedModel.label}</p>
              )}
            </div>
            {latestJob && (
              <span
                className={`rounded-full border px-2.5 py-1 text-xs ${latestJob.state === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-300' : latestJob.state === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}
              >
                <span>
                  {latestJob.state === 'queued'
                    ? 'Queued'
                    : latestJob.state === 'running'
                      ? 'Generating'
                      : latestJob.state === 'success'
                        ? `Done${latestJob.cost !== undefined ? ` · $${latestJob.cost.toFixed(3)}` : ''}`
                        : 'Failed'}
                </span>
                <span aria-hidden="true">{' · '}</span>
                <JobElapsed
                  startedAt={latestJob.createdAt}
                  finishedAt={isTerminal(latestJob.state) ? latestJob.updatedAt : undefined}
                />
              </span>
            )}
          </div>
          <div className="flex min-h-[300px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]/70">
            {resultUrl ? (
              <VideoPlayer
                src={resultUrl}
                label="Generated video"
                className="h-full max-h-[520px] w-full"
              />
            ) : latestJob && !isTerminal(latestJob.state) ? (
              <div className="space-y-3 p-5 text-center">
                <Loader2 className="mx-auto animate-spin text-[var(--neon-purple)]" size={34} />
                <p className="text-sm text-[var(--foreground-muted)]">
                  {label} is working on your video.{' '}
                  {/* From the job's `createdAt`, so it counts the queue too and
                      survives a reload — the wait a person actually feels. */}
                  <JobElapsed startedAt={latestJob.createdAt} className="text-[var(--foreground)]" />
                </p>
                {typeof latestJob.progress === 'number' && (
                  <p className="font-mono text-xs text-[var(--neon-purple)]">
                    {Math.round(latestJob.progress * 100)}%
                  </p>
                )}
              </div>
            ) : latestJob?.state === 'error' ? (
              <p className="max-w-sm p-5 text-center text-sm text-red-300">
                {latestJob.error || `${label} could not complete this task. It was not resubmitted.`}
                {latestJob.taskId && <span className="mt-2 block break-all font-mono text-xs">Provider task: {latestJob.taskId}</span>}
              </p>
            ) : (
              <div className="p-5 text-center text-[var(--foreground-muted)]">
                <Video className="mx-auto mb-3 opacity-35" size={46} />
                <p>Your generated video will appear here.</p>
              </div>
            )}
          </div>
          {resultUrl && latestJob && (
            <a
              href={resultUrl}
              download={`${filenameBase}.${extensionForMedia('video')}`}
              onClick={(event) => {
                // Results are served cross-origin, where the download attribute is
                // ignored — fetch the bytes so the semantic name survives.
                event.preventDefault();
                void downloadResult();
              }}
              className="btn-secondary flex w-full items-center justify-center gap-2"
            >
              {isDownloading ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
              {isDownloading ? 'Preparing download…' : 'Download video'}
            </a>
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
