import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { buildExamplePrompt } from '@/lib/example-prompts';
import { GEMINI_MICRO_MODEL } from '@/lib/micro-ai/models';
import { consumeMicroAiAllowance, runMicroTask } from '@/lib/micro-ai/server';
import { examplePromptTask, validateExamplePrompt } from '@/lib/micro-ai/tasks';
import type { MicroAiEnvelope } from '@/lib/micro-ai/types';

/**
 * A fresh, feature-tailored example prompt: app-owned Llama 8B first, then the
 * user's Gemini key. Unlike slugs there is no sensible deterministic tail, so
 * an exhausted chain is a real error the caller surfaces.
 */
export async function POST(request: NextRequest) {
  const { featureId, apiKey, seed } = await request.json();

  const micro = consumeMicroAiAllowance(request)
    ? await runMicroTask(examplePromptTask(String(featureId ?? ''), seed))
    : null;
  if (micro) {
    return NextResponse.json({
      prompt: micro.value,
      source: 'micro-ai',
      model: micro.model,
      usage: micro.usage,
    } satisfies MicroAiEnvelope & { prompt: string });
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Connect a Gemini API key to generate example prompts.' },
      { status: 400 }
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: GEMINI_MICRO_MODEL,
      contents: buildExamplePrompt(featureId, seed),
      config: { temperature: 1.2, maxOutputTokens: 120 },
    });

    // Concatenate any text parts (mirrors the generate route's extraction).
    let text = '';
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.text) text += part.text;
      }
    }

    // Strip wrapping quotes / a leading "Prompt:" label the model sometimes adds.
    text = text
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^(prompt|example)\s*:\s*/i, '')
      .trim();

    // Same line-level guard the micro-AI path applies, then the raw text.
    const prompt = validateExamplePrompt(text) || text;

    if (!prompt) {
      return NextResponse.json(
        { error: 'The model returned an empty example. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      prompt,
      source: 'gemini',
      model: GEMINI_MICRO_MODEL,
    } satisfies MicroAiEnvelope & { prompt: string });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate example' },
      { status: 500 }
    );
  }
}
