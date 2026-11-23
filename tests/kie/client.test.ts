import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKieTask, getKieTask } from '../../lib/kie/client';
import { defaultKieValues, resolveKieVariant } from '../../lib/kie/catalog';

const apiKey = 'kie_test_key';

describe('Kie task client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits marketplace jobs with the documented bearer request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, data: { taskId: 'task_market_1' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createKieTask({
        apiKey,
        variant: resolveKieVariant('gpt-image-2-6-sunburst', 'text'),
        prompt: 'Studio photo of a banana',
        values: { aspect_ratio: '1:1', resolution: '2K' },
        uploadUrls: [],
      })
    ).resolves.toEqual({ taskId: 'task_market_1', protocol: 'market' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.kie.ai/api/v1/jobs/createTask',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${apiKey}` }),
        body: JSON.stringify({
          model: 'gpt-image-2-6/sunburst-text-to-image',
          // Standard writes `auto`: Kie's own default for this family is `low`.
          input: { prompt: 'Studio photo of a banana', aspect_ratio: '1:1', resolution: '2K', moderation: 'auto' },
        }),
      })
    );
  });

  it.each(['image', 'text'] as const)('sends the documented Wan 2.7 %s-to-video payload', async mode => {
    const variant = resolveKieVariant('wan-2-7', mode);
    const frame = 'https://files.example/frame.png';
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ code: 200, data: { taskId: 'wan-task' } }));
    vi.stubGlobal('fetch', fetchMock);
    const args = {
      apiKey, variant, prompt: 'Tilt down slowly', uploadUrls: mode === 'image' ? [frame] : [],
      values: { ...defaultKieValues(variant), aspect_ratio: '4:3', enable_prompt_expansion: false },
    };
    await expect(createKieTask({ ...args, values: { ...args.values, resolution: '480p' } })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
    for (const resolution of ['720p', '1080p']) {
      await createKieTask({ ...args, values: { ...args.values, resolution } });
      expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({
        model: `wan/2-7-${mode}-to-video`,
        input: {
          prompt: args.prompt, resolution, duration: 5, prompt_extend: false, seed: 0,
          ...(mode === 'image' ? { first_frame_url: frame } : { ratio: '4:3' }),
        },
      });
    }
  });

  it('uses the dedicated Veo endpoint and normalizes its completion response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, data: { taskId: 'task_veo_1' } }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 200,
            data: {
              successFlag: 1,
              progress: '1.00',
              response: { result_urls: ['https://cdn.kie.ai/video.mp4'] },
            },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const variant = resolveKieVariant('veo-3-1', 'text');
    await createKieTask({
      apiKey,
      variant,
      prompt: 'A sunrise over the Pacific Ocean',
      values: {
        aspect_ratio: '16:9',
        enableFallback: false,
        enableTranslation: true,
        generationType: 'TEXT_2_VIDEO',
      },
      uploadUrls: [],
    });

    await expect(getKieTask({ apiKey, protocol: 'veo', taskId: 'task_veo_1' })).resolves.toMatchObject({
      taskId: 'task_veo_1',
      state: 'success',
      progress: 1,
      resultUrls: ['https://cdn.kie.ai/video.mp4'],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.kie.ai/api/v1/veo/generate',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'veo3_fast',
          prompt: 'A sunrise over the Pacific Ocean',
          aspect_ratio: '16:9',
          enableFallback: false,
          enableTranslation: true,
          generationType: 'TEXT_2_VIDEO',
        }),
      })
    );
  });

  it('normalizes a failed marketplace task with its provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 200,
            data: { taskId: 'task_fail', state: 'fail', failMsg: 'Content policy violation', progress: 0 },
          }),
          { status: 200 }
        )
      )
    );

    await expect(getKieTask({ apiKey, protocol: 'market', taskId: 'task_fail' })).resolves.toMatchObject({
      state: 'fail',
      error: 'Content policy violation',
    });
  });

  it('turns Kie content-policy failures into an actionable, secret-safe error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 400, msg: 'Content policy violation' }), { status: 400 })
      )
    );

    await expect(
      createKieTask({
        apiKey,
        variant: resolveKieVariant('nano-banana-pro', 'text'),
        prompt: 'A prompt that needs adjustment',
        values: {},
        uploadUrls: [],
      })
    ).rejects.toThrow('Kie rejected this prompt or reference image under its content policy. Adjust the request and try again.');
  });

  it('accepts a direct temporary result URL from a completed task', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 200, data: { state: 'success', resultJson: 'https://temp.kie.ai/result.png' } }),
          { status: 200 }
        )
      )
    );

    await expect(getKieTask({ apiKey, protocol: 'market', taskId: 'task_direct_url' })).resolves.toMatchObject({
      state: 'success',
      resultUrls: ['https://temp.kie.ai/result.png'],
    });
  });
});
