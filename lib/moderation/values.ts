// lib/moderation/values.ts
import { moderationCapability, type ModerationRoute } from './capabilities';
import { isModerationLevel } from './level';

/**
 * Client `values` may carry `moderation: standard|relaxed` on a route that
 * can honor it. The provider keys themselves are not client settings — the
 * adapter writes them — so a request that tries to set them directly is
 * rejected. Kie Veo `enableFallback: false` is the historical default and
 * stays allowed; `true` does not.
 */
const SERVER_OWNED = ['safety_tolerance', 'enable_safety_checker', 'real_person', 'enable_fallback'] as const;

const KIE_CHECKER_MODELS = (id: string) =>
  id === 'flux-2-pro' ||
  id.startsWith('flux-2/pro') ||
  id === 'z-image' ||
  id === 'imagen-4-ultra' ||
  id === 'google/imagen4-ultra';

export function moderationValueError(
  route: ModerationRoute,
  values: Record<string, unknown>
): string | null {
  const capability = moderationCapability(route);
  if ('moderation' in values) {
    if (!capability.relaxable) return '"moderation" is not a setting this model accepts.';
    if (!isModerationLevel(values.moderation)) return 'Filter must be Standard or Relaxed.';
  }
  for (const key of SERVER_OWNED) {
    if (key in values) return `"${key}" cannot be set on this request.`;
  }
  if (values.mode === 'spicy') return 'That generation mode is not available.';
  if (values.enableFallback === true) return 'Fallback cannot be enabled.';
  if ('nsfw_checker' in values && route.provider === 'kie' && !KIE_CHECKER_MODELS(route.modelId)) {
    return '"nsfw_checker" is not a setting this model accepts.';
  }
  if ('nsfw_checker' in values && route.provider !== 'kie') {
    return '"nsfw_checker" is not a setting this provider accepts.';
  }
  return null;
}
