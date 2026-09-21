// lib/spend/resolve.ts
/**
 * One resolver per provider. Each returns the cost fields of a ledger entry,
 * never throws, and answers `unknown` for anything it cannot price. Pure, so a
 * fixture response is all a test needs.
 */
import type { KieJob } from '../kie/types';
import type { MicroAiUsage } from '../micro-ai/models';
import { sizeRateKey, type ProviderModel } from '../providers/types';

import type { SpendEntry, SpendSource } from './ledger';
import {
  falPublishedCost,
  geminiResolutionCost,
  geminiTokenCost,
  geminiVideoCost,
  KIE_USD_PER_CREDIT,
  type FalRunControls,
} from './rates';

export type SpendFigure = Pick<SpendEntry, 'costUsd' | 'confidence' | 'source' | 'quantity' | 'note'>;

export function unknownFigure(source: SpendSource, note?: string): SpendFigure {
  return { costUsd: null, confidence: 'unknown', source, ...(note ? { note } : {}) };
}

export interface GeminiUsage {
  promptTokens: number;
  outputTokens: number;
}

export function resolveGemini(args: {
  usage?: GeminiUsage | null;
  /** Which Gemini image model ran: the three differ fourfold at the same size. */
  modelId?: string;
  resolution?: string;
  inputImages: number;
  /** Number of image outputs in this response. Usage metadata already covers all outputs. */
  outputImages?: number;
}): SpendFigure {
  const { usage } = args;
  if (usage && Number.isFinite(usage.outputTokens) && usage.outputTokens > 0) {
    const promptTokens = Number.isFinite(usage.promptTokens) ? Math.max(0, usage.promptTokens) : 0;
    return {
      costUsd: geminiTokenCost(args.modelId, promptTokens, usage.outputTokens),
      confidence: 'exact',
      source: 'usage-metadata',
      quantity: { unit: 'token', value: promptTokens + usage.outputTokens },
    };
  }
  const outputImages = Number.isInteger(args.outputImages) && args.outputImages! > 0 ? args.outputImages! : 1;
  const firstImage = geminiResolutionCost(args.modelId, args.resolution, args.inputImages);
  const additionalImages = geminiResolutionCost(args.modelId, args.resolution, 0) * (outputImages - 1);
  return {
    costUsd: firstImage + additionalImages,
    confidence: 'estimated',
    source: 'catalog-rate',
    quantity: { unit: 'image', value: outputImages },
  };
}

/** Catalog rate for a Veo clip: USD/s × duration. No usage metadata on video. */
export function resolveGeminiVideo(args: {
  modelId?: string;
  resolution?: string;
  durationSeconds?: number;
}): SpendFigure {
  const durationSeconds = args.durationSeconds;
  const costUsd = geminiVideoCost(args.modelId, args.resolution, durationSeconds);
  if (!(costUsd > 0) || durationSeconds === undefined || !Number.isFinite(durationSeconds) || !(durationSeconds > 0)) {
    return unknownFigure('catalog-rate');
  }
  return {
    costUsd,
    confidence: 'estimated',
    source: 'catalog-rate',
    quantity: { unit: 'second', value: durationSeconds },
  };
}

export function resolveRunware(cost: number | undefined): SpendFigure {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
    return unknownFigure('response');
  }
  return { costUsd: cost, confidence: 'exact', source: 'response' };
}

export function resolveCatalogRate(
  model: ProviderModel | undefined,
  durationSeconds?: number,
  outputImages = 1,
  controls: { size?: string; inputImages?: number; audio?: boolean; draft?: boolean; inputMode?: string } = {}
): SpendFigure {
  const rate = controls.inputMode === 'edit' ? (controls.draft ? model?.videoEdit?.draftRate : model?.videoEdit?.rate) : model?.rate;
  if (!rate) return unknownFigure('catalog-rate');
  // Only search when a size was actually given. `size.preset === undefined`
  // is true for every size that has no preset, so with no size chosen this
  // matched the first Runware entry and priced its cheapest tier — the exact
  // fallback the rate type forbids. Latent while every size had a preset.
  const chosen = controls.size === undefined
    ? undefined
    : (controls.inputMode === 'edit' ? model?.videoEdit?.sizes : model?.sizes)?.find(size => size.label === controls.size || size.preset === controls.size);
  // Preset first, then the label's leading tier: Atlas keys its table by API
  // preset, Runware publishes only labels — see sizeRateKey.
  const resolution = chosen ? sizeRateKey(chosen) : undefined;
  const table = controls.audio && rate.audioUsdByResolution ? rate.audioUsdByResolution : rate.usdByResolution;
  const usd = table
    ? (resolution ? table[resolution] : undefined)
    : rate.usd;
  if (usd === undefined || !Number.isFinite(usd) || usd < 0) {
    return unknownFigure('catalog-rate', 'No verified published rate covers the saved output size.');
  }
  let inputCost = 0;
  if (rate.extraInputImageUsd !== undefined) {
    const count = controls.inputImages;
    if (count === undefined || !Number.isInteger(count) || count < 0) {
      return unknownFigure('catalog-rate', 'The reference count is required to estimate this model.');
    }
    inputCost = Math.max(0, count - 1) * rate.extraInputImageUsd;
  }
  if (rate.per === 'second') {
    if (durationSeconds === undefined || !Number.isFinite(durationSeconds) || !(durationSeconds > 0)) return unknownFigure('catalog-rate');
    return {
      costUsd: usd * durationSeconds + inputCost,
      confidence: 'estimated',
      source: 'catalog-rate',
      quantity: { unit: 'second', value: durationSeconds },
    };
  }
  const quantity = rate.per === 'image' && Number.isInteger(outputImages) && outputImages > 0 ? outputImages : 1;
  return {
    costUsd: usd * quantity + inputCost,
    confidence: 'estimated',
    source: 'catalog-rate',
    quantity: { unit: rate.per, value: quantity },
  };
}

export function resolveFree(): SpendFigure {
  return { costUsd: 0, confidence: 'exact', source: 'free', quantity: { unit: 'image', value: 1 } };
}

export interface FalEstimate {
  costUsd: number | null;
  unit?: string;
  quantity?: number;
}

export function resolveFalEstimate(estimate: FalEstimate | null | undefined): SpendFigure {
  if (!estimate || typeof estimate.costUsd !== 'number' || !Number.isFinite(estimate.costUsd)) {
    return unknownFigure('estimate-api');
  }
  const unit = estimate.unit === 'second' || estimate.unit === 'seconds' ? 'second' : estimate.unit === 'video' ? 'video' : 'image';
  return {
    costUsd: estimate.costUsd,
    confidence: 'estimated',
    source: 'estimate-api',
    ...(estimate.quantity !== undefined ? { quantity: { unit, value: estimate.quantity } } : {}),
  };
}

/** fal's own list price for the run, used when the estimate call could not answer. */
export function resolveFalCatalog(endpointId: string, controls: FalRunControls, outputImages = 1): SpendFigure {
  const published = falPublishedCost(endpointId, controls);
  if (!published) return unknownFigure('estimate-api');
  const quantity = published.unit === 'image' && Number.isInteger(outputImages) && outputImages > 0
    ? outputImages
    : published.quantity;
  return {
    costUsd: published.costUsd * quantity / published.quantity,
    confidence: 'estimated',
    source: 'catalog-rate',
    quantity: { unit: published.unit, value: quantity },
  };
}

/**
 * One fal run's cost. fal's estimate applies whatever the account actually
 * pays, so it wins; the published table only fills the gaps it leaves — an
 * endpoint billed per megapixel, a run with no key, a network failure.
 */
export function resolveFalRun(args: {
  estimate: FalEstimate | null | undefined;
  endpointId: string;
  controls: FalRunControls;
  /** Applied only to the published per-image fallback, never a response total. */
  outputImages?: number;
}): SpendFigure {
  const figure = resolveFalEstimate(args.estimate);
  if (figure.costUsd !== null) return figure;
  return resolveFalCatalog(args.endpointId, args.controls, args.outputImages);
}

export function resolveKieDelta(args: {
  before: number | undefined;
  after: number | null;
  sharedWith: number;
}): SpendFigure {
  const { before, after, sharedWith } = args;
  if (before === undefined || after === null) return unknownFigure('balance-delta');
  const delta = before - after;
  if (delta < 0) {
    return unknownFigure('balance-delta', 'The Kie balance rose during this job, so its cost is unknown.');
  }
  if (delta === 0) {
    return unknownFigure('balance-delta', 'The Kie balance did not change, so the cost is unknown.');
  }
  const credits = delta / (sharedWith + 1);
  return {
    costUsd: credits * KIE_USD_PER_CREDIT,
    confidence: 'estimated',
    source: 'balance-delta',
    quantity: { unit: 'credit', value: credits },
    ...(sharedWith > 0
      ? { note: `Balance change shared with ${sharedWith} other Kie job${sharedWith === 1 ? '' : 's'}.` }
      : {}),
  };
}

/**
 * Other Kie jobs whose credits could sit inside this job's before/after window:
 * anything submitted after we read the balance, or anything that succeeded
 * after it. A job still polling only bumps `updatedAt`, which spends nothing,
 * and failed jobs are refunded, so neither counts.
 */
export function kieSharers(jobs: KieJob[], job: KieJob): number {
  return jobs.filter(
    (other) =>
      other.id !== job.id &&
      other.state !== 'fail' &&
      (other.createdAt >= job.createdAt ||
        (other.state === 'success' && other.updatedAt >= job.createdAt))
  ).length;
}

export function resolveHelper(usage: MicroAiUsage): SpendFigure {
  return {
    costUsd: usage.costUsd,
    confidence: 'estimated',
    source: 'catalog-rate',
    quantity: { unit: 'token', value: usage.promptTokens + usage.completionTokens },
  };
}
