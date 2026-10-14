import { downloadFilenameBase } from '@/lib/download-name';
import { requestPromptSlug } from '@/lib/micro-ai/browser';
import type { CloudAsset } from './contracts';

/**
 * Download names for account assets, through the same two modules the guest
 * workspaces use: an LLM slug from `/api/slug` and the model code from
 * `downloadFilenameBase`. The Worker keeps the job request as asset metadata,
 * so prompt, provider and model are already on every asset — only the slug
 * has to be fetched, and it is cached here per job (the accepted-job moment)
 * or per asset (a library download of something made earlier or elsewhere).
 *
 * No browser Gemini key is sent: the cloud path must not lean on browser keys,
 * and the route still answers from the shared tier or its regex fallback.
 */
const slugs = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(asset: Pick<CloudAsset, 'id' | 'jobId'>): string {
  return asset.jobId ? `job:${asset.jobId}` : `asset:${asset.id}`;
}

function fetchSlug(key: string, prompt: string): Promise<string | null> {
  const known = slugs.get(key);
  if (known) return Promise.resolve(known);
  let pending = inflight.get(key);
  if (!pending) {
    pending = requestPromptSlug(prompt, '')
      .then((slug) => {
        if (slug) slugs.set(key, slug);
        return slug;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/**
 * Fire-and-forget at the moment a job is accepted, matching the guest
 * `attachSlug`/`prerenderSlug` calls, so the first download does not wait.
 */
export function warmAccountSlug(jobId: string, prompt: string): void {
  if (!prompt.trim()) return;
  void fetchSlug(`job:${jobId}`, prompt);
}

/** The full guest-shaped base, requesting the slug when nothing is cached yet. */
export async function accountAssetFilenameBase(asset: CloudAsset): Promise<string> {
  if (asset.origin) return clipFilenameBase(asset.origin);
  const prompt = asset.metadata.prompt ?? '';
  const slug = prompt.trim() ? await fetchSlug(cacheKey(asset), prompt) : null;
  return baseFor(asset, slug ?? undefined);
}

/**
 * Synchronous variant for props that need a string during render
 * (`LastFrameActions`): the cached slug when there is one, otherwise the
 * deterministic prompt slug with the model code — never an asset id.
 */
export function knownAccountAssetFilenameBase(asset: CloudAsset): string {
  return baseFor(asset, slugs.get(cacheKey(asset)));
}

/** A saved YouTube section is named after where it came from, as the browser names it at import. */
function clipFilenameBase(origin: NonNullable<CloudAsset['origin']>): string {
  return `youtube-${origin.videoId}-${Math.floor(origin.startSeconds)}s`;
}

function baseFor(asset: CloudAsset, slug: string | undefined): string {
  if (asset.origin) return clipFilenameBase(asset.origin);
  return downloadFilenameBase({
    prompt: asset.metadata.prompt ?? '',
    mediaType: asset.kind,
    slug,
    provider: asset.metadata.provider,
    modelId: asset.metadata.modelId,
  });
}

/** Test seam: forget every cached slug. */
export function resetAccountSlugs(): void {
  slugs.clear();
  inflight.clear();
}
