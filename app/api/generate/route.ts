import { NextRequest, NextResponse } from 'next/server';
import { geminiGenerate } from '@/lib/engines/gemini';
import { pollinationsGenerate } from '@/lib/engines/pollinations';
import { cloudflareGenerate } from '@/lib/engines/cloudflare';
import { createKieTask, getKieTask } from '@/lib/kie/client';
import { resolveKieVariant, validateKieInput } from '@/lib/kie/catalog';
import type { KieInputMode, KieProtocol } from '@/lib/kie/types';
import { fetchAsBase64, getAdapter, isProviderId } from '@/lib/providers';
import { findModel, resolveModel } from '@/lib/providers/catalog';
import { ProviderError, type ProviderId } from '@/lib/providers/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isInputMode(value: unknown): value is KieInputMode {
  return value === 'text' || value === 'image';
}

function isProtocol(value: unknown): value is KieProtocol {
  return value === 'market' || value === 'veo';
}

async function handleKieRequest(body: Record<string, unknown>) {
  try {
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Kie API key is required' }, { status: 400 });
    }

    if (body.operation === 'status') {
      if (typeof body.taskId !== 'string' || !isProtocol(body.protocol)) {
        return NextResponse.json({ success: false, error: 'Task ID and Kie protocol are required' }, { status: 400 });
      }

      const task = await getKieTask({ apiKey, protocol: body.protocol, taskId: body.taskId });
      return NextResponse.json({ success: true, task });
    }

    if (typeof body.modelId !== 'string' || !isInputMode(body.inputMode) || typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return NextResponse.json({ success: false, error: 'A Kie model, mode, and prompt are required' }, { status: 400 });
    }

    const uploadUrls = Array.isArray(body.uploadUrls)
      ? body.uploadUrls.filter((url): url is string => typeof url === 'string')
      : [];
    const values = isRecord(body.values)
      ? Object.fromEntries(
          Object.entries(body.values).filter((entry): entry is [string, string | number | boolean] =>
            typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean'
          )
        )
      : {};
    const variant = resolveKieVariant(body.modelId, body.inputMode);
    const validationError = validateKieInput(variant, { prompt: body.prompt, uploadUrls });
    if (validationError) {
      return NextResponse.json({ success: false, error: validationError }, { status: 400 });
    }
    const task = await createKieTask({
      apiKey,
      variant,
      prompt: body.prompt.trim(),
      uploadUrls,
      values,
    });

    return NextResponse.json({ success: true, ...task });
  } catch (error: unknown) {
    const status =
      error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : 'Kie could not process this request.';
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/**
 * Runware / Atlas Cloud / CometAPI images. All three answer with a hosted URL
 * (Comet's GPT models with base64), so the bytes are resolved here and the
 * response looks exactly like every other engine's to the client.
 */
async function handleProviderRequest(provider: ProviderId, body: Record<string, unknown>) {
  const adapter = getAdapter(provider);
  try {
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: `A ${adapter.label} API key is required` },
        { status: 400 }
      );
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    const config = isRecord(body.config) ? body.config : {};
    // Reference images arrive as bare base64 (the client strips the data: prefix);
    // every provider here wants a data URI or URL.
    const images = Array.isArray(body.images)
      ? body.images
          .filter((image): image is string => typeof image === 'string' && image.length > 0)
          .map((image) => (image.startsWith('data:') || image.startsWith('http') ? image : `data:image/png;base64,${image}`))
      : [];

    const model = resolveModel(provider, 'image', typeof body.model === 'string' ? body.model : undefined);
    const catalogModel = findModel(provider, model);
    if (provider === 'piapi' && images.length > 14) return NextResponse.json({success:false,error:'Nano Banana 2 accepts up to 14 references.'},{status:400});
    const result = await adapter.generateImage({
      apiKey,
      model,
      prompt,
      // Trimmed to what the model documents it accepts.
      images: catalogModel?.maxInputImages ? images.slice(0, catalogModel.maxInputImages) : images,
      // PiAPI takes the studio's label as written; Atlas resolves it through the
      // catalog, because only some of its models publish a tier at all and the
      // ones that do spell it lowercase. Either way the label is what travels.
      ...(provider === 'piapi' || provider === 'atlas'
        ? {resolution: typeof config.imageSize === 'string' ? config.imageSize : '1K'}
        : {}),
      aspectRatio: typeof config.aspectRatio === 'string' ? config.aspectRatio : undefined,
      imageInput: catalogModel?.imageInput,
    });

    const media = result.base64
      ? { base64: result.base64, mimeType: result.mimeType ?? 'image/png' }
      : await fetchAsBase64(result.url as string, provider);

    return NextResponse.json({
      success: true,
      imageData: media.base64,
      mimeType: media.mimeType,
      cost: result.cost,
    });
  } catch (error: unknown) {
    const status = error instanceof ProviderError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : `${adapter.label} could not process this request.`;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (isRecord(body) && body.engine === 'kie') return handleKieRequest(body);
    if (isRecord(body) && isProviderId(body.engine)) return handleProviderRequest(body.engine, body);
    const { engine = 'gemini', prompt, images, config, apiKey, cfAccountId, cfToken, model } = body;

    if (!prompt && !images?.length) {
      return NextResponse.json(
        { success: false, error: 'Prompt or image is required' },
        { status: 400 }
      );
    }

    let result;
    if (engine === 'pollinations') {
      result = await pollinationsGenerate({ prompt, aspectRatio: config?.aspectRatio });
    } else if (engine === 'cloudflare') {
      if (!cfAccountId || !cfToken) {
        return NextResponse.json(
          { success: false, error: 'Cloudflare Account ID and API token are required' },
          { status: 400 }
        );
      }
      result = await cloudflareGenerate({ prompt, accountId: cfAccountId, token: cfToken });
    } else {
      if (!apiKey) {
        return NextResponse.json(
          { success: false, error: 'API key is required' },
          { status: 400 }
        );
      }
      result = await geminiGenerate({
        prompt,
        images,
        config,
        apiKey,
        ...(typeof model === 'string' ? { model } : {}),
      });
    }

    return NextResponse.json({
      success: true,
      imageData: result.imageData,
      mimeType: result.mimeType,
      // Only Gemini reports it; the free engines leave it undefined and JSON drops it.
      usage: result.usage,
    });
  } catch (error: unknown) {
    console.error('Generation error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate image';
    return NextResponse.json(
      {
        success: false,
        error: message,
        details: message,
      },
      { status: 500 }
    );
  }
}
