import type { ClipOrigin } from '../youtube/clip';
// lib/account/contracts.ts
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
  /** Reference videos, uploaded separately from images. Omitted when the model has none. */
  referenceVideoIds?: string[];
  /** Reference audio clips. Omitted when the model has none. */
  referenceAudioIds?: string[];
}
export type CloudJobState = 'queued' | 'submitting' | 'running' | 'saving' | 'saved' | 'needs_attention' | 'failed' | 'cancelled';
/** The agent that started a job, kept after it disconnects so old work stays attributed. */
export interface StartedBy { agentId: string; name: string | null }
export interface JobResultRecovery {
  links: { url: string; hostname: string }[];
  providerTaskId: string | null;
}
export interface CloudJobView {
  /** Current Worker capture policy accepts a previously blocked result. */
  canRetrySave?: boolean;
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
  /** Sanitized provider refusal or app-authored capture error. Older save
   *  failures have no detail; never reconstruct evidence that was not retained. */
  failureDetail?: string | null;
  /** Resumes so far. The row says "attempt 2" with it, and stops offering a
   *  button the Worker would now refuse. */
  attempts?: number;
  /** Absent for jobs started in the browser, and from Workers that predate agents. */
  startedBy?: StartedBy;
  request: CloudJobRequest; createdAt: number; updatedAt: number;
  /** Set when the provider returned a Seedance draft id. Finalize sends it back. */
  draftId?: string;
}
export interface CloudAssetCounts {
  /** Account-wide, never page-scoped: the pills must keep saying how much sits
   *  behind each filter while you are inside a filtered, paged view. */
  all: number; image: number; video: number; temporary: number;
}
export interface CloudAsset {
  id: string; kind: 'image' | 'video'; mimeType: string; bytes: number; createdAt: number;
  metadata: CloudJobRequest; jobId: string | null;
  /** Lifted out of stored metadata so `metadata` stays a job request. */
  draftId?: string;
  /** A YouTube section saved at import; lifted out of stored metadata like `draftId`. */
  origin?: ClipOrigin;
  /** Present only for overflow awaiting space in the permanent library. */
  expiresAt?: number;
  /** Absent for jobs started in the browser, and from Workers that predate agents. */
  startedBy?: StartedBy;
}

/** Every temporary input must share the same ownership and retention lifecycle. */
export function jobInputIds(request: Pick<CloudJobRequest, 'referenceIds' | 'sourceVideoId' | 'referenceVideoIds' | 'referenceAudioIds'>): string[] {
  return [...request.referenceIds, ...(request.referenceVideoIds ?? []), ...(request.referenceAudioIds ?? []), ...(request.sourceVideoId ? [request.sourceVideoId] : [])];
}

/** One connected MCP client, as the account page's panel shows it. */
export interface ConnectedAgent { id: string; name: string; connectedAt: number; lastUsedAt: number | null; budgetUsd: number; usedUsd: number; allowUnknownCost: boolean; allowDelete: boolean }

/** A pending agent connection, as the consent page shows it. */
export interface AgentAuthorizationView {
  id: string; clientName: string; clientDomain: string | null; redirectHost: string; redirectIsLoopback: boolean; expiresAt: number;
  unknownPriceProviders: { label: string; scope: 'all' | 'some' }[];
  defaults: { budgetUsd: number; allowUnknownCost: boolean; allowDelete: boolean };
  limits: { minUsd: number; maxUsd: number };
}
