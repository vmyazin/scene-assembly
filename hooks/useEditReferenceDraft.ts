// hooks/useEditReferenceDraft.ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { emptyEditReferenceDraft, releaseEditReferenceDraft } from '@/lib/providers/edit-references';

/**
 * The edit tray's stills and elements, scoped to one model. A different model
 * reads its slots differently, so a scope change releases the old draft's
 * object URLs and starts empty; unmounting releases whatever is left.
 */
export function useEditReferenceDraft(scope: string | undefined) {
  const [draft, setDraft] = useState(emptyEditReferenceDraft);
  const [draftScope, setDraftScope] = useState(scope);
  const draftRef = useRef(draft);
  if (draftScope !== scope) {
    releaseEditReferenceDraft(draft);
    setDraftScope(scope);
    setDraft(emptyEditReferenceDraft());
  }
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => () => releaseEditReferenceDraft(draftRef.current), []);
  return [draft, setDraft] as const;
}
