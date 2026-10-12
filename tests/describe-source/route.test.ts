// tests/describe-source/route.test.ts
// @vitest-environment node

import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { POST } from '@/app/api/describe-source/route';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';
import { GEMINI_VISION_MODEL, VISION_MODEL } from '@/lib/micro-ai/models';

import { DESCRIPTION } from './paragraph';

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function imageBody(apiKey = '') {
  return {
    apiKey,
    target: 'video',
    parts: [{ mimeType: 'image/png', data: 'AQIDBA==', label: 'Image 1' }],
  };
}

function microCompletion(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 200, completion_tokens: 80 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('POST /api/describe-source', () => {
  beforeEach(() => {
    delete process.env.HF_TOKEN;
    generateContent.mockReset();
  });

  afterEach(() => {
    delete process.env.HF_TOKEN;
    vi.unstubAllGlobals();
  });

  it('prefers the shared vision model and reports what it cost', async () => {
    process.env.HF_TOKEN = 'hf_token';
    const fetchMock = vi.fn().mockResolvedValue(microCompletion([{ type: 'text', text: DESCRIPTION }]));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(request(imageBody('gemini_key')));
    expect(await response.json()).toEqual({
      prompt: DESCRIPTION,
      source: 'micro-ai',
      model: VISION_MODEL.id,
      usage: {
        promptTokens: 200,
        completionTokens: 80,
        costUsd: (200 / 1_000_000) * 0.2 + (80 / 1_000_000) * 0.2,
      },
    });
    expect(generateContent).not.toHaveBeenCalled();

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.model).toBe(VISION_MODEL.id);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).not.toContain('AQIDBA==');
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AQIDBA==' },
    });
  });

  it('falls back to the visitor Gemini key and strips scaffolding', async () => {
    generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: `Prompt: "${DESCRIPTION}"` }] } }],
    });

    const response = await POST(request(imageBody('gemini_key')));
    expect(await response.json()).toEqual({
      prompt: DESCRIPTION,
      source: 'gemini',
      model: GEMINI_VISION_MODEL,
    });

    const call = generateContent.mock.calls[0][0] as {
      model: string;
      contents: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
      config: { systemInstruction: string };
    };
    expect(call.model).toBe(GEMINI_VISION_MODEL);
    expect(call.config.systemInstruction).not.toContain('AQIDBA==');
    expect(call.contents[1].inlineData).toEqual({ mimeType: 'image/png', data: 'AQIDBA==' });
  });

  it('sends a video to Gemini and does not ask the image-only shared model to watch it', async () => {
    process.env.HF_TOKEN = 'hf_token';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: DESCRIPTION }] } }],
    });

    const response = await POST(request({
      apiKey: 'gemini_key',
      parts: [{ mimeType: 'video/mp4', data: 'AQIDBA==', label: 'Source video' }],
    }));

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const call = generateContent.mock.calls[0][0] as {
      contents: Array<{ inlineData?: { mimeType: string } }>;
    };
    expect(call.contents[1].inlineData?.mimeType).toBe('video/mp4');
  });

  it('asks for a Gemini key when nothing can see the source', async () => {
    const response = await POST(request(imageBody()));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DESCRIBE_ERRORS.noKey);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('does not echo a key that the provider put in its error', async () => {
    const secret = 'gemini-secret-value';
    generateContent.mockRejectedValue(Object.assign(new Error(`rejected ${secret}`), { status: 400 }));

    const response = await POST(request(imageBody(secret)));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(DESCRIBE_ERRORS.failed);
    expect(JSON.stringify(body)).not.toContain(secret);
  });
});
