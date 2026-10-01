// lib/moderation/capabilities.ts
import { moderationLevel, type ModerationLevel } from './level';

/**
 * Which routes can ask a host for a less-strict setting, and the one key that
 * changes. Standard leaves the payload alone except where today's catalog
 * already sends a default (Kie's checker). Relaxed writes only that key.
 *
 * Ofox / Seedance BytePlus routing is intentionally absent: it is a later
 * phase, and the contract risk is not a v1 knob.
 */
export interface ModerationRoute {
  provider: string;
  /** Catalog id (`flux-2-pro`) or the vendor id the adapter actually posts. */
  modelId: string;
  /** fal publishes the real name on the endpoint, not the catalog id. */
  endpointId?: string;
}

export interface ModerationCapability {
  relaxable: boolean;
  /** Provider field. Absent when this route has nothing to change. */
  key?: string;
  relaxedValue?: string | boolean;
  /**
   * Sent on Standard because the app already sends it today. Omitting it
   * would make Standard stricter or looser than the current default.
   */
  standardValue?: string | boolean;
  /** Shown under the toggle. fal Wan ignores the flag unless the account is authorized. */
  caveat?: string;
  /**
   * Field that used to follow this key in the catalog. Keeping that slot is
   * what makes a Standard payload byte-identical after the control was removed.
   */
  beforeKey?: string;
  label: string;
}

interface RouteRule {
  provider: string;
  test: (modelId: string, endpointId?: string) => boolean;
  relaxable: boolean;
  key: string;
  relaxedValue?: string | boolean;
  standardValue?: string | boolean;
  caveat?: string;
  beforeKey?: string;
  label: string;
}

const kieChecker = (id: string) =>
  id === 'flux-2-pro' || id.startsWith('flux-2/pro') || id === 'z-image';

const kieImagen = (id: string) => id === 'imagen-4-ultra' || id === 'google/imagen4-ultra';

const RULES: RouteRule[] = [
  {
    provider: 'fal',
    test: (id, endpoint) => id === 'nano-banana-2' || (endpoint ?? '').includes('nano-banana-2'),
    relaxable: true,
    key: 'safety_tolerance',
    relaxedValue: '6',
    label: 'fal Nano Banana 2',
  },
  {
    provider: 'fal',
    test: (id, endpoint) =>
      id === 'veo-3-1' || id === 'veo-3-1-fast' || /veo3\.1/.test(endpoint ?? ''),
    relaxable: true,
    key: 'safety_tolerance',
    relaxedValue: '6',
    label: 'fal Veo 3.1',
  },
  {
    provider: 'fal',
    test: (id, endpoint) => id === 'wan-2-7' || (endpoint ?? '').includes('wan/v2.7'),
    relaxable: true,
    key: 'enable_safety_checker',
    relaxedValue: false,
    caveat: 'May have no effect unless your fal account is authorized to turn the checker off.',
    label: 'fal Wan 2.7',
  },
  {
    provider: 'kie',
    test: kieChecker,
    relaxable: true,
    key: 'nsfw_checker',
    relaxedValue: false,
    standardValue: true,
    beforeKey: 'seed',
    label: 'Kie FLUX.2 Pro and Z-Image',
  },
  {
    provider: 'kie',
    test: kieImagen,
    relaxable: false,
    key: 'nsfw_checker',
    standardValue: true,
    label: 'Kie Imagen 4 Ultra',
  },
  {
    provider: 'comet',
    test: (id) => id === 'gpt-image-2',
    relaxable: true,
    key: 'moderation',
    relaxedValue: 'low',
    label: 'Comet GPT Image 2',
  },
  {
    provider: 'atlas',
    test: (id) => id === 'black-forest-labs/flux-schnell',
    relaxable: true,
    key: 'enable_safety_checker',
    relaxedValue: false,
    label: 'Atlas FLUX.1 schnell',
  },
];

const NONE: ModerationCapability = { relaxable: false, label: '' };

export function moderationCapability(route: ModerationRoute): ModerationCapability {
  const rule = RULES.find(
    (candidate) => candidate.provider === route.provider && candidate.test(route.modelId, route.endpointId)
  );
  if (!rule) return NONE;
  return {
    relaxable: rule.relaxable,
    key: rule.key,
    relaxedValue: rule.relaxedValue,
    standardValue: rule.standardValue,
    caveat: rule.caveat,
    beforeKey: rule.beforeKey,
    label: rule.label,
  };
}

/** Named in refusal copy for routes that have no knob of their own. */
export const RELAXABLE_ENGINE_LIST =
  'fal Nano Banana 2, fal Veo 3.1, fal Wan 2.7, Kie FLUX.2 Pro, Kie Z-Image, Comet GPT Image 2, and Atlas FLUX.1 schnell';

export interface ApplyModerationArgs {
  provider: string;
  modelId: string;
  endpointId?: string;
  level: ModerationLevel;
  /** Any reference image or source video. Relaxed is text-only. */
  hasReferences: boolean;
}

/**
 * Writes the one documented key, or the Standard default the catalog already
 * sent. Does not copy `moderation` itself onto the provider body — Comet's
 * provider field is also called `moderation`, and it means `low` | `auto`.
 */
export function applyProviderModeration<T extends Record<string, unknown>>(
  payload: T,
  args: ApplyModerationArgs
): T {
  const next = stripLockedModerationKeys(payload);
  const capability = moderationCapability(args);
  if (!capability.key) return next;
  const relaxed = args.level === 'relaxed' && capability.relaxable && !args.hasReferences;
  if (relaxed && capability.relaxedValue !== undefined) {
    return writeModerationKey(next, capability.key, capability.relaxedValue, capability.beforeKey);
  }
  if (capability.standardValue !== undefined) {
    return writeModerationKey(next, capability.key, capability.standardValue, capability.beforeKey);
  }
  return next;
}

/**
 * Inserts the provider key without disturbing the order of the keys around it.
 * `beforeKey` is the field that used to follow it in the catalog.
 */
function writeModerationKey<T extends Record<string, unknown>>(
  payload: T,
  key: string,
  value: string | boolean,
  beforeKey?: string
): T {
  const entries = Object.entries(payload).filter(([name]) => name !== key);
  const index = beforeKey ? entries.findIndex(([name]) => name === beforeKey) : -1;
  const pair: [string, unknown] = [key, value];
  if (index >= 0) entries.splice(index, 0, pair);
  else entries.push(pair);
  return Object.fromEntries(entries) as T;
}

/**
 * Knobs that must never turn on. Stripped rather than honored, including when
 * a client sends them beside an otherwise valid request.
 */
export function stripLockedModerationKeys<T extends Record<string, unknown>>(payload: T): T {
  let next: Record<string, unknown> = payload;
  const drop = (key: string) => {
    if (!(key in next)) return;
    const copy = { ...next };
    delete copy[key];
    next = copy;
  };
  if ('real_person' in next) drop('real_person');
  if ('enable_fallback' in next) drop('enable_fallback');
  if (next.mode === 'spicy') drop('mode');
  if (next.enableFallback === true) next = { ...next, enableFallback: false };
  return next as T;
}

/**
 * Veo still sends the historical default `false`, in the slot the removed
 * Enable fallback control occupied: after `watermark` when that text is set,
 * otherwise after the aspect ratio. `true` is never forwarded.
 */
export function lockKieVeoFallback<T extends Record<string, unknown>>(payload: T, protocol: string): T {
  if (protocol !== 'veo') return payload;
  const entries = Object.entries(payload).filter(([key]) => key !== 'enableFallback');
  const watermark = entries.findIndex(([key]) => key === 'watermark');
  const aspect = entries.findIndex(([key]) => key === 'aspect_ratio');
  const at = watermark >= 0 ? watermark + 1 : aspect >= 0 ? aspect + 1 : entries.length;
  entries.splice(at, 0, ['enableFallback', false]);
  return Object.fromEntries(entries) as T;
}

export function applyModerationLevel(
  payload: Record<string, unknown>,
  args: Omit<ApplyModerationArgs, 'level'> & { level: unknown; prompt?: string }
): Record<string, unknown> {
  return applyProviderModeration(payload, { ...args, level: moderationLevel(args.level) });
}
