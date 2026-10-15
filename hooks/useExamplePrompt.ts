// hooks/useExamplePrompt.ts
'use client';

import { useEffect, useRef, useState } from 'react';

import { requestExamplePrompt } from '@/lib/micro-ai/browser';

/**
 * Fills the prompt with an example for a feature. Served by the shared
 * micro-AI tier when the deployment has one, otherwise by the visitor's own
 * Gemini key; the route says which when neither is available.
 *
 * A workspace left mid-request is not written to: the answer, the error and
 * the busy flag are all dropped once it unmounts.
 */
export function useExamplePrompt({
  featureId,
  apiKey,
  onStart,
  onPrompt,
  onError,
}: {
  featureId: string;
  apiKey: string;
  onStart?: () => void;
  onPrompt: (prompt: string) => void;
  onError: (message: string) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const generate = async () => {
    setGenerating(true);
    onStart?.();
    try {
      const prompt = await requestExamplePrompt(featureId, apiKey);
      if (mountedRef.current) onPrompt(prompt);
    } catch (error) {
      if (mountedRef.current) onError(error instanceof Error ? error.message : 'Could not generate an example prompt.');
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  };

  return { generating, generate };
}
