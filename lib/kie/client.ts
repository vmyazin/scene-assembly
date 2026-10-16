// lib/kie/client.ts
import { buildKieInput } from './catalog';
import type { EditReferenceInput } from '../providers/edit-references';
import type { KieModelVariant, KieProtocol, KieTask } from './types';

export const KIE_API = 'https://api.kie.ai';

interface KieEnvelope {
  code?: number;
  msg?: string;
  data?: unknown;
}

export class KieApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'KieApiError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function messageForStatus(status: number, fallback: string): string {
  if (status === 401) return 'Your Kie API key is invalid or has expired.';
  if (status === 402) return 'Your Kie account has insufficient credits.';
  if (status === 429) return 'Kie is rate limiting requests. Please wait and try again.';
  if (status >= 500) return 'Kie is temporarily unavailable. Please try again.';
  const normalized = fallback.toLowerCase();
  if (normalized.includes('api key') || normalized.includes('token')) {
    return 'Your Kie API key is invalid or has expired.';
  }
  if (normalized.includes('credit') || normalized.includes('balance') || normalized.includes('insufficient')) {
    return 'Your Kie account has insufficient credits.';
  }
  if (normalized.includes('content') || normalized.includes('policy') || normalized.includes('safety')) {
    return 'Kie rejected this prompt or reference image under its content policy. Adjust the request and try again.';
  }
  if (normalized.includes('validation') || normalized.includes('parameter') || normalized.includes('invalid input')) {
    return 'Kie rejected one or more model settings. Review the selected controls and try again.';
  }
  return fallback;
}

async function kieFetch(url: string, init: RequestInit): Promise<KieEnvelope> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as KieEnvelope;

  if (!response.ok || (payload.code !== undefined && payload.code !== 200)) {
    const status = response.ok && typeof payload.code === 'number' ? payload.code : response.status;
    throw new KieApiError(messageForStatus(status, payload.msg || 'Kie rejected the request.'), status);
  }

  return payload;
}

function parseResultUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      return parseResultUrls(JSON.parse(value));
    } catch {
      return value.startsWith('http') ? [value] : [];
    }
  }
  const record = asRecord(value);
  const urls = record.resultUrls ?? record.result_urls ?? record.urls ?? record.url ?? record.videoUrl;
  if (typeof urls === 'string') return [urls];
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === 'string') : [];
}

function normalizeProgress(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed > 1 ? parsed / 100 : parsed;
}

function marketTask(data: Record<string, unknown>, taskId: string): KieTask {
  const state = data.state;
  const normalizedState =
    state === 'success' || state === 'fail' || state === 'waiting' || state === 'queuing' || state === 'generating'
      ? state
      : 'generating';

  return {
    taskId: typeof data.taskId === 'string' ? data.taskId : taskId,
    state: normalizedState,
    progress: normalizeProgress(data.progress),
    resultUrls: parseResultUrls(data.resultJson),
    error: typeof data.failMsg === 'string' ? data.failMsg : undefined,
  };
}

function veoTask(data: Record<string, unknown>, taskId: string): KieTask {
  const flag = Number(data.successFlag);
  const response = asRecord(data.response);
  const state = flag === 1 ? 'success' : flag === 2 ? 'fail' : 'generating';

  return {
    taskId,
    state,
    progress: normalizeProgress(data.progress),
    resultUrls: parseResultUrls(response),
    error: typeof data.errorMessage === 'string' ? data.errorMessage : undefined,
  };
}

function veoPayload(input: Record<string, string | number | boolean | string[]>): Record<string, unknown> {
  return input;
}

export async function createKieTask(args: {
  apiKey: string;
  variant: KieModelVariant;
  prompt: string;
  uploadUrls: string[];
  values: Record<string, string | number | boolean | undefined>;
  references?: EditReferenceInput;
}): Promise<{ taskId: string; protocol: KieProtocol }> {
  const input = buildKieInput(args.variant, {
    prompt: args.prompt,
    uploadUrls: args.uploadUrls,
    values: args.values,
    references: args.references,
  });
  const endpoint = args.variant.protocol === 'market' ? `${KIE_API}/api/v1/jobs/createTask` : `${KIE_API}/api/v1/veo/generate`;
  const body =
    args.variant.protocol === 'market'
      ? { model: args.variant.modelId, input }
      : { model: args.variant.modelId, ...veoPayload(input) };
  const payload = await kieFetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = asRecord(payload.data);
  const taskId = data.taskId;

  if (typeof taskId !== 'string' || !taskId) {
    throw new KieApiError('Kie accepted the request but did not return a task ID.', 502);
  }

  return { taskId, protocol: args.variant.protocol };
}

export async function getKieTask(args: {
  apiKey: string;
  protocol: KieProtocol;
  taskId: string;
}): Promise<KieTask> {
  const endpoint =
    args.protocol === 'market'
      ? `${KIE_API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(args.taskId)}`
      : `${KIE_API}/api/v1/veo/record-info?taskId=${encodeURIComponent(args.taskId)}`;
  const payload = await kieFetch(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${args.apiKey}` },
  });
  const data = asRecord(payload.data);
  return args.protocol === 'market' ? marketTask(data, args.taskId) : veoTask(data, args.taskId);
}

