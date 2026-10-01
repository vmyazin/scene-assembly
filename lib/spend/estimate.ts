/**
 * What a background job will cost, before it runs.
 *
 * Not a second price list: it is `buildAccountSpendEntry` — the function that
 * files the finished job in the ledger — applied to the result a job of this
 * shape produces (one output, nothing the provider reports afterwards). So an
 * agent's budget is charged the number the ledger will show wherever the ledger
 * prices from a published rate, and `unknown` exactly where the ledger waits for
 * the provider to say (Runware) or never learns (Kie, Cloudflare, Pollinations).
 */
import type { CloudJobRequest } from '../account/contracts';
import { providerLabel, sampleRequest, type AgentProvider, type ModelDescriptor } from '../account/model-schema';
import { buildAccountSpendEntry } from './account';
import { unknownFigure, type SpendFigure } from './resolve';

const UNKNOWN_NOTES: Partial<Record<CloudJobRequest['provider'], string>> = {
  runware: 'Runware reports the price only after the run.',
  kie: 'Kie does not report a per-job price.',
  cloudflare: 'Cloudflare does not report a per-job price.',
  pollinations: 'Pollinations does not report a per-job price.',
};
const GEMINI_NOTE = 'Gemini bills by tokens. This uses its published per-image rate; the final figure comes from the run and can be slightly higher.';

export function estimateCloudJob(request: CloudJobRequest): SpendFigure {
  const entry = buildAccountSpendEntry({ jobId: 'estimate', request, result: { sources: [{}] }, at: 0 });
  if (!entry) return unknownFigure('catalog-rate', 'This job cannot be priced.');
  const figure: SpendFigure = {
    costUsd: entry.costUsd, confidence: entry.confidence, source: entry.source,
    ...(entry.quantity ? { quantity: entry.quantity } : {}), ...(entry.note ? { note: entry.note } : {}),
  };
  if (figure.confidence === 'unknown') return { ...figure, costUsd: null, note: UNKNOWN_NOTES[request.provider] ?? figure.note ?? 'This run has no published price.' };
  if (request.provider === 'gemini') return { ...figure, note: GEMINI_NOTE };
  return figure;
}

export interface UnknownPriceProvider { provider: AgentProvider; label: string; scope: 'all' | 'some' }

/** Providers a default grant refuses, for the consent screen's "Affects:" line. */
export function unknownPriceProviders(models: ModelDescriptor[]): UnknownPriceProvider[] {
  const tally = new Map<AgentProvider, { unknown: number; total: number }>();
  for (const model of models) for (const mode of model.modes) {
    const counts = tally.get(model.provider) ?? { unknown: 0, total: 0 };
    counts.total += 1;
    if (estimateCloudJob(sampleRequest(model, mode)).confidence === 'unknown') counts.unknown += 1;
    tally.set(model.provider, counts);
  }
  return [...tally]
    .filter(([, counts]) => counts.unknown > 0)
    .map(([provider, counts]) => ({ provider, label: providerLabel(provider), scope: counts.unknown === counts.total ? 'all' : 'some' }));
}
