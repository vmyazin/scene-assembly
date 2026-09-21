// lib/spend/capture.ts
/**
 * The one door into the ledger. Called at each place a generation already
 * becomes final, next to the gallery record, and never throws back into that
 * path: a spend figure is a readout of work that has already succeeded.
 */
import { estimateFalJobCost } from '@/lib/fal/browser';
import { FAL_IMAGE_MODEL, resolveFalVariant } from '@/lib/fal/catalog';
import { falDurationSeconds } from '@/lib/fal/pricing';
import type { FalJob } from '@/lib/fal/types';
import type { EngineId } from '@/lib/engines/registry';
import { fetchKieCredits } from '@/lib/kie/browser';
import type { KieJob } from '@/lib/kie/types';
import type { MicroAiUsage } from '@/lib/micro-ai/models';
import { findModel } from '@/lib/providers/catalog';
import type { ProviderId, ProviderTask } from '@/lib/providers/types';
import type { ProviderJob } from '@/store/useProviderJobsStore';
import { useSpendStore } from '@/store/useSpendStore';

import { excerpt, type SpendEntry } from './ledger';
import { DEFAULT_GEMINI_MODEL_ID } from './rates';
import {
  kieSharers,
  resolveCatalogRate,
  resolveFalRun,
  resolveFree,
  resolveGemini,
  resolveGeminiVideo,
  resolveHelper,
  resolveKieDelta,
  resolveRunware,
  unknownFigure,
  type GeminiUsage,
  type SpendFigure,
} from './resolve';

let sequence = 0;

function mintId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function file(entry: SpendEntry): void {
  try {
    useSpendStore.getState().record(entry);
  } catch {
    // A full or blocked localStorage must not surface as a generation problem.
  }
}

function withFigure(
  base: Omit<SpendEntry, 'costUsd' | 'confidence' | 'source' | 'quantity' | 'note'>,
  figure: SpendFigure
): SpendEntry {
  return { ...base, ...figure };
}

export interface ImageResultCapture {
  engine: EngineId;
  modelId?: string;
  prompt: string;
  inputImages: number;
  resolution?: string;
  usage?: GeminiUsage | null;
  /** Response cost, when the route returned one (Runware). */
  cost?: number;
  galleryRecordId?: string;
  /** fal only: the key the estimate call needs. */
  falApiKey?: string;
  /** fal only: whether web search ran, which fal charges extra for. */
  webSearch?: boolean;
}

const GEMINI_MODEL = DEFAULT_GEMINI_MODEL_ID;

export function captureImageResult(args: ImageResultCapture): void {
  try {
    const at = Date.now();
    const base = {
      id: mintId(args.engine),
      at,
      provider: args.engine,
      modelId: args.modelId ?? (args.engine === 'gemini' ? GEMINI_MODEL : args.engine),
      kind: 'image' as const,
      inputMode: args.inputImages > 0 ? 'image' : 'text',
      promptExcerpt: excerpt(args.prompt),
      ...(args.galleryRecordId ? { galleryRecordId: args.galleryRecordId } : {}),
    };

    switch (args.engine) {
      case 'gemini':
        file(withFigure(base, resolveGemini({ usage: args.usage, modelId: base.modelId, resolution: args.resolution, inputImages: args.inputImages })));
        return;
      case 'pollinations':
      case 'cloudflare':
        file(withFigure(base, resolveFree()));
        return;
      case 'runware':
        file(withFigure(base, resolveRunware(args.cost)));
        return;
      case 'piapi':
      case 'atlas':
      case 'comet':
        file(withFigure(base, resolveCatalogRate(
          args.modelId ? findModel(args.engine, args.modelId) : undefined,
          undefined,
          1,
          { inputImages: args.inputImages, ...(args.engine === 'piapi' ? {size: args.resolution ?? '1K'} : {}) }
        )));
        return;
      case 'fal': {
        const inputMode = args.inputImages > 0 ? 'image' : 'text';
        const modelId = args.modelId ?? FAL_IMAGE_MODEL.id;
        void (async () => {
          try {
            const endpointId = resolveFalVariant(modelId, 'image', inputMode).endpointId;
            const estimate = args.falApiKey
              ? await estimateFalJobCost({ apiKey: args.falApiKey, endpointId }).catch(() => null)
              : null;
            const figure = resolveFalRun({
              estimate,
              endpointId,
              controls: { resolution: args.resolution, webSearch: args.webSearch },
            });
            file(withFigure({ ...base, modelId }, figure));
          } catch {
            file(withFigure({ ...base, modelId }, unknownFigure('estimate-api')));
          }
        })();
        return;
      }
      case 'kie':
        // Kie images run through KieGenerationWorkspace and captureKieJob.
        return;
    }
  } catch {
    // Never let a readout break the studio.
  }
}

export function captureFalJob(job: FalJob, apiKey: string): void {
  try {
    const base = {
      id: `fal-${job.id}`,
      at: Date.now(),
      provider: 'fal' as const,
      modelId: job.modelId,
      kind: job.mediaType,
      inputMode: job.inputMode,
      promptExcerpt: excerpt(job.prompt),
      galleryRecordId: `fal-${job.id}`,
    };
    void (async () => {
      try {
        const endpointId = resolveFalVariant(job.modelId, job.mediaType, job.inputMode).endpointId;
        const controlValues = job.controlValues ?? {};
        const durationSeconds = falDurationSeconds(controlValues);
        // A rejection here is the same answer as a null estimate: fall through
        // to the published table rather than filing an unknown.
        const estimate = await estimateFalJobCost({
          apiKey,
          endpointId,
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        }).catch(() => null);
        const figure = resolveFalRun({
          estimate,
          endpointId,
          controls: {
            resolution:
              typeof controlValues.resolution === 'string' ? controlValues.resolution : undefined,
            audio: controlValues.generate_audio !== false,
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          },
        });
        file(withFigure(base, figure));
      } catch {
        file(withFigure(base, unknownFigure('estimate-api')));
      }
    })();
  } catch {
    // base construction itself failed (e.g. a stale job with a nullish
    // prompt) — there is nothing to file, but a generation that already
    // succeeded must never see this.
  }
}

export function captureKieJob(job: KieJob, apiKey: string, jobs: KieJob[]): void {
  try {
    const base = {
      id: `kie-${job.id}`,
      at: Date.now(),
      provider: 'kie' as const,
      modelId: job.modelId,
      kind: job.mediaType,
      inputMode: job.inputMode,
      promptExcerpt: excerpt(job.prompt),
      galleryRecordId: `kie-${job.id}`,
    };
    void (async () => {
      try {
        const after = await fetchKieCredits(apiKey);
        const sharedWith = kieSharers(jobs, job);
        file(withFigure(base, resolveKieDelta({ before: job.creditsBefore, after, sharedWith })));
      } catch {
        file(withFigure(base, unknownFigure('balance-delta')));
      }
    })();
  } catch {
    // See captureFalJob.
  }
}

export function captureProviderJob(provider: ProviderId, job: ProviderJob, task: ProviderTask): void {
  try {
    const base = {
      id: `${provider}-${job.id}`,
      at: Date.now(),
      provider,
      modelId: job.modelId,
      kind: 'video' as const,
      inputMode: job.inputMode,
      promptExcerpt: excerpt(job.prompt),
      galleryRecordId: `${provider}-${job.id}`,
    };
    if (provider === 'runware') {
      file(withFigure(base, resolveRunware(task.cost)));
      return;
    }
    const duration = job.controlValues?.duration;
    file(
      withFigure(
        base,
        resolveCatalogRate(findModel(provider, job.modelId), typeof duration === 'number' ? duration : undefined, 1, {
          audio: job.controlValues?.audio === true,
          size: typeof job.controlValues?.size === 'string' ? job.controlValues.size : undefined,
        })
      )
    );
  } catch {
    // See file().
  }
}

export interface GeminiVideoCapture {
  modelId: string;
  prompt: string;
  inputMode: 'text' | 'image';
  resolution: string;
  durationSeconds: number;
  galleryRecordId?: string;
}

export function captureGeminiVideo(args: GeminiVideoCapture): void {
  try {
    file(
      withFigure(
        {
          id: mintId('gemini-video'),
          at: Date.now(),
          provider: 'gemini',
          modelId: args.modelId,
          kind: 'video',
          inputMode: args.inputMode,
          promptExcerpt: excerpt(args.prompt),
          ...(args.galleryRecordId ? { galleryRecordId: args.galleryRecordId } : {}),
        },
        resolveGeminiVideo({
          modelId: args.modelId,
          resolution: args.resolution,
          durationSeconds: args.durationSeconds,
        })
      )
    );
  } catch {
    // See file().
  }
}

export function captureHelper(usage: MicroAiUsage, model: string): void {
  try {
    file(
      withFigure(
        {
          id: mintId('micro-ai'),
          at: Date.now(),
          provider: 'micro-ai',
          modelId: model,
          kind: 'helper',
          promptExcerpt: '',
        },
        resolveHelper(usage)
      )
    );
  } catch {
    // See file().
  }
}
