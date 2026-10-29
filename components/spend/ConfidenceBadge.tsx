import { STATUS_TONE_CLASSES, type StatusTone } from '@/components/StatusPill';
import type { SpendConfidence, SpendSource } from '@/lib/spend/ledger';

const LABELS: Record<SpendConfidence, string> = { exact: 'Exact', estimated: 'Estimated', unknown: 'Unknown' };

const SOURCES: Record<SpendSource, string> = {
  response: 'Cost reported by the provider in its response.',
  'usage-metadata': 'Priced from the token counts the provider reported.',
  'estimate-api': "Estimated by the provider's pricing endpoint.",
  'balance-delta': 'Credit balance before the run minus the balance after.',
  'catalog-rate': 'Published list price times the quantity generated.',
  free: 'This generation is free.',
};

const TONES: Record<SpendConfidence, StatusTone> = { exact: 'success', estimated: 'warning', unknown: 'neutral' };

export default function ConfidenceBadge({ confidence, source, note }: { confidence: SpendConfidence; source: SpendSource; note?: string }) {
  return (
    <span
      title={note ? `${SOURCES[source]} ${note}` : SOURCES[source]}
      className={`inline-flex items-center rounded-full border px-1.5 py-px text-[0.6875rem] font-medium ${STATUS_TONE_CLASSES[TONES[confidence]]}`}
    >
      {LABELS[confidence]}
    </span>
  );
}
