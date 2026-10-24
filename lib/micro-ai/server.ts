// lib/micro-ai/server.ts
import { MICRO_AI_MODELS, readModelUsage, readUsage, VISION_MODEL, type MicroAiUsage } from '@/lib/micro-ai/models';
import type { MicroAiTask } from '@/lib/micro-ai/tasks';
import { clientAddress, createRateLimiter } from '@/lib/server/rate-limit';

/**
 * Server-only client for the OpenAI-compatible Hugging Face router.
 *
 * The token is an app-owned server secret and never reaches the browser, nor do
 * provider error bodies: every failure collapses to `null` so callers fall back
 * to Gemini or a deterministic result instead of surfacing upstream detail.
 */
const DEFAULT_BASE_URL = 'https://router.huggingface.co/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 8_000;
/** Micro-tasks summarize short prompts; anything longer is truncated, not billed. */
const MAX_USER_CHARS = 2_000;

export function microAiToken(): string {
  return process.env.HF_TOKEN?.trim() ?? '';
}

/** True when the deployment has an app-owned token configured. */
export function isMicroAiConfigured(): boolean {
  return microAiToken().length > 0;
}

/**
 * The slug and example routes are open to anonymous callers, so a loop could
 * spend `HF_TOKEN` without end. Each address gets this many shared-tier calls
 * per ten minutes, and past it the route skips to the visitor's own Gemini key
 * (or the slugifier) instead of failing.
 */
export const MICRO_AI_RATE_LIMIT = 60;
const perAddress = createRateLimiter(MICRO_AI_RATE_LIMIT, 10 * 60 * 1000);

/**
 * Every router call an instance makes, across all callers, per hour. Rotating
 * addresses gets past the per-address window; this bounds what one instance
 * spends regardless. `HF_HOURLY_CALL_LIMIT` overrides the default.
 */
const DEFAULT_HOURLY_CALL_LIMIT = 1_000;
function hourlyCallLimit(): number {
  const configured = Number(process.env.HF_HOURLY_CALL_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_HOURLY_CALL_LIMIT;
}
let hourly = createRateLimiter(hourlyCallLimit(), 60 * 60 * 1000);

/** True when this caller may use the shared tier for a text micro-task right now. */
export function consumeMicroAiAllowance(request: { headers?: { get(name: string): string | null } }): boolean {
  return perAddress.consume(clientAddress(request)).ok;
}

export function resetMicroAiLimits(): void {
  perAddress.reset();
  hourly = createRateLimiter(hourlyCallLimit(), 60 * 60 * 1000);
}

function baseUrl(): string {
  return process.env.HF_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

export interface MicroAiResult<T> {
  value: T;
  usage: MicroAiUsage;
  model: string;
}

function messageText(payload: unknown): string {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === 'string') return content;
  // Some vision routes return the answer as a list of typed parts.
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

type RouterPost =
  | { ok: true; payload: unknown }
  | { ok: false; reason: 'unconfigured' | 'limited' | 'http' | 'network' };

/** One router call. Failures stay structured so a vision caller can tell "not configured" from "the model ran and failed". */
async function postChat(body: unknown, timeoutMs: number): Promise<RouterPost> {
  const token = microAiToken();
  if (!token) return { ok: false, reason: 'unconfigured' };
  if (!hourly.consume('all').ok) return { ok: false, reason: 'limited' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: 'http' };
    return { ok: true, payload: (await response.json()) as unknown };
  } catch {
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run one micro-task. Resolves to `null` for every failure mode — unconfigured,
 * network error, timeout, non-2xx, empty completion, or output the task's own
 * validator rejects — so the caller always has a single fallback branch.
 */
export async function runMicroTask<T>(task: MicroAiTask<T>): Promise<MicroAiResult<T> | null> {
  const token = microAiToken();
  if (!token) return null;

  const userContent = task.user.trim().slice(0, MAX_USER_CHARS);
  if (!userContent) return null;

  const model = MICRO_AI_MODELS[task.tier];
  const posted = await postChat(
    {
      model: model.id,
      // Strict scoping: the system role is a static constant, and user text
      // only ever appears as a separate user-role message.
      messages: [
        { role: 'system', content: task.system },
        { role: 'user', content: userContent },
      ],
      temperature: task.temperature,
      max_tokens: task.maxTokens,
      stream: false,
    },
    task.timeoutMs ?? REQUEST_TIMEOUT_MS
  );
  if (!posted.ok) return null;

  const text = messageText(posted.payload);
  if (!text.trim()) return null;

  const value = task.validate(text);
  if (value === null) return null;

  return {
    value,
    usage: readUsage(task.tier, (posted.payload as { usage?: unknown })?.usage),
    model: model.id,
  };
}

export interface VisionMediaPart {
  mimeType: string;
  /** Base64, no data-URL prefix. */
  data: string;
}

export interface VisionTask {
  system: string;
  /** Server-written brief. Media bytes stay in `parts`, never in this string. */
  user: string;
  parts: VisionMediaPart[];
  temperature: number;
  maxTokens: number;
  timeoutMs?: number;
  validate: (raw: string) => string | null;
}

const VISION_TIMEOUT_MS = 25_000;

/**
 * `skipped` means the shared tier was not asked (no token, the instance's
 * hourly ceiling, or a video part it cannot read) and the caller should try Gemini. `failed` means it was asked
 * and did not produce a prompt; `usage` is whatever that call already spent.
 */
export type VisionRun =
  | { status: 'ok'; value: string; usage: MicroAiUsage; model: string }
  | { status: 'skipped'; reason: 'unconfigured' | 'limited' | 'unsupported' }
  | { status: 'failed'; reason: 'provider' | 'empty' | 'rejected'; usage?: MicroAiUsage; model: string };

function visionUsage(payload: unknown): MicroAiUsage | undefined {
  const raw = (payload as { usage?: unknown }).usage;
  if (!raw || typeof raw !== 'object') return undefined;
  return readModelUsage(VISION_MODEL, raw);
}

/**
 * Describe source media on the shared vision model. A video part is skipped:
 * the router call only accepts images, and Gemini is the reader that can watch
 * a clip. Provider bodies are never returned.
 */
export async function runVisionTask(task: VisionTask): Promise<VisionRun> {
  if (!microAiToken()) return { status: 'skipped', reason: 'unconfigured' };
  if (task.parts.length === 0 || task.parts.some((part) => !part.mimeType.startsWith('image/'))) {
    return { status: 'skipped', reason: 'unsupported' };
  }

  const posted = await postChat(
    {
      model: VISION_MODEL.id,
      messages: [
        { role: 'system', content: task.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: task.user },
            ...task.parts.map((part) => ({
              type: 'image_url',
              image_url: { url: `data:${part.mimeType};base64,${part.data}` },
            })),
          ],
        },
      ],
      temperature: task.temperature,
      max_tokens: task.maxTokens,
      stream: false,
    },
    task.timeoutMs ?? VISION_TIMEOUT_MS
  );

  if (!posted.ok) {
    if (posted.reason === 'unconfigured' || posted.reason === 'limited') return { status: 'skipped', reason: posted.reason };
    return { status: 'failed', reason: 'provider', model: VISION_MODEL.id };
  }

  const usage = visionUsage(posted.payload);
  const text = messageText(posted.payload);
  if (!text.trim()) return { status: 'failed', reason: 'empty', usage, model: VISION_MODEL.id };

  const value = task.validate(text);
  if (value === null) return { status: 'failed', reason: 'rejected', usage, model: VISION_MODEL.id };

  return {
    status: 'ok',
    value,
    usage: usage ?? readModelUsage(VISION_MODEL, undefined),
    model: VISION_MODEL.id,
  };
}
