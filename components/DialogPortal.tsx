// components/DialogPortal.tsx
'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Mount a modal on `document.body`.
 *
 * In-tree `position: fixed` overlays lose to `GenerationWorkspaceLayout`'s
 * prompt column: that column is `lg:sticky lg:z-20` with `backdrop-blur`, which
 * is a stacking context. A library dialog rendered from the setup column (sticky,
 * z-index auto) keeps its own `z-[60]` *inside* that left-column context, so
 * Prompt / Generate paint on top of the modal no matter how high the overlay's
 * z-index is. The same trap exists inside `<main class="relative z-10">` for any
 * dialog opened from a workspace control.
 *
 * Portaling to body puts the overlay in the root stacking context with the
 * lightbox (`z-[80]`) and command palette (`z-70`). Callers that already portal
 * a dialog to body are harmless — a nested portal still lands on body.
 */
export default function DialogPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
