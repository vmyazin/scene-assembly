// hooks/useModelControlValues.ts
'use client';

import { useState } from 'react';
import { carryOverValues, type CarryOverField, type DraftValue } from '@/lib/draft/carry-over';
import { useDraftStore } from '@/store/useDraftStore';

/**
 * A workspace's control values, one set per model scope. A scope nobody has
 * touched starts from the model's defaults with whatever the person last chose
 * carried over, so the next model inherits every value it can express.
 *
 * `update` merges a patch into this scope and remembers it globally. Pass
 * `remembered` when the scope should keep more than the draft store does —
 * a value derived for display that must not leak into other models.
 */
export function useModelControlValues(
  scope: string,
  fields: CarryOverField[],
  defaults: Record<string, DraftValue>,
) {
  const controlValues = useDraftStore((state) => state.controlValues);
  const [valuesByScope, setValuesByScope] = useState<Record<string, Record<string, DraftValue>>>({});
  const values = valuesByScope[scope] ?? carryOverValues(fields, defaults, controlValues);

  const update = (patch: Record<string, DraftValue>, remembered: Record<string, DraftValue> = patch) => {
    setValuesByScope((current) => ({ ...current, [scope]: { ...values, ...patch } }));
    useDraftStore.getState().rememberControlValues(remembered);
  };

  return { values, update, controlValues };
}
