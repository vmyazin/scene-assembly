import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { buildSlugPrompt, cleanSlug, slugify } from '@/lib/example-prompts';
import { GEMINI_MICRO_MODEL } from '@/lib/micro-ai/models';
import { consumeMicroAiAllowance, runMicroTask } from '@/lib/micro-ai/server';
import { slugTask, validateSlug } from '@/lib/micro-ai/tasks';
import type { MicroAiEnvelope } from '@/lib/micro-ai/types';

/**
 * Filename slug for a generation prompt, cheapest source first:
 * app-owned Llama 8B → the user's Gemini key → a zero-cost regex slugifier.
 * There is no failure path: the deterministic tail always produces a name.
 */
export async function POST(request: NextRequest) {
  const { prompt, apiKey } = await request.json();

  if (!prompt || !String(prompt).trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }
  const text = String(prompt);

  const micro = consumeMicroAiAllowance(request) ? await runMicroTask(slugTask(text)) : null;
  if (micro) {
    return NextResponse.json({
      slug: micro.value,
      source: 'micro-ai',
      model: micro.model,
      usage: micro.usage,
    } satisfies MicroAiEnvelope & { slug: string });
  }

  const geminiSlug = apiKey ? await geminiSlugFor(text, String(apiKey)) : null;
  if (geminiSlug) {
    return NextResponse.json({
      slug: geminiSlug,
      source: 'gemini',
      model: GEMINI_MICRO_MODEL,
    } satisfies MicroAiEnvelope & { slug: string });
  }

  return NextResponse.json({
    slug: slugify(text) || 'image',
    source: 'deterministic',
  } satisfies MicroAiEnvelope & { slug: string });
}

/** Returns null on any Gemini failure so the caller falls through. */
async function geminiSlugFor(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MICRO_MODEL,
      contents: buildSlugPrompt(prompt),
      config: { temperature: 0.3, maxOutputTokens: 30 },
    });

    let text = '';
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) if (part.text) text += part.text;
    }

    // Same shape check the micro-AI path applies, then the looser legacy clean.
    return validateSlug(text) || cleanSlug(text) || null;
  } catch {
    return null;
  }
}
