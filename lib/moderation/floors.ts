// lib/moderation/floors.ts
import { moderationLevel, type ModerationLevel } from './level';

/**
 * Hard floor for minors in a suggestive context. Runs before a request is
 * sent. A minor mention on its own does not block — it forces Standard when
 * Relaxed was asked for — because the block is the combination, not the word
 * "child" in a playground scene.
 *
 * Browser-direct fal and Gemini calls only see the client copy of this check.
 * The server routes and the Worker run it as well.
 */
const MINOR =
  /\b(?:child|children|kid|kids|teen(?:ager)?s?|schoolgirl|schoolboy|underage|pre-?teen|loli\w*|toddler|infant)\b/i;

const YEAR_OLD = /\b(\d{1,2})\s*[- ]?(?:years?|yrs?)[- ]?old\b/gi;
const YEAR_SHORT = /\b(\d{1,2})\s*yo\b/gi;

const SUGGESTIVE =
  /\b(?:nude|nudity|naked|nsfw|lingerie|underwear|bikini|swimwear|swimsuit|erotic|explicit|porn|sexual|sex)\b/i;

export interface FloorInspection {
  /** Minor indicator together with a nudity / sexual / swimwear term. */
  blocked: boolean;
  /** A minor indicator while Relaxed was requested. The request continues at Standard. */
  forceStandard: boolean;
  message?: string;
  note?: string;
}

export const FLOOR_BLOCK_MESSAGE =
  "Scene Assembly doesn't generate this (minors in a suggestive context / sexualized real people). Relaxed filter doesn't change this.";

export const FLOOR_STANDARD_NOTE =
  'Relaxed is off for this prompt because it mentions a minor. The standard filter stays on.';

function mentionsMinor(prompt: string): boolean {
  if (MINOR.test(prompt)) return true;
  for (const pattern of [YEAR_OLD, YEAR_SHORT]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(prompt);
    while (match) {
      const age = Number(match[1]);
      if (age < 18) return true;
      match = pattern.exec(prompt);
    }
  }
  return false;
}

export function inspectPrompt(prompt: string, level: unknown = 'standard'): FloorInspection {
  const minor = mentionsMinor(prompt);
  const suggestive = SUGGESTIVE.test(prompt);
  if (minor && suggestive) {
    return { blocked: true, forceStandard: true, message: FLOOR_BLOCK_MESSAGE };
  }
  if (minor && moderationLevel(level) === 'relaxed') {
    return { blocked: false, forceStandard: true, note: FLOOR_STANDARD_NOTE };
  }
  return { blocked: false, forceStandard: false };
}

/** Level actually applied: references and the minor floor both pin Standard. */
export function effectiveModerationLevel(args: {
  level: unknown;
  prompt: string;
  hasReferences: boolean;
}): ModerationLevel {
  if (args.hasReferences) return 'standard';
  const floor = inspectPrompt(args.prompt, args.level);
  if (floor.blocked || floor.forceStandard) return 'standard';
  return moderationLevel(args.level);
}
