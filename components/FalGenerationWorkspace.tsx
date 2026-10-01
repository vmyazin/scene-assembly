'use client';

import { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
import CloudExecutionNotice from '@/components/account/CloudExecutionNotice';
import CloudJobPanel from '@/components/account/CloudJobPanel';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Download, ImagePlus, Loader2, Search, Sparkles, Video } from 'lucide-react';

import LastFrameActions from '@/components/LastFrameActions';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import PromptPanel from '@/components/PromptPanel';
import SavedPromptsButton from '@/components/SavedPromptsButton';
import ModelControls from '@/components/ModelControls';
import ProviderLogo from '@/components/ProviderLogo';
import StoredImagePicker from '@/components/StoredImagePicker';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import SubmissionError from '@/components/SubmissionError';
import { isRetryableFailure, useAutoRetry } from '@/lib/providers/auto-retry';
import ReferenceStack from '@/components/ReferenceStack';
import { requestExamplePrompt, requestPromptSlug } from '@/lib/micro-ai/browser';
import { cancelFalJob, submitFalJob, uploadFalFiles } from '@/lib/fal/browser';
import {
  buildFalInput,
  defaultFalValues,
  falModelLabel,
  modelsForFalMode,
  resolveFalVariant,
  validateFalInput,
} from '@/lib/fal/catalog';
import { useFileDrop } from '@/lib/drop/use-file-drop';
import { isFalJobTerminal } from '@/lib/fal/queue';
import type { FalFieldDefinition, FalInputMode, FalJob, FalTaskState, FalValue } from '@/lib/fal/types';
import {
  downloadRemoteMedia,
  extensionForMedia,
} from '@/lib/media-download';
import { downloadFilenameBase } from '@/lib/download-name';
import { useAppStore } from '@/store/useAppStore';
import { useFalJobsStore } from '@/store/useFalJobsStore';
import { useSeedFrameStore } from '@/store/useSeedFrameStore';
import { frameSlotLabel } from '@/lib/providers/frames';
import { prepareReferences } from '@/lib/draft/ingest';
import { keepUploadedImages } from '@/lib/gallery/keep-upload';
import { useDraftStore } from '@/store/useDraftStore';
import { usePromptLibraryStore } from '@/store/usePromptLibraryStore';
import { candidatesFromValues, useAutoAspect } from '@/lib/draft/aspect-match';
import ModelListbox from '@/components/ModelListbox';
import { FAL_VIDEO_COLUMNS, falVideoSpecs } from '@/lib/models/listbox-specs';
import FalRunCost from '@/components/FalRunCost';
import { carryOverValues } from '@/lib/draft/carry-over';
import { FRAME_EXTRACTION_ERROR, isVideoFile, lastFrameAsImageFile } from '@/lib/video-frame';
import type { EngineId } from '@/lib/engines/registry';
import VideoPlayer from '@/components/video/VideoPlayer';
import JobElapsed from '@/components/JobElapsed';

interface FalGenerationWorkspaceProps {
  inputMode: FalInputMode;
  onBack: () => void;
  onOpenConnections: (provider?: EngineId) => void;
  /** Switch this workspace to image-to-video, for continuing from a last frame. */
  onContinueFromFrame?: () => void;
}

interface SubmissionOperation {
  controller: AbortController;
  phase: 'uploading' | 'submitting';
  stale: boolean;
  reconciled: boolean;
  token: symbol;
}

const statusCopy: Record<FalTaskState, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Completed',
  fail: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled',
};

const modeTitles: Record<FalInputMode, string> = {
  text: 'Text to video',
  image: 'Image to video',
  frames: 'First & last frame to video',
};

const submissionError = 'fal could not start this job. Please try again.';
const cancellationError = 'fal could not cancel this job. Please try again.';
const allowedImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);

function isSafeFalVideoUrl(value: string | undefined, mimeType: string | undefined): value is string {
  const hasInvalidMimeType = mimeType !== undefined
    && !/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType);
  if (!value || hasInvalidMimeType || value !== value.trim() || /\s/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    const isFalCdn = url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media');
    return url.protocol === 'https:' && !url.username && !url.password && isFalCdn;
  } catch {
    return false;
  }
}

function safeProviderText(value: string | undefined, apiKey: string, fallback: string): string {
  const text = value?.trim();
  let encodedKey = '';
  try {
    encodedKey = encodeURIComponent(apiKey);
  } catch {
    encodedKey = '';
  }
  const jsonKey = JSON.stringify(apiKey);
  const credentialVariants = [apiKey, encodedKey, jsonKey, jsonKey.slice(1, -1)].filter(Boolean);
  const normalizedText = text?.toLowerCase() ?? '';
  if (
    !text ||
    text.length > 512 ||
    credentialVariants.some((credential) => normalizedText.includes(credential.toLowerCase()))
  ) {
    return fallback;
  }
  return text;
}

/**
 * Surface why a request failed rather than a generic retry prompt: the upload and
 * queue routes already return actionable copy ("The source file must be a supported
 * raster image."), and safeProviderText keeps a credential or a runaway string from
 * reaching the alert.
 */
function safeFailureText(error: unknown, apiKey: string, fallback: string): string {
  return safeProviderText(error instanceof Error ? error.message : undefined, apiKey, fallback);
}

function JobCard({
  job,
  apiKey,
  cancelling,
  cancelError,
  onCancel,
  onContinueFromFrame,
}: {
  job: FalJob;
  apiKey: string;
  cancelling: boolean;
  cancelError?: string;
  onCancel: (job: FalJob) => void;
  onContinueFromFrame?: () => void;
}) {
  const resultUrl = isSafeFalVideoUrl(job.resultUrl, job.mimeType) ? job.resultUrl : undefined;
  const error = safeProviderText(job.error, apiKey, 'fal could not complete this job.');
  const logs = job.logs.slice(-20).map((log) => safeProviderText(log, apiKey, 'fal reported an update.'));
  const filenameBase = downloadFilenameBase({
    prompt: job.prompt,
    mediaType: 'video',
    slug: job.slug,
    provider: 'fal',
    modelId: job.modelId,
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const download = async (url: string) => {
    setIsDownloading(true);
    try {
      await downloadRemoteMedia({
        url,
        mediaType: 'video',
        filenameBase,
        mimeType: job.mimeType,
      });
    } finally {
      if (mountedRef.current) setIsDownloading(false);
    }
  };

  return (
    <article className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)]/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${job.state === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : job.state === 'fail' || job.state === 'timed_out' ? 'border-red-500/30 bg-red-500/10 text-red-300' : job.state === 'cancelled' ? 'border-[var(--border)] text-[var(--foreground-muted)]' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
          {/* A queued or running job has nothing else moving on the card until the
              video lands, so the spinner is the only sign polling is still alive. */}
          {!isFalJobTerminal(job.state) && <Loader2 aria-hidden className="animate-spin" size={12} />}
          {/* Its own element, not more text in the pill: the state is what a
              reader scans for, and it stays exactly matchable. */}
          <span>{statusCopy[job.state]}</span>
          <span aria-hidden="true">·</span>
          <JobElapsed
            startedAt={job.createdAt}
            finishedAt={isFalJobTerminal(job.state) ? job.updatedAt : undefined}
          />
        </span>
        {/* The model, not the request ID: it is what tells two jobs apart at a
            glance, and it stays true after the picker has moved on. The ID is
            still there on hover for anything that needs quoting to fal. */}
        <span className="text-xs text-[var(--foreground-muted)]" title={job.requestId}>
          {falModelLabel(job.modelId)}
        </span>
      </div>

      <p className="line-clamp-3 text-sm text-[var(--foreground-muted)]">{job.prompt}</p>

      {resultUrl && (
        <div className="space-y-3">
          <VideoPlayer src={resultUrl} label="Generated video" className="max-h-[520px] w-full rounded-lg" />
          <a
            href={resultUrl}
            download={`${filenameBase}.${extensionForMedia('video', job.mimeType)}`}
            onClick={(event) => {
              // fal serves results from its CDN, where the download attribute is
              // ignored — fetch the bytes so the semantic name survives.
              event.preventDefault();
              void download(resultUrl);
            }}
            className="btn-secondary flex w-full items-center justify-center gap-2"
          >
            {isDownloading ? <Loader2 className="animate-spin" size={17} /> : <Download size={17} />}
            {isDownloading ? 'Preparing download…' : 'Download video'}
          </a>
          <LastFrameActions
            videoUrl={resultUrl}
            filenameBase={filenameBase}
            onContinue={onContinueFromFrame}
          />
        </div>
      )}

      {(job.state === 'fail' || job.state === 'timed_out') && (
        <p className="text-sm text-red-300">
          {job.state === 'timed_out'
            ? 'Stopped checking. The job may still finish at fal.'
            : error}
        </p>
      )}
      {job.state === 'cancelled' && (
        <p className="text-sm text-[var(--foreground-muted)]">This job was cancelled.</p>
      )}

      {logs.length > 0 && (
        <ul aria-label={`Logs for ${job.requestId}`} className="max-h-32 space-y-1 overflow-auto font-mono text-xs text-[var(--foreground-subtle)]">
          {logs.map((log, index) => <li key={`${index}-${log}`}>{log}</li>)}
        </ul>
      )}

      {!isFalJobTerminal(job.state) && (
        <button
          type="button"
          aria-label={`Cancel request ${job.requestId}`}
          disabled={cancelling}
          onClick={() => onCancel(job)}
          className="btn-secondary w-full disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </button>
      )}
      {cancelError && <p role="alert" className="text-sm text-red-300">{cancelError}</p>}
    </article>
  );
}

function FalGenerationWorkspaceSession({
  inputMode,
  onBack,
  onOpenConnections,
  onContinueFromFrame,
}: FalGenerationWorkspaceProps) {
  const apiKey = useAppStore((state) => state.falApiKey);
  const imageFormat = useAppStore((state) => state.imageFormat);
  const geminiApiKey = useAppStore((state) => state.apiKey);
  const falVideoModel = useAppStore((state) => state.falVideoModel);
  const setFalVideoModel = useAppStore((state) => state.setFalVideoModel);
  const jobs = useFalJobsStore((state) => state.jobs);
  const cloudWorkspace=useCloudWorkspace('fal');
  const needsKey = cloudWorkspace.cloud ? !cloudWorkspace.connected : !apiKey.trim();
  const gated = isGated(needsKey, cloudWorkspace.cloud ? cloudWorkspace.hasJobs : jobs.length > 0);
  const upsertJob = useFalJobsStore((state) => state.upsertJob);
  const models = useMemo(() => modelsForFalMode('video', inputMode), [inputMode]);
  const selectedModel = models.find((model) => model.id === falVideoModel) ?? models[0];
  const variant = resolveFalVariant(selectedModel.id, 'video', inputMode);
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
  const [controlState, setControlState] = useState<{
    variantId: string;
    values: Record<string, FalValue>;
  } | null>(null);
  const values =
    controlState?.variantId === variant.id
      ? controlState.values
      : carryOverValues(variant.fields, defaultFalValues(variant), controlValues);
  const [modelSearch, setModelSearch] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isGeneratingExample, setIsGeneratingExample] = useState(false);
  const [isReadingFrame, setIsReadingFrame] = useState(false);
  const [submittingVariantId, setSubmittingVariantId] = useState<string | null>(null);
  const autoRetry = useAutoRetry();
  // Latest submit, so a queued retry re-runs the button's own path — validation,
  // uploads, and all — rather than a stale copy of it.
  const submitRef = useRef<() => void>(() => {});
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(() => new Set());
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submissionRef = useRef<SubmissionOperation | null>(null);
  const cancellingRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const maxInputImages = variant.maxInputImages ?? 1;
  const isFramesMode = inputMode === 'frames';
  const pickerLabel = !isFramesMode
    ? 'Choose an image, or a video to use its last frame'
    : references.length === 0
      ? 'Choose the first frame — an image, or a video to use its last frame'
      : references.length === 1
        ? 'Choose the last frame — an image, or a video to use its last frame'
        : 'Both frames chosen';
  const normalizedSearch = modelSearch.trim().toLowerCase();
  const matchingModels = models.filter((model) =>
    `${model.label} ${model.provider} ${model.description}`.toLowerCase().includes(normalizedSearch)
  );
  const videoJobs = jobs.filter((job) => job.mediaType === 'video');
  const isSubmitting = submittingVariantId === variant.id;

  // Claim a frame handed over by "Continue from last frame". Runs on mount
  // because switching into image mode remounts this session.
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
    return () => {
      const operation = submissionRef.current;
      if (operation) {
        operation.stale = true;
        if (operation.phase === 'uploading') operation.controller.abort();
        submissionRef.current = null;
      }
    };
  }, [variant.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const operation = submissionRef.current;
      if (operation) {
        operation.stale = true;
        if (operation.phase === 'uploading') operation.controller.abort();
      }
      submissionRef.current = null;
    };
  }, []);

  // A stricter model must not keep more references than it accepts.
  useEffect(() => {
    useDraftStore.getState().limitReferences(maxInputImages);
  }, [maxInputImages]);

  const abortSubmission = () => {
    const operation = submissionRef.current;
    if (operation) {
      operation.stale = true;
      if (operation.phase === 'uploading') operation.controller.abort();
    }
    submissionRef.current = null;
    setSubmittingVariantId(null);
  };

  const updateValue = (key: string, value: FalValue) => {
    setControlState((current) => ({
      variantId: variant.id,
      values: {
        ...(current?.variantId === variant.id
          ? current.values
          : carryOverValues(variant.fields, defaultFalValues(variant), controlValues)),
        [key]: value,
      },
    }));
    // Remembered globally so the next model inherits whatever it can express.
    useDraftStore.getState().rememberControlValues({ [key]: value });
  };

  // Adding a reference (or the first frame) snaps the aspect ratio to the
  // closest one this variant publishes.
  const aspectField = variant.fields.find(
    (field) => field.key === 'aspect_ratio' && field.type === 'select'
  );
  const aspectCandidates = useMemo(
    () => candidatesFromValues((aspectField?.options ?? []).map((option) => option.value)),
    [aspectField]
  );
  useAutoAspect(references[0], aspectCandidates, (value) => {
    if (value !== values.aspect_ratio) updateValue('aspect_ratio', value);
  });

  const setModel = (modelId: string) => {
    abortSubmission();
    setError(null);
    setFalVideoModel(modelId);
  };

  const addReferences = async (files: File[]) => {
    const usable = files.filter(
      (file) => allowedImageMimeTypes.has(file.type.toLowerCase()) || isVideoFile(file)
    );
    if (usable.length !== files.length || usable.length === 0) {
      setError('Choose a PNG, JPEG, WebP, or AVIF image, or a video to continue from its last frame.');
      return;
    }
    if (references.length + usable.length > maxInputImages) {
      setError(
        isFramesMode
          ? 'This flow takes exactly two frames. Remove one before choosing another.'
          : `This fal model accepts up to ${maxInputImages} reference image${maxInputImages === 1 ? '' : 's'}.`
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

  const isPickerFull = isFramesMode && references.length >= maxInputImages;
  const { isDragging, isFetching, dropProps } = useFileDrop({
    onFiles: (files) => addReferences(files),
    onError: setError,
    disabled: isPickerFull,
  });

  const removeReference = (index: number) => {
    const reference = references[index];
    if (reference) useDraftStore.getState().removeReference(reference.id);
  };

  const generateExample = async () => {
    setIsGeneratingExample(true);
    setError(null);
    try {
      setPrompt(await requestExamplePrompt(`${inputMode}-to-video`, geminiApiKey));
    } catch (exampleError) {
      if (!mountedRef.current) return;
      setError(
        exampleError instanceof Error
          ? exampleError.message
          : 'Could not generate an example prompt.'
      );
    } finally {
      if (mountedRef.current) setIsGeneratingExample(false);
    }
  };

  // Ask flash-lite for a short evocative filename slug and pin it to the job, so
  // the download is named after the prompt rather than the fal request ID.
  // Fire-and-forget — the download falls back to a client-side slug.
  const attachSlug = async (jobId: string, jobPrompt: string) => {
    const slug = await requestPromptSlug(jobPrompt, geminiApiKey);
    if (!slug) return;
    const latest = useFalJobsStore.getState().jobs.find((job) => job.id === jobId);
    if (!latest || latest.slug) return;
    upsertJob({ ...latest, slug });
  };

  const submit = async () => {
    if (submissionRef.current) return;
    if(cloudWorkspace.checking){setError('Checking your account…');return;}
    if (needsKey) {
      setError('Connect your fal API key before starting a generation.');
      onOpenConnections('fal');
      return;
    }

    const activeReferences = inputMode === 'text' ? [] : references;
    const validationError = validateFalInput(variant, {
      prompt,
      uploadUrls: activeReferences.map((reference) => reference.previewUrl),
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      buildFalInput(variant, {
        prompt,
        uploadUrls: activeReferences.map((reference) => reference.previewUrl),
        values,
      });
    } catch {
      setError('Review the selected fal model controls and try again.');
      return;
    }

    if(cloudWorkspace.cloud){
      setError(null);setSubmittingVariantId(variant.id);
      try{await cloudWorkspace.submit({modelId:selectedModel.id,mediaType:'video',inputMode,prompt:prompt.trim(),values},activeReferences.map(r=>r.file));autoRetry.reset();}
      catch(error){if(mountedRef.current)setError(error instanceof Error?error.message:'Could not confirm this background job.');}
      finally{if(mountedRef.current)setSubmittingVariantId(null);}
      return;
    }
    const operation: SubmissionOperation = {
      controller: new AbortController(),
      phase: 'uploading',
      stale: false,
      reconciled: false,
      token: Symbol('fal-submit'),
    };
    submissionRef.current = operation;
    setError(null);
    setSubmittingVariantId(variant.id);
    const isCurrent = () => mountedRef.current
      && !operation.stale
      && submissionRef.current?.token === operation.token;

    try {
      const uploadUrls = await uploadFalFiles(
        apiKey.trim(),
        activeReferences.map((reference) => reference.file),
        { signal: operation.controller.signal }
      );
      if (!isCurrent()) return;
      operation.phase = 'submitting';
      const { requestId } = await submitFalJob({
        apiKey: apiKey.trim(),
        modelId: selectedModel.id,
        mediaType: 'video',
        inputMode,
        prompt: prompt.trim(),
        uploadUrls,
        values,
      }, { signal: operation.controller.signal });
      if (!isCurrent()) {
        if (!operation.reconciled) {
          operation.reconciled = true;
          try {
            await cancelFalJob({
              apiKey: apiKey.trim(),
              modelId: selectedModel.id,
              mediaType: 'video',
              inputMode,
              requestId,
            });
          } catch {
            // Best effort only: the stale operation must never surface provider details or stale UI.
          }
        }
        return;
      }
      const now = Date.now();
      const submittedPrompt = prompt.trim();
      usePromptLibraryStore.getState().remember(submittedPrompt);
      upsertJob({
        id: requestId,
        requestId,
        state: 'queued',
        logs: [],
        modelId: selectedModel.id,
        mediaType: 'video',
        inputMode,
        prompt: submittedPrompt,
        controlValues: values,
        createdAt: now,
        updatedAt: now,
        pollAttempt: 0,
      });
      // Runs alongside the generation so the name is ready before the video is.
      void attachSlug(requestId, submittedPrompt);
      autoRetry.reset();
    } catch (submitFailure) {
      if (isCurrent() && !operation.controller.signal.aborted) {
        const message = safeFailureText(submitFailure, apiKey.trim(), submissionError);
        setError(message);
        // Only failures that never reached a decision are sent again: a rejected
        // key or an empty balance would fail identically five more times. A
        // failed submit still has no request ID to reconcile against, so a
        // retried 5xx that fal did accept can bill twice — the tradeoff taken
        // deliberately, because the alternative is a person re-pressing the
        // button through an outage.
        if (isRetryableFailure(submitFailure)) autoRetry.schedule(() => submitRef.current());
      }
    } finally {
      if (isCurrent()) {
        submissionRef.current = null;
        setSubmittingVariantId(null);
      }
    }
  };

  useEffect(() => {
    submitRef.current = () => void submit();
  });

  const cancel = async (job: FalJob) => {
    if (cancellingRef.current.has(job.id) || isFalJobTerminal(job.state)) return;
    cancellingRef.current.add(job.id);
    setCancellingIds(new Set(cancellingRef.current));
    setCancelErrors((current) => ({ ...current, [job.id]: '' }));
    const controller = new AbortController();
    try {
      await cancelFalJob({
        apiKey: apiKey.trim(),
        modelId: job.modelId,
        mediaType: job.mediaType,
        inputMode: job.inputMode,
        requestId: job.requestId,
      }, { signal: controller.signal });
      const current = useFalJobsStore.getState().jobs.find((candidate) => candidate.id === job.id);
      if (current && !isFalJobTerminal(current.state)) {
        upsertJob({ ...current, state: 'cancelled', updatedAt: Date.now() });
      }
    } catch (cancelFailure) {
      if (mountedRef.current) {
        const message = safeFailureText(cancelFailure, apiKey.trim(), cancellationError);
        setCancelErrors((current) => ({ ...current, [job.id]: message }));
      }
    } finally {
      cancellingRef.current.delete(job.id);
      if (mountedRef.current) setCancellingIds(new Set(cancellingRef.current));
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-3.5 sm:space-y-4">
      <section className="glass-card p-3.5 md:p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={() => { abortSubmission(); onBack(); }}
              className="btn-secondary shrink-0 px-3 py-2 text-sm"
            >
              ← Back
            </button>
            <div className="min-w-0">
              <p className="eyebrow mb-1 flex items-center gap-1.5 text-[var(--neon-cyan)]">
                <ProviderLogo provider="fal" size={13} /> fal.ai
              </p>
              <h2 className="display text-lg font-semibold sm:text-xl">
                {modeTitles[inputMode]}
              </h2>
            </div>
          </div>
          {/* One call to action per state: while the key is missing the callout
              below owns it, so the header keeps only the connected-state status
              button rather than repeating the same ask two rows apart. */}
          {!needsKey && (
            <button
              type="button"
              onClick={() => onOpenConnections('fal')}
              className="btn-secondary shrink-0 px-3 py-2 text-xs"
            >
              fal.ai key connected
            </button>
          )}
        </div>
      </section>

      <ConnectionGate
        storage={cloudWorkspace.cloud ? 'account' : 'browser'}
        provider="fal"
        label="fal.ai"
        needsKey={needsKey}
        hasFinishedWork={cloudWorkspace.cloud ? cloudWorkspace.hasJobs : jobs.length > 0}
        onConnect={() => onOpenConnections('fal')}
      >
      <GenerationWorkspaceLayout
        setup={
          <>
          <section className="glass-card space-y-3 p-3.5 md:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="display text-base font-semibold">Model</h3>
              </div>
              <div className="flex w-44 max-w-[52%] items-center gap-2">
                <Search aria-hidden="true" size={14} className="shrink-0 text-[var(--foreground-subtle)]" />
                <input
                  type="search"
                  aria-label="Search fal video models"
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder="Find a model"
                  className="min-w-0 flex-1 py-1.5 text-xs"
                />
              </div>
            </div>
            {/* The rate rides along in its own column, as the aggregator
                pickers' does. Without it this list named Veo 3.1 and Kling 3
                Pro and nothing else, and staying inside a budget meant leaving
                the app to look the numbers up. It is read for the variant this
                mode would actually submit to, since a model publishes one rate
                per endpoint. */}
            <ModelListbox
              label="Model"
              accent="video"
              columns={FAL_VIDEO_COLUMNS}
              rows={matchingModels.map((model) => ({
                id: model.id,
                label: model.label,
                cells: falVideoSpecs(model, inputMode),
              }))}
              value={matchingModels.some((model) => model.id === selectedModel.id) ? selectedModel.id : undefined}
              onChange={setModel}
            />
            {matchingModels.length === 0 ? (
              <p role="status" className="text-sm text-[var(--foreground-muted)]">No fal video models match your search.</p>
            ) : (
              <p className="text-sm text-[var(--foreground-muted)]">
                <span className="font-medium text-[var(--foreground)]">{selectedModel.label}:</span> {selectedModel.description}
              </p>
            )}
          </section>

          {inputMode !== 'text' && (
            <section className="glass-card space-y-3 p-3.5 md:p-4">
              <div>
                <h3 className="display text-base font-semibold">
                  {isFramesMode ? 'First and last frame' : 'Reference image'}
                </h3>
                <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                  {isFramesMode
                    ? `Two stills, in order: the frame the clip opens on and the one it lands on. ${selectedModel.label} generates the motion between them.`
                    : 'This video flow accepts exactly one image. Pick a saved clip instead and its last frame is used.'}
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple={isFramesMode}
                accept="image/png,image/jpeg,image/webp,image/avif,video/*"
                aria-label={isFramesMode ? 'Frame image file' : 'Reference image file'}
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
                    className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed py-3.5 text-sm transition-colors sm:flex-1 ${isDragging ? 'border-[var(--neon-cyan)] bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]' : 'border-[var(--neon-cyan)]/30 text-[var(--foreground-muted)]'}`}
                  >
                    {isReadingFrame || isFetching ? <Loader2 className="animate-spin" size={28} /> : <ImagePlus size={28} />}
                    {isReadingFrame
                      ? 'Reading last frame…'
                      : isFetching
                        ? 'Fetching dropped image…'
                        : isDragging
                          ? 'Drop to use as a source'
                          : pickerLabel}
                  </button>
                  {references.length < maxInputImages && (
                    <StoredImagePicker referenceLimit={maxInputImages} />
                  )}
                </div>
              )}
              <ReferenceStack
                layout="stack"
                replaceLimit={maxInputImages}
                items={references.map((reference, index) => ({
                  id: reference.id,
                  src: reference.previewUrl,
                  caption: isFramesMode ? frameSlotLabel(index) : undefined,
                  alt: isFramesMode ? frameSlotLabel(index) : `Reference ${index + 1}`,
                  removeLabel: isFramesMode
                    ? `Remove ${frameSlotLabel(index).toLowerCase()}`
                    : `Remove reference ${index + 1}`,
                  sourceLabel: reference.sourceLabel,
                }))}
                onRemove={removeReference}
              />
              {isFramesMode && references.length === 2 && (
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

          <section className="glass-card space-y-3 p-3.5 md:p-4">
            <div>
              <h3 className="display text-base font-semibold">Model controls</h3>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">Only controls supported by {selectedModel.label} are shown.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ModelControls
                namespace={`fal-${variant.id}`}
                fields={variant.fields as FalFieldDefinition[]}
                values={values}
                onChange={updateValue}
              />
            </div>
          </section>
          </>
        }
        prompt={
          <PromptPanel paused={gated} hasPrompt={prompt.trim().length > 0}>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="fal-video-prompt" className="display block text-base font-semibold">Prompt</label>
              <div className="flex items-center gap-1.5">
                <SavedPromptsButton />
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
            </div>
            <AutoExpandingPrompt
              id="fal-video-prompt"
              aria-required="true"
              required
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the motion, camera, mood, and scene…"
            />
          </PromptPanel>
        }
        actions={
          <>
            <button
              type="button"
              disabled={isSubmitting || cloudWorkspace.checking}
              onClick={() => {
                // A deliberate press is a fresh start: it drops any queued attempt
                // and hands back the full retry budget.
                autoRetry.reset();
                void submit();
              }}
              className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-base disabled:cursor-not-allowed disabled:opacity-50">
              {isSubmitting ? <><Loader2 className="animate-spin" size={21} /> Uploading & starting…</> : <><Sparkles size={21} /> Generate video<FalRunCost modelId={selectedModel.id} mediaType="video" inputMode={inputMode} resolution={values.resolution} audio={values.generate_audio} duration={values.duration} /></>}
            </button>
            <CloudExecutionNotice workspace={cloudWorkspace} />
            {error && (
              <SubmissionError message={error} retry={autoRetry.pending} onCancelRetry={autoRetry.cancel} />
            )}
          </>
        }
        results={cloudWorkspace.cloud ? <CloudJobPanel provider="fal" modelId={selectedModel.id} mediaType="video" inputMode={inputMode} onContinueFromFrame={onContinueFromFrame} /> :
          <section className="glass-card min-h-[420px] space-y-3 p-3.5 md:p-4">
            <div>
              <h3 className="display text-base font-semibold">Jobs</h3>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">Recent jobs remain visible while you change models and providers.</p>
            </div>
            {videoJobs.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] p-5 text-center text-[var(--foreground-muted)]">
                <Video className="mx-auto mb-3 opacity-35" size={46} />
                <p>Your jobs will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {videoJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    apiKey={apiKey}
                    cancelling={cancellingIds.has(job.id)}
                    cancelError={cancelErrors[job.id]}
                    onCancel={(activeJob) => void cancel(activeJob)}
                    onContinueFromFrame={onContinueFromFrame}
                  />
                ))}
              </div>
            )}
            <p className="text-center text-xs text-[var(--foreground-subtle)]">Inputs and outputs use public, temporary URLs.</p>
          </section>
        }
      />
      </ConnectionGate>
    </div>
  );
}

export default function FalGenerationWorkspace(props: FalGenerationWorkspaceProps) {
  return <FalGenerationWorkspaceSession key={props.inputMode} {...props} />;
}
