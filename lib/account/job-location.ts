import type { EngineId } from '@/lib/engines/registry';
import { isProviderId } from '@/lib/providers';
import { useAppStore, type VideoEngineId } from '@/store/useAppStore';
import type { CloudAsset, CloudJobRequest, CloudJobView } from './contracts';

/**
 * Where a background job is looked at, which depends on whether it is still
 * running.
 *
 * A job has two lives and two homes. While it runs, the only place its progress
 * and its result will appear is the studio form it was started from — the
 * `CloudJobPanel` that filters on this exact provider / model / media / input
 * mode. Once it is saved, the run is over and the answer is the asset itself,
 * in the cloud library.
 */

/** The deep link that makes `/account` open its library on one asset. `#jobs`
 *  is the same trick for the job list; both are read by `AccountConsole`. */
export function libraryHashForAsset(assetId: string) {
  return `/account#asset-${assetId}`;
}

/** The asset a finished job produced, if the account store has it loaded.
 *  `jobId` is the only join between the two — the asset's own metadata is a
 *  copy of the request, which several jobs can share. */
export function assetForJob(job: Pick<CloudJobView, 'id'>, assets: CloudAsset[]) {
  return assets.find(asset => asset.jobId === job.id) ?? null;
}

/** Engines with an image workspace. `local-test` is a real `CloudProvider` that
 *  reaches the browser in local development and has no form at all, so the
 *  narrowing is a guard, not a formality. */
const IMAGE_ENGINES: readonly EngineId[] = ['gemini', 'pollinations', 'cloudflare', 'kie', 'fal', 'runware', 'atlas', 'comet', 'piapi'];
const VIDEO_ENGINES: readonly VideoEngineId[] = ['gemini', 'kie', 'fal', 'runware', 'atlas', 'comet', 'piapi'];

export interface StudioLocation {
  /** Workspace and mode only. */
  href: string;
  /**
   * The rest of the address. Engine and model live in `useAppStore`, not in the
   * URL, and `CloudJobPanel` filters on both — so a link that only set `href`
   * would land on whichever engine was selected last and show an empty rail
   * with no explanation of why. Call it on the click, before navigating.
   */
  select: () => void;
}

/** The studio form that owns this job's spinner, or `null` when no workspace
 *  can show it. */
export function studioLocationForJob(request: CloudJobRequest): StudioLocation | null {
  const { provider, modelId, mediaType, inputMode } = request;
  if (mediaType === 'video') {
    if (!VIDEO_ENGINES.includes(provider as VideoEngineId)) return null;
    const engine = provider as VideoEngineId;
    // `text` is the absence of the param, matching how Studio writes it back —
    // otherwise Back would step through two URLs for one view.
    const href = `/?workspace=video${inputMode === 'text' ? '' : `&videoMode=${inputMode}`}`;
    return {
      href,
      select: () => {
        const store = useAppStore.getState();
        store.setVideoEngine(engine);
        if (engine === 'gemini') store.setGeminiVideoModel(modelId);
        else if (engine === 'kie') store.setKieVideoModel(modelId);
        else if (engine === 'fal') store.setFalVideoModel(modelId);
        else if (isProviderId(engine)) store.setProviderModel(engine, 'video', modelId);
      },
    };
  }
  if (!IMAGE_ENGINES.includes(provider as EngineId)) return null;
  const engine = provider as EngineId;
  /**
   * `inputMode` is what survives of the feature: every image workspace collapses
   * its six features to `requiresImage ? 'image' : 'text'` before submitting. So
   * the link cannot reopen the exact card that was clicked — but it does not
   * need to, because `CloudJobPanel` filters on `inputMode` too, which means
   * every feature sharing one mode shows the same job and the same result.
   */
  const href = `/?feature=${inputMode === 'text' ? 'text-to-image' : 'image-editing'}`;
  return {
    href,
    select: () => {
      const store = useAppStore.getState();
      store.setEngine(engine);
      // fal, Cloudflare and Pollinations each run one fixed image model, so
      // there is no choice to restore.
      if (engine === 'gemini') store.setGeminiImageModel(modelId);
      else if (engine === 'kie') store.setKieImageModel(modelId);
      else if (isProviderId(engine)) store.setProviderModel(engine, 'image', modelId);
    },
  };
}
