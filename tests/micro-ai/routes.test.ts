// @vitest-environment node

import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { POST as examplePost } from '../../app/api/example/route';
import { POST as slugPost } from '../../app/api/slug/route';
import { MICRO_AI_RATE_LIMIT, resetMicroAiLimits } from '@/lib/micro-ai/server';

function request(body: unknown, address = '203.0.113.7'): NextRequest {
  return { json: async () => body, headers: new Headers({ 'x-real-ip': address }) } as unknown as NextRequest;
}

function microCompletion(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function geminiText(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe('POST /api/slug', () => {
  beforeEach(() => {
    delete process.env.HF_TOKEN;
    delete process.env.HF_HOURLY_CALL_LIMIT;
    generateContent.mockReset();
    resetMicroAiLimits();
  });

  afterEach(() => {
    delete process.env.HF_TOKEN;
    vi.unstubAllGlobals();
  });

  it('prefers the shared tier and reports what it cost', async () => {
    process.env.HF_TOKEN = 'hf_token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(microCompletion('cyberpunk-neon-alley')));

    const response = await slugPost(request({ prompt: 'Cyberpunk neon alley', apiKey: 'gemini_key' }));

    expect(await response.json()).toEqual({
      slug: 'cyberpunk-neon-alley',
      source: 'micro-ai',
      model: 'meta-llama/Llama-3.1-8B-Instruct',
      usage: {
        promptTokens: 100,
        completionTokens: 10,
        costUsd: (100 / 1_000_000) * 0.02 + (10 / 1_000_000) * 0.02,
      },
    });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falls back to the user Gemini key when the shared tier is unavailable', async () => {
    generateContent.mockResolvedValue(geminiText('quiet-ocean-at-dusk'));

    const response = await slugPost(request({ prompt: 'A quiet ocean at dusk', apiKey: 'gemini_key' }));

    expect(await response.json()).toEqual({
      slug: 'quiet-ocean-at-dusk',
      source: 'gemini',
      model: 'gemini-2.5-flash-lite',
    });
  });

  it('falls back to the deterministic slugifier with no key at all', async () => {
    const response = await slugPost(request({ prompt: 'A quiet ocean at dusk' }));

    expect(await response.json()).toEqual({ slug: 'a-quiet-ocean-at-dusk', source: 'deterministic' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falls through to deterministic when Gemini itself fails', async () => {
    generateContent.mockRejectedValue(new Error('gemini_key quota exceeded'));

    const response = await slugPost(request({ prompt: 'A quiet ocean at dusk', apiKey: 'gemini_key' }));
    const body = await response.json();

    expect(body).toEqual({ slug: 'a-quiet-ocean-at-dusk', source: 'deterministic' });
    expect(JSON.stringify(body)).not.toContain('quota exceeded');
  });

  it('stops spending the shared tier on one address past its window and falls back', async () => {
    process.env.HF_TOKEN = 'hf_token';
    const fetchMock = vi.fn().mockImplementation(async () => microCompletion('cyberpunk-neon-alley'));
    vi.stubGlobal('fetch', fetchMock);

    for (let attempt = 0; attempt < MICRO_AI_RATE_LIMIT; attempt += 1) {
      await slugPost(request({ prompt: 'Cyberpunk neon alley' }));
    }
    const limited = await slugPost(request({ prompt: 'A quiet ocean at dusk' }));
    expect(await limited.json()).toEqual({ slug: 'a-quiet-ocean-at-dusk', source: 'deterministic' });
    expect(fetchMock).toHaveBeenCalledTimes(MICRO_AI_RATE_LIMIT);

    // Another address still has its own window.
    const other = await slugPost(request({ prompt: 'Cyberpunk neon alley' }, '198.51.100.4'));
    expect((await other.json()).source).toBe('micro-ai');
  });

  it('caps router calls per instance per hour across every address', async () => {
    process.env.HF_TOKEN = 'hf_token';
    process.env.HF_HOURLY_CALL_LIMIT = '2';
    resetMicroAiLimits();
    const fetchMock = vi.fn().mockImplementation(async () => microCompletion('cyberpunk-neon-alley'));
    vi.stubGlobal('fetch', fetchMock);

    for (const address of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) {
      await slugPost(request({ prompt: 'Cyberpunk neon alley' }, address));
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty prompt', async () => {
    const response = await slugPost(request({ prompt: '   ' }));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/example', () => {
  beforeEach(() => {
    delete process.env.HF_TOKEN;
    delete process.env.HF_HOURLY_CALL_LIMIT;
    generateContent.mockReset();
    resetMicroAiLimits();
  });

  afterEach(() => {
    delete process.env.HF_TOKEN;
    vi.unstubAllGlobals();
  });

  it('serves a keyless visitor from the shared tier', async () => {
    process.env.HF_TOKEN = 'hf_token';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      microCompletion('A lone lighthouse in a storm, long exposure, cold blue light, wide cinematic angle')
    ));

    const response = await examplePost(request({ featureId: 'text-to-image' }));
    const body = await response.json();

    expect(body.source).toBe('micro-ai');
    expect(body.prompt).toBe(
      'A lone lighthouse in a storm, long exposure, cold blue light, wide cinematic angle'
    );
    expect(body.model).toBe('meta-llama/Llama-3.1-8B-Instruct');
  });

  it('asks a keyless visitor to connect a key when nothing can serve them', async () => {
    const response = await examplePost(request({ featureId: 'text-to-image' }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      'Connect a Gemini API key to generate example prompts.'
    );
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falls back to the user Gemini key and strips its scaffolding', async () => {
    generateContent.mockResolvedValue(
      geminiText('Prompt: "A brass diving bell descending through kelp, godrays, slow dolly, muted teal"')
    );

    const response = await examplePost(request({ featureId: 'text-to-image', apiKey: 'gemini_key' }));

    expect(await response.json()).toEqual({
      prompt: 'A brass diving bell descending through kelp, godrays, slow dolly, muted teal',
      source: 'gemini',
      model: 'gemini-2.5-flash-lite',
    });
  });

  it('sends the universal image-to-video contract to Gemini fallback', async () => {
    generateContent.mockResolvedValue(
      geminiText('Use a slow push-in with soft atmospheric motion across the scene')
    );

    const response = await examplePost(
      request({ featureId: 'image-to-video', apiKey: 'gemini_key', seed: 'moody' })
    );

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0] as { contents: string };
    expect(call.contents).toContain(
      'can be applied unchanged to any supplied image — a landscape, an individual portrait, a group, an object, or artwork'
    );
    expect(call.contents).toContain('the scene');
    expect(call.contents).toContain('the view');
    expect(call.contents).toContain(
      'Do not invent or identify subjects, subject counts, objects, settings, clothing, demographics, art styles, or media.'
    );
    expect(call.contents).not.toContain('Describe art style, lighting, camera angle, or medium.');
  });
});
