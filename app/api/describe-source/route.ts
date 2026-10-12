// app/api/describe-source/route.ts
import { NextRequest, NextResponse } from 'next/server';

import { FalRequestBodyTooLarge, parseBoundedFalJson } from '@/lib/fal/request-body';
import { MAX_DESCRIBE_JSON_BYTES, parseDescribeRequest } from '@/lib/describe-source/contract';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import { describeErrorStatus, describeWithGemini, publicDescribeError } from '@/lib/describe-source/gemini';
import { describeClientKey, consumeDescribeRateLimit } from '@/lib/describe-source/limit';
import { describeSourceTask } from '@/lib/describe-source/prompt';
import { runVisionTask, type VisionRun } from '@/lib/micro-ai/server';
import { GEMINI_VISION_MODEL, type MicroAiUsage } from '@/lib/micro-ai/models';
import type { MicroAiEnvelope } from '@/lib/micro-ai/types';

/**
 * A detailed prompt from a selected source image or video.
 *
 * Cheapest configured source first: the app-owned vision model (`HF_TOKEN`),
 * then the visitor's Gemini key. The text micro-tier is not asked — it cannot
 * see the file. There is no deterministic description, so an exhausted chain
 * is an error the button shows.
 */
export async function POST(request: NextRequest) {
  const limited = consumeDescribeRateLimit(describeClientKey(request));
  if (!limited.ok) {
    return NextResponse.json(
      { error: DESCRIBE_ERRORS.busy },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } }
    );
  }

  let body: unknown;
  try {
    // Same gate the fal routes use: Content-Length first, then the bytes
    // actually read, so a missing or lying length cannot become a vision call.
    body = await parseBoundedFalJson(request, MAX_DESCRIBE_JSON_BYTES);
  } catch (error: unknown) {
    if (error instanceof FalRequestBodyTooLarge) {
      return NextResponse.json({ error: DESCRIBE_ERRORS.tooLarge }, { status: 413 });
    }
    return NextResponse.json({ error: DESCRIBE_ERRORS.invalid }, { status: 400 });
  }

  const parsed = parseDescribeRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const task = describeSourceTask(parsed.request.parts, parsed.request.target);
  const vision = await runVisionTask({ ...task, parts: parsed.request.parts });
  if (vision.status === 'ok') {
    return NextResponse.json({
      prompt: vision.value,
      source: 'micro-ai',
      model: vision.model,
      usage: vision.usage,
    } satisfies MicroAiEnvelope & { prompt: string });
  }

  const billed = billedAttempt(vision);

  // The shared tier ran and failed. With no Gemini key there is nothing else
  // to ask, and the sentence has to say so — a missing-key message hides a
  // call that already spent tokens.
  if (vision.status === 'failed' && !parsed.request.apiKey) {
    return NextResponse.json(
      {
        error: vision.reason === 'provider' ? DESCRIBE_ERRORS.failed : DESCRIBE_ERRORS.emptyModel,
        source: 'micro-ai',
        model: vision.model,
        usage: vision.usage,
      },
      { status: 502 }
    );
  }

  if (!parsed.request.apiKey) {
    return NextResponse.json({ error: DESCRIBE_ERRORS.noKey }, { status: 400 });
  }

  try {
    const prompt = await describeWithGemini(parsed.request.apiKey, task, parsed.request.parts);
    if (!prompt) {
      return NextResponse.json(
        { error: DESCRIBE_ERRORS.emptyModel, ...billed },
        { status: 502 }
      );
    }
    return NextResponse.json({
      prompt,
      source: 'gemini',
      model: GEMINI_VISION_MODEL,
      ...billed,
    } satisfies MicroAiEnvelope & { prompt: string; usageModel?: string });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: publicDescribeError(error, parsed.request.apiKey), ...billed },
      { status: describeErrorStatus(error) }
    );
  }
}

/** Usage from a shared-tier attempt that did not write the prompt, so the client can still record it. */
function billedAttempt(vision: VisionRun): { usage?: MicroAiUsage; usageModel?: string } {
  if (vision.status !== 'failed' || !vision.usage) return {};
  return { usage: vision.usage, usageModel: vision.model };
}
