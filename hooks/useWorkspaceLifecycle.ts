// hooks/useWorkspaceLifecycle.ts
'use client';

import { useEffect, useRef } from 'react';
import { useDraftStore } from '@/store/useDraftStore';

/**
 * Claims the shared prompt field for this kind of work, dropping a prompt
 * written for the other kind. Call it ahead of every other mount effect in the
 * workspace, so a stale prompt cannot outlive this line and block what those
 * effects set.
 */
export function usePromptScope(scope: 'image' | 'video') {
  useEffect(() => {
    useDraftStore.getState().enterPromptScope(scope);
  }, [scope]);
}

/** A stricter model must not keep more references than it accepts. */
export function useReferenceLimit(maxImages: number) {
  useEffect(() => {
    useDraftStore.getState().limitReferences(maxImages);
  }, [maxImages]);
}

/** Removes the draft reference at a stack position, as `ReferenceStack` reports it. */
export function removeReferenceAt(index: number) {
  const reference = useDraftStore.getState().references[index];
  if (reference) useDraftStore.getState().removeReference(reference.id);
}

/** False once the workspace unmounts, so a late await does not set state on it. */
export function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}
