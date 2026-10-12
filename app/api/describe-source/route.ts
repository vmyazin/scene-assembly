// app/api/describe-source/route.ts
import { NextRequest, NextResponse } from 'next/server';

import { parseDescribeRequest } from '@/lib/describe-source/contract';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import { describeErrorStatus, describeWithGemini, publicDescribeError } from '@/lib/describe-source/gemini';
import { describeSourceTask } from '@/lib/describe-source/prompt';
import { runVisionTask } from '@/lib/micro-ai/server';
import { GEMINI_VISION_MODEL } from '@/lib/micro-ai/models';
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: DESCRIBE_ERRORS.invalid }, { status: 400 });
  }

  const parsed = parseDescribeRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const task = describeSourceTask(parsed.request.parts, parsed.request.target);
  const micro = await runVisionTask({ ...task, parts: parsed.request.parts });
  if (micro) {
    return NextResponse.json({
      prompt: micro.value,
      source: 'micro-ai',
      model: micro.model,
      usage: micro.usage,
    } satisfies MicroAiEnvelope & { prompt: string });
  }

  if (!parsed.request.apiKey) {
    return NextResponse.json({ error: DESCRIBE_ERRORS.noKey }, { status: 400 });
  }

  try {
    const prompt = await describeWithGemini(parsed.request.apiKey, task, parsed.request.parts);
    if (!prompt) {
      return NextResponse.json({ error: DESCRIBE_ERRORS.emptyModel }, { status: 502 });
    }
    return NextResponse.json({
      prompt,
      source: 'gemini',
      model: GEMINI_VISION_MODEL,
    } satisfies MicroAiEnvelope & { prompt: string });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: publicDescribeError(error, parsed.request.apiKey) },
      { status: describeErrorStatus(error) }
    );
  }
}
