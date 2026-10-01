// lib/analytics/generation-result.ts
import type { ModerationLevel } from '@/lib/moderation/level';
import { classifyFailure, type FailureKind } from '@/lib/moderation/classify';

/**
 * `generation_result` is one event per finished attempt. Props are ids and
 * outcomes only — never the prompt. Plausible's script is production-only, so
 * a dev session queues nothing and that is expected.
 *
 * A queued job is not finished when the provider returns a request id. Counting
 * that moment as `ok` made a later content-filter refusal look like a success.
 * Acceptance is `generation_submitted`. The result waits for a terminal state.
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

/** The level stored on the job at submit time, not the toggle the person moved later. */
export function submittedModerationLevel(
  values: { moderation?: unknown } | undefined
): ModerationLevel {
  return values?.moderation === 'relaxed' ? 'relaxed' : 'standard';
}

function emit(name: string, props: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  const plausible = (window as Window & { plausible?: PlausibleFn }).plausible;
  if (typeof plausible !== 'function') return;
  plausible(name, { props });
}

export function trackGenerationSubmitted(event: Omit<GenerationResultEvent, 'outcome'>): void {
  emit('generation_submitted', {
    engine: event.engine,
    route: event.route,
    model: event.model,
    level: event.level,
    media: event.media,
  });
}

export function trackGenerationResult(event: GenerationResultEvent): void {
  emit('generation_result', {
    engine: event.engine,
    route: event.route,
    model: event.model,
    level: event.level,
    outcome: event.outcome,
    media: event.media,
  });
}

/** Terminal poll outcome. `level` is whatever the job was submitted with. */
export function trackQueuedTerminal(input: {
  engine: string;
  route: string;
  model: string;
  media: 'image' | 'video';
  controlValues?: { moderation?: unknown };
  succeeded: boolean;
  error?: string;
}): void {
  trackGenerationResult({
    engine: input.engine,
    route: input.route,
    model: input.model,
    media: input.media,
    level: submittedModerationLevel(input.controlValues),
    outcome: input.succeeded ? 'ok' : classifyFailure(input.error).kind,
  });
}
