import { resolveFalVariant } from '@/lib/fal/catalog';
import type { FalInputMode, FalMediaType } from '@/lib/fal/types';
import { falPublishedCost, falPromotionNote, type FalPublishedCost } from '@/lib/spend/rates';

/**
 * What one run of a fal model costs, addressed the way a workspace holds it.
 *
 * Separate from `lib/fal/pricing.ts`, which is deliberately dependency-free so
 * the estimate route and client-side capture can share it; this one reaches for
 * the catalog and the rate table, so it stays on the client side of that line.
 *
 * The endpoint lookup lives here rather than in the caller for a specific
 * reason: a component that reads `variant.endpointId` during render and hands
 * it to an imported helper makes the React compiler treat `variant` as possibly
 * mutated, and it then skips optimizing that component altogether. Taking the
 * model id and mode keeps the variant object out of the caller's render, and
 * taking the controls as separate primitives avoids the other half of the same
 * trap — an options object built at the call site.
 */
export function falRunCost(
  modelId: string,
  mediaType: FalMediaType,
  inputMode: FalInputMode,
  resolution?: string,
  audio?: boolean,
  durationSeconds?: number
): FalPublishedCost | null {
  // resolveFalVariant throws for a model that does not serve this mode, which
  // a workspace can hold for one render while the two settle. This sits on the
  // render path of a button, so it answers "no figure" rather than taking the
  // page down over a combination that is about to stop existing.
  let endpointId: string | undefined;
  try {
    endpointId = resolveFalVariant(modelId, mediaType, inputMode).endpointId;
  } catch {
    return null;
  }
  return falPublishedCost(endpointId, { resolution, audio, durationSeconds });
}

/** Sale copy follows the selected endpoint and expires with the shared rate. */
export function falRunPromotion(modelId: string, mediaType: FalMediaType, inputMode: FalInputMode): string | null {
  try {
    return falPromotionNote(resolveFalVariant(modelId, mediaType, inputMode).endpointId);
  } catch {
    return null;
  }
}
