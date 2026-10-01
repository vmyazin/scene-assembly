import type { CloudAsset, CloudJobRequest, CloudProvider } from './contracts';
import type { GalleryRecord } from '@/lib/gallery/storage';
import { LOCAL_PROVIDER } from '@/lib/timeline/import-local';
import { useAccountStore } from '@/store/useAccountStore';

export const MAX_ACCOUNT_IMPORT_BYTES = 1_000_000_000;

const supportedTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
]);
const cloudProviders = new Set<CloudProvider>([
  'gemini', 'fal', 'kie', 'runware', 'atlas', 'comet', 'piapi', 'cloudflare', 'pollinations',
]);

export type AccountImportState =
  | 'pending'
  | 'uploading'
  | 'completed'
  | 'cancelled'
  | 'expired';

export interface AccountImportView {
  id: string;
  state: AccountImportState;
  assetId: string | null;
  expiresAt: number;
  url?: string;
  uploadExpiresAt?: number;
}

export interface AccountImportIntent {
  clientImportId: string;
  bytes: number;
  mimeType: string;
  metadata: CloudJobRequest;
}

export class AccountAssetImportError extends Error {
  constructor(public readonly reason: 'account_changed' | 'terminal' | 'request_failed') {
    super(
      reason === 'account_changed'
        ? 'Your account changed. Try again from the current account.'
        : reason === 'terminal'
          ? 'This import can no longer resume. Start a new import attempt to add it.'
          : 'Could not import this file. Please try again.'
    );
  }
}

const ATTEMPT_STORAGE_KEY = 'account-asset-import-attempts.v1';
const MAX_OWNER_ATTEMPTS = 500;
const memoryAttempts = new Map<string, string>();

function attemptKey(ownerId: string, recordId: string) {
  return `${ownerId}\u0000${recordId}`;
}

/** The source Blob is authoritative: import never re-encodes or follows a provider URL. */
export function isImportableGalleryRecord(record: GalleryRecord): record is GalleryRecord & { blob: Blob } {
  if (!record.blob || record.blob.size <= 0 || record.blob.size > MAX_ACCOUNT_IMPORT_BYTES) return false;
  if (!supportedTypes.has(record.blob.type)) return false;
  return record.kind === (record.blob.type.startsWith('image/') ? 'image' : 'video');
}

function stableRecordHash(value: string): string {
  // Four independent 32-bit lanes keep the ID compact, URL-safe and stable without an async digest.
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = 0xdeadbeef;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
    c = Math.imul(c ^ code, 2246822507);
    d = Math.imul(d ^ code, 3266489909);
  }
  return [a, b, c, d].map(part => (part >>> 0).toString(36).padStart(7, '0')).join('');
}

export function defaultAccountImportId(recordId: string) {
  return `browser_${stableRecordHash(recordId)}`;
}

type StoredAttempts = Record<string, Record<string, string>>;

function storedAttempts(): StoredAttempts | null {
  try {
    const value = localStorage.getItem(ATTEMPT_STORAGE_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as StoredAttempts : {};
  } catch {
    return null;
  }
}

/** Resolve the explicit attempt override, falling back to the immutable record-derived ID. */
export function accountImportClientId(ownerId: string, recordId: string) {
  const key = attemptKey(ownerId, recordId);
  const remembered = memoryAttempts.get(key);
  if (remembered) return remembered;
  const ownerAttempts = storedAttempts()?.[ownerId];
  const stored = ownerAttempts && typeof ownerAttempts === 'object' && !Array.isArray(ownerAttempts)
    ? ownerAttempts[recordId]
    : undefined;
  if (typeof stored === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(stored)) {
    memoryAttempts.set(key, stored);
    return stored;
  }
  return defaultAccountImportId(recordId);
}

/** Called only from the terminal-intent action; ordinary retry paths never mint IDs. */
export function startNewAccountImportAttempt(ownerId: string, recordId: string) {
  const clientImportId = `browser_retry_${crypto.randomUUID().replaceAll('-', '')}`;
  memoryAttempts.set(attemptKey(ownerId, recordId), clientImportId);
  const all = storedAttempts();
  if (!all) return { clientImportId, persisted: false };
  try {
    const existing = all[ownerId];
    const ownerAttempts = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...existing }
      : {};
    delete ownerAttempts[recordId];
    ownerAttempts[recordId] = clientImportId;
    const entries = Object.entries(ownerAttempts);
    all[ownerId] = Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_OWNER_ATTEMPTS)));
    localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(all));
    return { clientImportId, persisted: true };
  } catch {
    return { clientImportId, persisted: false };
  }
}

/** Test-only reset for the module-level fallback used when localStorage is blocked. */
export function resetAccountImportAttemptsForTests() {
  memoryAttempts.clear();
}

function normalizedInputMode(value: string | undefined): CloudJobRequest['inputMode'] {
  return value === 'image' || value === 'frames' || value === 'reference' ? value : 'text';
}

function normalizedValues(values: GalleryRecord['controlValues']): CloudJobRequest['values'] {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) =>
        typeof value === 'string' || typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)))
      .slice(0, 64)
  );
}

/**
 * A cloud asset that came off the person's disk rather than out of a generation:
 * a reference they pasted or dropped (`keepUploadedImages`) or a clip they
 * imported. `accountImportIntent` is what labels it — the library provider
 * `local` is not a cloud provider, so it lands as `local-test`, and with no
 * model of its own the model id falls back to `local`. A real `local-test`
 * background job names its model `local-test`, so it never matches.
 */
export function isUploadedAsset(asset: Pick<CloudAsset, 'metadata'>): boolean {
  return asset.metadata.provider === 'local-test' && asset.metadata.modelId === LOCAL_PROVIDER;
}

export function accountImportIntent(record: GalleryRecord & { blob: Blob }, clientImportId = defaultAccountImportId(record.id)): AccountImportIntent {
  const provider = cloudProviders.has(record.provider as CloudProvider)
    ? record.provider as CloudProvider
    : 'local-test';
  return {
    clientImportId,
    bytes: record.blob.size,
    mimeType: record.blob.type,
    metadata: {
      provider,
      modelId: record.modelId || record.provider,
      mediaType: record.kind,
      inputMode: normalizedInputMode(record.inputMode),
      prompt: record.prompt,
      values: normalizedValues(record.controlValues),
      referenceIds: [],
    },
  };
}

function assertIdentity(ownerId: string, epoch: number, signal: AbortSignal) {
  const account = useAccountStore.getState();
  if (signal.aborted || account.epoch !== epoch || account.session?.account?.id !== ownerId) {
    throw new AccountAssetImportError('account_changed');
  }
}

async function responseJson(response: Response, ownerId: string, epoch: number, signal: AbortSignal) {
  assertIdentity(ownerId, epoch, signal);
  const data = await response.json().catch(() => null) as AccountImportView | null;
  assertIdentity(ownerId, epoch, signal);
  return data;
}

/** Begin or resume one immutable import intent, then stream its original Blob to the capability URL. */
export async function importGalleryRecord(
  record: GalleryRecord & { blob: Blob },
  ownerId: string,
  epoch: number,
  signal: AbortSignal,
  clientImportId = defaultAccountImportId(record.id)
): Promise<AccountImportView> {
  const intent = accountImportIntent(record, clientImportId);
  assertIdentity(ownerId, epoch, signal);
  const begunResponse = await fetch('/api/account/imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Account-Id': ownerId },
    body: JSON.stringify(intent),
    signal,
    cache: 'no-store',
  });
  assertIdentity(ownerId, epoch, signal);
  const begun = await responseJson(begunResponse, ownerId, epoch, signal);
  if (!begunResponse.ok || !begun) {
    const code = begun && typeof begun === 'object' && 'code' in begun ? begun.code : undefined;
    throw new AccountAssetImportError(code === 'import_attempt_limit' ? 'terminal' : 'request_failed');
  }
  if (begun.state === 'completed') return begun;
  if (begun.state === 'cancelled' || begun.state === 'expired') {
    throw new AccountAssetImportError('terminal');
  }
  if (!begun.url) throw new AccountAssetImportError('request_failed');

  assertIdentity(ownerId, epoch, signal);
  const uploadResponse = await fetch(begun.url, {
    method: 'PUT',
    headers: { 'Content-Type': record.blob.type },
    body: record.blob,
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  assertIdentity(ownerId, epoch, signal);
  const uploaded = await responseJson(uploadResponse, ownerId, epoch, signal);
  if (!uploadResponse.ok || !uploaded || uploaded.state !== 'completed') {
    throw new AccountAssetImportError('request_failed');
  }
  return uploaded;
}
