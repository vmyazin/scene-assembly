// lib/moderation/classify.ts
import { RELAXABLE_ENGINE_LIST, moderationCapability, type ModerationRoute } from './capabilities';
import { FLOOR_BLOCK_MESSAGE } from './floors';
import type { ModerationLevel } from './level';

export type FailureKind = 'policy' | 'floor' | 'other';

/**
 * Provider text → why it stopped. Policy is a host or model filter. Floor is
 * our own refusal. Anything else (a bad key, a 503, a rejected control) stays
 * `other` so auto-retry can still tell a blip from a decision.
 */
const POLICY =
  /image_safety|image_prohibited_content|prohibited_content|raimediafiltered|moderation_blocked|content policy|content filter|safety filter|safety checker|\bsafety\b|\bnsfw\b/i;

export function classifyFailure(message: string | null | undefined): { kind: FailureKind } {
  const text = message ?? '';
  if (!text.trim()) return { kind: 'other' };
  if (text.includes(FLOOR_BLOCK_MESSAGE) || /minors in a suggestive context/i.test(text)) {
    return { kind: 'floor' };
  }
  if (POLICY.test(text)) return { kind: 'policy' };
  return { kind: 'other' };
}

export interface RefusalContext {
  providerLabel: string;
  modelLabel: string;
  level: ModerationLevel;
  route: ModerationRoute;
  /** References already forced Standard, so "try Relaxed" would not change the request. */
  hasReferences?: boolean;
}

export interface RefusalPresentation {
  kind: FailureKind;
  message: string;
  offerTryRelaxed: boolean;
}

/**
 * The four sentences the spec asks for. Returns null when the failure is not
 * a filter decision, so the caller keeps the provider's own message.
 */
export function refusalPresentation(
  raw: string | null | undefined,
  ctx: RefusalContext
): RefusalPresentation | null {
  const kind = classifyFailure(raw).kind;
  if (kind === 'other') return null;
  if (kind === 'floor') {
    return { kind, message: FLOOR_BLOCK_MESSAGE, offerTryRelaxed: false };
  }
  const capability = moderationCapability(ctx.route);
  if (capability.relaxable && ctx.level === 'standard' && !ctx.hasReferences) {
    return {
      kind,
      message: `${ctx.providerLabel} blocked this under its content filter. Relaxed filter may let legitimate creative work through.`,
      offerTryRelaxed: true,
    };
  }
  if (capability.relaxable && ctx.level === 'relaxed') {
    return {
      kind,
      message: `${ctx.providerLabel} still blocked this with Relaxed filter on. That's the model's core policy and can't be relaxed. Try rephrasing, or use another engine.`,
      offerTryRelaxed: false,
    };
  }
  return {
    kind,
    message: `${ctx.modelLabel}'s own safety filter blocked this. Scene Assembly can't adjust it for this engine. Engines with Relaxed filter: ${RELAXABLE_ENGINE_LIST}.`,
    offerTryRelaxed: false,
  };
}
