// lib/analytics/generation-result.ts
import type { ModerationLevel } from '@/lib/moderation/level';
import type { FailureKind } from '@/lib/moderation/classify';

/**
 * One event per finished attempt. Props are ids and outcomes only — never the
 * prompt. Plausible's script is production-only, so a dev session queues
 * nothing and that is expected.
 */
export interface GenerationResultEvent {
  engine: string;
  route: string;
  model: string;
  level: ModerationLevel;
  outcome: 'ok' | FailureKind;
  media: 'image' | 'video';
}

type PlausibleFn = (event: string, options?: { props?: Record<string, string> }) => void;

export function trackGenerationResult(event: GenerationResultEvent): void {
  if (typeof window === 'undefined') return;
  const plausible = (window as Window & { plausible?: PlausibleFn }).plausible;
  if (typeof plausible !== 'function') return;
  const props: Record<string, string> = {
    engine: event.engine,
    route: event.route,
    model: event.model,
    level: event.level,
    outcome: event.outcome,
    media: event.media,
  };
  plausible('generation_result', { props });
}
