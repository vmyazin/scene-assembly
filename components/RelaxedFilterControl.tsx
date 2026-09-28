// components/RelaxedFilterControl.tsx
'use client';

import SegmentedToggleGroup from '@/components/SegmentedToggleGroup';
import RelaxedConsentDialog from '@/components/RelaxedConsentDialog';
import type { useRelaxedFilter } from '@/lib/moderation/use-relaxed-filter';

const TIP =
  "Relaxed filter: fewer false blocks on creative work. The provider's core safety rules still apply.";

type Filter = ReturnType<typeof useRelaxedFilter>;

/**
 * Standard | Relaxed. The workspace owns the hook so submit reads the same
 * level the control just confirmed.
 */
export default function RelaxedFilterControl({ filter }: { filter: Filter }) {
  if (!filter.offered) return null;
  return (
    <div className="space-y-2" title={TIP}>
      <span className="block text-sm font-medium text-[var(--foreground)]">Filter</span>
      <SegmentedToggleGroup
        label="Filter"
        options={[
          { label: 'Standard', value: 'standard' },
          { label: 'Relaxed', value: 'relaxed', disabled: filter.locked },
        ]}
        value={filter.effective}
        onChange={(value) => filter.choose(value === 'relaxed' ? 'relaxed' : 'standard')}
      />
      <p className="text-xs text-[var(--foreground-subtle)]">{TIP}</p>
      {filter.capability.caveat && (
        <p className="text-xs text-[var(--foreground-subtle)]">{filter.capability.caveat}</p>
      )}
      {filter.lockedByReferences && (
        <p className="text-xs text-[var(--foreground-muted)]">Relaxed is off while references are attached.</p>
      )}
      {filter.floorNote && <p className="text-xs text-[var(--foreground-muted)]">{filter.floorNote}</p>}
      <RelaxedConsentDialog
        open={filter.open}
        error={filter.consentError}
        onConfirm={() => void filter.confirm()}
        onCancel={filter.cancel}
      />
    </div>
  );
}
