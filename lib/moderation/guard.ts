// lib/moderation/guard.ts
import { NextResponse } from 'next/server';

import { serverHonorsRelaxed } from './server-flag';
import { effectiveModerationLevel, inspectPrompt } from './floors';
import type { ModerationLevel } from './level';

/** 400 when the prompt hits the minor floor. Null when the request may proceed. */
export function floorRejection(prompt: string): NextResponse | null {
  const floor = inspectPrompt(prompt);
  if (!floor.blocked || !floor.message) return null;
  return NextResponse.json({ success: false, error: floor.message }, { status: 400 });
}

/**
 * Level a Next route should hand the adapter. The rollout flag and the
 * reference / minor floors all collapse to Standard before any provider key
 * is written.
 */
export async function honoredModeration(args: {
  requested: unknown;
  prompt: string;
  hasReferences: boolean;
  request?: Request;
}): Promise<ModerationLevel> {
  const requested = (await serverHonorsRelaxed(args.request)) ? args.requested : 'standard';
  return effectiveModerationLevel({
    level: requested,
    prompt: args.prompt,
    hasReferences: args.hasReferences,
  });
}
