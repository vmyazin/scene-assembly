// lib/fal/server.ts
import { createFalClient } from '@fal-ai/client';

import type { EditReferenceInput } from '../providers/edit-references';
import { buildFalInput, extractFalResult, resolveFalVariant } from './catalog';
import { falUnitQuantity } from './pricing';
import type { FalInputMode, FalMediaType, FalTask, FalValue } from './types';

const FAL_PRICING_URL =
  'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fnano-banana-2';
const FAL_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_PUBLIC_FAL_ERROR_LENGTH = 480;
const MAX_PROVIDER_DETAIL_LENGTH = 320;
const MAX_PROVIDER_DETAILS = 3;

export class FalApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

function publicMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'Your fal API key is invalid, revoked, or lacks access to this model.';
  }
  if (status === 402) return 'Your fal account needs additional credits.';
  if (status === 422) {
    return 'fal rejected one or more model settings. Review the controls and try again.';
  }
  if (status === 429) return 'fal is rate limiting requests. Please wait and try again.';
  if (status >= 500) return 'fal is temporarily unavailable. Please try again.';
  return 'fal could not complete that request.';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function errorStatus(error: unknown, fallbackStatus: number): number {
  const status = asRecord(error).status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : fallbackStatus;
}

function safeProviderRequestId(error: unknown): string | undefined {
  const requestId = asRecord(error).requestId;
  return typeof requestId === 'string' && FAL_REQUEST_ID_PATTERN.test(requestId)
    ? requestId
    : undefined;
}

function providerDetailMessages(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (typeof record.msg !== 'string' || !record.msg.trim()) return [];
    const location = Array.isArray(record.loc)
      ? record.loc
          .flatMap((part) =>
            typeof part === 'string' || typeof part === 'number' ? [String(part)] : []
          )
          .filter((part) => part !== 'body')
          .join('.')
      : '';
    return [location ? `${location}: ${record.msg}` : record.msg];
  });
}

function safeProviderDetail(error: unknown, apiKey: string): string | undefined {
  const body = asRecord(asRecord(error).body);
  const details = providerDetailMessages(body.detail);
  const nestedError = asRecord(body.error);
  const rawDetail = details.length > 0
    ? details.slice(0, MAX_PROVIDER_DETAILS).join('; ')
    : [body.message, body.error, nestedError.message].find(
        (value): value is string => typeof value === 'string' && Boolean(value.trim())
      );
  if (!rawDetail) return undefined;

  const normalized = rawDetail
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;

  let encodedKey = '';
  try {
    encodedKey = encodeURIComponent(apiKey);
  } catch {
    encodedKey = '';
  }
  const jsonKey = apiKey ? JSON.stringify(apiKey) : '';
  const credentialVariants = [apiKey, encodedKey, jsonKey, jsonKey.slice(1, -1)].filter(Boolean);
  const lowerDetail = normalized.toLowerCase();
  if (credentialVariants.some((variant) => lowerDetail.includes(variant.toLowerCase()))) {
    return undefined;
  }

  return normalized.length > MAX_PROVIDER_DETAIL_LENGTH
    ? `${normalized.slice(0, MAX_PROVIDER_DETAIL_LENGTH - 1).trimEnd()}…`
    : normalized;
}

function safeError(status: number): FalApiError {
  return new FalApiError(publicMessage(status), status);
}

function safeProviderError(error: unknown, apiKey: string, fallbackStatus: number): FalApiError {
  const status = errorStatus(error, fallbackStatus);
  const detail = safeProviderDetail(error, apiKey);
  const requestId = safeProviderRequestId(error);
  if (!detail && !requestId) return safeError(status);

  const context = [`HTTP ${status}`, ...(requestId ? [`request ${requestId}`] : [])].join(', ');
  const suffix = detail ? `: ${detail}` : '.';
  const message = `${publicMessage(status)} fal response (${context})${suffix}`;
  const boundedMessage = message.length > MAX_PUBLIC_FAL_ERROR_LENGTH
    ? `${message.slice(0, MAX_PUBLIC_FAL_ERROR_LENGTH - 1).trimEnd()}…`
    : message;
  return new FalApiError(boundedMessage, status);
}

async function withSafeFalErrors<T>(
  operation: () => Promise<T>,
  apiKey: string,
  fallbackStatus = 502
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FalApiError) throw error;
    throw safeProviderError(error, apiKey, fallbackStatus);
  }
}

function requireRequestId(value: unknown, status: number): string {
  if (typeof value !== 'string' || !FAL_REQUEST_ID_PATTERN.test(value)) throw safeError(status);
  return value;
}

function singleAttemptFetch(): typeof fetch {
  const transport = globalThis.fetch.bind(globalThis);
  let outcome: Promise<Response> | undefined;

  return async (input, init) => {
    // queue.submit retries independently of client retry settings. Replaying a clone lets the
    // SDK preserve its response handling without issuing a second billable network request.
    outcome ??= Promise.resolve().then(() => transport(input, init));
    const response = await outcome;
    return response.clone();
  };
}

function rawResultUrl(mediaType: FalMediaType, payload: unknown): unknown {
  const record = asRecord(payload);
  if (mediaType === 'video') return asRecord(record.video).url;
  const image = Array.isArray(record.images) ? record.images[0] : undefined;
  return asRecord(image).url;
}

function requireSafeResultUrl(value: unknown): string {
  if (typeof value !== 'string' || /\s/.test(value)) throw safeError(502);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw safeError(502);
  }
  const isFalCdn = url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media');
  if (url.protocol !== 'https:' || url.username || url.password || !isFalCdn) {
    throw safeError(502);
  }

  return value;
}

function normalizedLogs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const message = asRecord(entry).message;
    return typeof message === 'string' && message.trim() ? [message] : [];
  });
}

export async function validateFalApiKey(apiKey: string): Promise<void> {
  await withSafeFalErrors(async () => {
    const response = await fetch(FAL_PRICING_URL, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    if (!response.ok) throw safeError(response.status);
  }, apiKey);
}

const FAL_PRICING_API = 'https://api.fal.ai/v1/models/pricing';
const FAL_ESTIMATE_API = 'https://api.fal.ai/v1/models/pricing/estimate';

export interface FalCostEstimate {
  costUsd: number | null;
  unit?: string;
  quantity?: number;
}

/** Unit prices do not change within a process lifetime, so one lookup per endpoint. */
const falUnitPrices = new Map<string, { unit: string; unitPrice: number }>();

async function falUnitPrice(
  apiKey: string,
  endpointId: string
): Promise<{ unit: string; unitPrice: number } | null> {
  const cached = falUnitPrices.get(endpointId);
  if (cached) return cached;
  try {
    const response = await fetch(`${FAL_PRICING_API}?endpoint_id=${encodeURIComponent(endpointId)}`, {
      headers: { Authorization: `Key ${apiKey}` },
    });
    if (!response.ok) return null;
    const payload = asRecord(await response.json());
    const first = asRecord((Array.isArray(payload.prices) ? payload.prices : [])[0]);
    if (typeof first.unit !== 'string' || typeof first.unit_price !== 'number') return null;
    const price = { unit: first.unit, unitPrice: first.unit_price };
    falUnitPrices.set(endpointId, price);
    return price;
  } catch {
    return null;
  }
}

async function falEstimateTotal(apiKey: string, endpointId: string, quantity: number): Promise<number | null> {
  try {
    const response = await fetch(FAL_ESTIMATE_API, {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimate_type: 'unit_price',
        endpoints: { [endpointId]: { unit_quantity: quantity } },
      }),
    });
    if (!response.ok) return null;
    const payload = asRecord(await response.json());
    return typeof payload.total_cost === 'number' && Number.isFinite(payload.total_cost)
      ? payload.total_cost
      : null;
  } catch {
    return null;
  }
}

/**
 * What one run of an endpoint costs. Never throws: a spend figure is a readout,
 * and the generation it describes has already succeeded. Prefers fal's own
 * estimate (it applies account discounts), and multiplies the unit price itself
 * when that call fails.
 */
export async function estimateFalCost(args: {
  apiKey: string;
  endpointId: string;
  durationSeconds?: number;
}): Promise<FalCostEstimate> {
  const price = await falUnitPrice(args.apiKey, args.endpointId);
  if (!price) return { costUsd: null };
  const quantity = falUnitQuantity(price.unit, args.durationSeconds);
  if (quantity === null) return { costUsd: null, unit: price.unit };
  const total = await falEstimateTotal(args.apiKey, args.endpointId, quantity);
  return { costUsd: total ?? price.unitPrice * quantity, unit: price.unit, quantity };
}

export async function uploadFalFile(args: { apiKey: string; file: File }): Promise<string> {
  return withSafeFalErrors(async () => {
    const client = createFalClient({ credentials: args.apiKey });
    const url = await client.storage.upload(args.file, { lifecycle: { expiresIn: '1d' } });
    if (typeof url !== 'string' || !url.trim()) throw safeError(502);
    return url;
  }, args.apiKey);
}

export async function submitFalTask(args: {
  apiKey: string;
  modelId: string;
  mediaType: FalMediaType;
  inputMode: FalInputMode;
  prompt: string;
  uploadUrls: string[];
  values: Record<string, FalValue>;
  references?: EditReferenceInput;
}): Promise<{ requestId: string }> {
  return withSafeFalErrors(async () => {
    const variant = resolveFalVariant(args.modelId, args.mediaType, args.inputMode);
    const input = buildFalInput(variant, {
      prompt: args.prompt,
      uploadUrls: args.uploadUrls,
      values: args.values,
      references: args.references,
    });

    return withSafeFalErrors(async () => {
      const client = createFalClient({
        credentials: args.apiKey,
        fetch: singleAttemptFetch(),
      });
      const response = await client.queue.submit(variant.endpointId, {
        input,
        headers: { 'X-Fal-Store-IO': '0' },
        storageSettings: { expiresIn: '7d' },
      });
      const record = asRecord(response);
      const requestId = requireRequestId(record.request_id ?? record.requestId, 502);
      return { requestId };
    }, args.apiKey);
  }, args.apiKey, 400);
}

export async function getFalTask(args: {
  apiKey: string;
  modelId: string;
  mediaType: FalMediaType;
  inputMode: FalInputMode;
  requestId: string;
}): Promise<FalTask> {
  return withSafeFalErrors(async () => {
    const requestId = requireRequestId(args.requestId, 400);
    const variant = resolveFalVariant(args.modelId, args.mediaType, args.inputMode);

    return withSafeFalErrors(async () => {
      const client = createFalClient({ credentials: args.apiKey });
      const response = await client.queue.status(variant.endpointId, {
        requestId,
        logs: true,
      });
      const record = asRecord(response);
      const responseRequestId = requireRequestId(record.request_id, 502);
      if (responseRequestId !== requestId) throw safeError(502);
      const logs = normalizedLogs(record.logs);

      if (record.status === 'IN_QUEUE') return { requestId, state: 'queued', logs };
      if (record.status === 'IN_PROGRESS') return { requestId, state: 'running', logs };
      if (record.status !== 'COMPLETED') throw safeError(502);

      const result = await client.queue.result(variant.endpointId, { requestId });
      const resultRecord = asRecord(result);
      const resultRequestId = requireRequestId(resultRecord.requestId, 502);
      if (resultRequestId !== requestId) throw safeError(502);
      const media = extractFalResult(args.mediaType, resultRecord.data);
      const resultUrl = requireSafeResultUrl(rawResultUrl(args.mediaType, resultRecord.data));
      if (resultUrl !== media.url) throw safeError(502);

      return {
        requestId,
        state: 'success',
        logs,
        resultUrl,
        ...(media.mimeType ? { mimeType: media.mimeType } : {}),
      };
    }, args.apiKey);
  }, args.apiKey, 400);
}

export async function cancelFalTask(args: {
  apiKey: string;
  modelId: string;
  mediaType: FalMediaType;
  inputMode: FalInputMode;
  requestId: string;
}): Promise<void> {
  await withSafeFalErrors(async () => {
    const requestId = requireRequestId(args.requestId, 400);
    const variant = resolveFalVariant(args.modelId, args.mediaType, args.inputMode);

    await withSafeFalErrors(async () => {
      const client = createFalClient({ credentials: args.apiKey });
      await client.queue.cancel(variant.endpointId, { requestId });
    }, args.apiKey);
  }, args.apiKey, 400);
}
