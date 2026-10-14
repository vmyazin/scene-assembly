// lib/micro-ai/server.ts
import { MICRO_AI_MODELS, readModelUsage, readUsage, VISION_MODEL, type MicroAiUsage } from '@/lib/micro-ai/models';
import type { MicroAiTask } from '@/lib/micro-ai/tasks';

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
  | { ok: false; reason: 'unconfigured' | 'http' | 'network' };

/** One router call. Failures stay structured so a vision caller can tell "not configured" from "the model ran and failed". */
async function postChat(body: unknown, timeoutMs: number): Promise<RouterPost> {
  const token = microAiToken();
  if (!token) return { ok: false, reason: 'unconfigured' };

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
 * `skipped` means the shared tier was not asked (no token, or a video part it
 * cannot read) and the caller should try Gemini. `failed` means it was asked
 * and did not produce a prompt; `usage` is whatever that call already spent.
 */
export type VisionRun =
  | { status: 'ok'; value: string; usage: MicroAiUsage; model: string }
  | { status: 'skipped'; reason: 'unconfigured' | 'unsupported' }
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
    if (posted.reason === 'unconfigured') return { status: 'skipped', reason: 'unconfigured' };
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
