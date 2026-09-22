/** Serializable contract shared by browser and Worker; never contains provider keys. */
export type CloudProvider = 'gemini' | 'fal' | 'kie' | 'runware' | 'atlas' | 'comet' | 'piapi' | 'cloudflare' | 'pollinations' | 'local-test';
export interface CloudJobRequest {
  provider: CloudProvider;
  modelId: string;
  mediaType: 'image' | 'video';
  inputMode: 'text' | 'image' | 'frames' | 'reference' | 'edit';
  prompt: string;
  values: Record<string, string | number | boolean>;
  referenceIds: string[];
  sourceVideoId?: string;
}
export type CloudJobState = 'queued' | 'submitting' | 'running' | 'saving' | 'saved' | 'needs_attention' | 'failed' | 'cancelled';
export interface CloudJobView {
  id: string; provider: CloudProvider; state: CloudJobState; errorCode: string | null;
  /** All three are optional because the browser and the Worker deploy
   *  separately and can sit at different commits: a Worker from before this
   *  field existed simply omits it, and the row falls back to the old generic
   *  copy rather than rendering `undefined`.
   *
   *  Why it stopped, from the shared vocabulary in `lib/account/job-failure.ts`.
   *  `errorCode` names the arm of the runner that gave up, which is not what a
   *  reader needs: one `save_failed` covers an expired provider link, an
   *  oversized clip and a transient blip, and only one of those is worth
   *  resuming. Null on jobs that stopped before the Worker recorded it. */
  failureReason?: string | null;
  /** The provider's own sentence for a refusal, already sanitized Worker-side.
   *  Only ever set alongside `provider_rejected`. */
  failureDetail?: string | null;
  /** Resumes so far. The row says "attempt 2" with it, and stops offering a
   *  button the Worker would now refuse. */
  attempts?: number;
  request: CloudJobRequest; createdAt: number; updatedAt: number;
}
export interface CloudAssetCounts {
  /** Account-wide, never page-scoped: the pills must keep saying how much sits
   *  behind each filter while you are inside a filtered, paged view. */
  all: number; image: number; video: number; temporary: number;
}
export interface CloudAsset {
  id: string; kind: 'image' | 'video'; mimeType: string; bytes: number; createdAt: number;
  metadata: CloudJobRequest; jobId: string | null;
  /** Present only for overflow awaiting space in the permanent library. */
  expiresAt?: number;
}

/** Every temporary input must share the same ownership and retention lifecycle. */
export function jobInputIds(request: Pick<CloudJobRequest, 'referenceIds' | 'sourceVideoId'>): string[] {
  return [...request.referenceIds, ...(request.sourceVideoId ? [request.sourceVideoId] : [])];
}
