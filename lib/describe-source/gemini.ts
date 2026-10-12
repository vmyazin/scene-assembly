// lib/describe-source/gemini.ts

import { GoogleGenAI } from '@google/genai';

import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import type { DescribePart } from '@/lib/describe-source/contract';
import type { DescribeTaskSpec } from '@/lib/describe-source/prompt';
import { GEMINI_VISION_MODEL } from '@/lib/micro-ai/models';

/**
 * A provider error can echo the key it was called with. The sentence we show
 * is ours whenever the raw text contains that key.
 */
export function publicDescribeError(error: unknown, apiKey: string): string {
  const raw = error instanceof Error ? error.message.trim() : '';
  if (!raw) return DESCRIBE_ERRORS.failed;
  if (apiKey && raw.includes(apiKey)) return DESCRIBE_ERRORS.failed;
  return raw.length > 300 ? `${raw.slice(0, 297)}…` : raw;
}

export function describeErrorStatus(error: unknown): number {
  const status =
    error !== null && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
  return status === 400 || status === 401 || status === 403 ? 400 : 502;
}

/**
 * Watch the source with the visitor's Gemini key. Returns null when the model
 * answers with nothing the prompt validator will keep.
 */
export async function describeWithGemini(
  apiKey: string,
  task: DescribeTaskSpec,
  parts: DescribePart[]
): Promise<string | null> {
  const key = apiKey.trim();
  if (!key) return null;

  const ai = new GoogleGenAI({ apiKey: key });
  const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: task.user },
  ];
  for (const part of parts) contents.push({ inlineData: { mimeType: part.mimeType, data: part.data } });

  const response = await ai.models.generateContent({
    model: GEMINI_VISION_MODEL,
    contents,
    config: {
      systemInstruction: task.system,
      temperature: task.temperature,
      maxOutputTokens: task.maxTokens,
    },
  });

  let text = '';
  const responseParts = response.candidates?.[0]?.content?.parts;
  if (responseParts) {
    for (const part of responseParts) if (part.text) text += part.text;
  }
  return task.validate(text);
}
