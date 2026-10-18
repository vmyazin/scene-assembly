// components/ImageWorkspaceLayout.tsx
import type { ReactNode } from 'react';

interface ImageWorkspaceLayoutProps {
  /** Engine and model: the choice that changes price and quality most. */
  rail: ReactNode;
  /** The rail folded to a strip, shown instead of `rail` from `lg` up. */
  collapsedRail: ReactNode;
  collapsed: boolean;
  /**
   * The main column, usually an `ImageMainStack`. A separate child so the
   * caller can wrap it alone in `ConnectionGate`: the rail must stay usable
   * without a key, or a guest could not switch to a free engine or compare
   * models and prices before connecting one (UX audit H1).
   */
  children: ReactNode;
}

/**
 * The image workspace from `lg` up: a narrow rail for engine and model, and a
 * main column where the prompt sits over the results (UX audit L1, variant G
 * in `design-explorations/image-workspace-layout-G.reference.html`).
 *
 * It replaced `GenerationWorkspaceLayout` here, whose even split gave a setup
 * column half the screen and left a result 265–344px wide on a 1440px display.
 * The video workspaces keep that layout: their setup carries source media and
 * many more controls.
 *
 * The rail sticks and scrolls inside itself, for the same reason the setup
 * column did: Atlas lists twenty image models, and a stuck panel taller than
 * the screen has no scroll of its own to give. Below `lg` everything stacks in
 * reading order, rail first, and the collapse toggle does not apply.
 */
export default function ImageWorkspaceLayout({ rail, collapsedRail, collapsed, children }: ImageWorkspaceLayoutProps) {
  return (
    <div
      className={`grid grid-cols-1 gap-3.5 lg:items-start lg:gap-4 ${
        collapsed ? 'lg:grid-cols-[3.5rem_minmax(0,1fr)]' : 'lg:grid-cols-[18rem_minmax(0,1fr)]'
      }`}
    >
      <div className="lg:sticky lg:top-[var(--workspace-sticky-top)] lg:max-h-[calc(100dvh_-_var(--workspace-sticky-top)_-_1rem)] lg:overflow-y-auto">
        <div className={collapsed ? 'lg:hidden' : undefined}>{rail}</div>
        {collapsed && <div className="hidden lg:block">{collapsedRail}</div>}
      </div>
      {/* Spaced like the stack inside it: `ConnectionGate` renders its key
          notice and the gated column as siblings here. */}
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

/**
 * The main column's order: source images, then the prompt with Generate
 * beside it on a wide screen, then the settings chips, then the results.
 */
export function ImageMainStack({
  references,
  prompt,
  actions,
  chips,
  results,
}: {
  /** Source images for editing modes, above the prompt they belong to. */
  references?: ReactNode;
  prompt: ReactNode;
  /** Generate, its cost and its feedback. */
  actions: ReactNode;
  /** Settings that rarely change between runs, folded into chips. */
  chips?: ReactNode;
  results: ReactNode;
}) {
  return (
    <div className="space-y-3">
      {references}
      {/* The actions column stretches to the prompt panel and Generate sits on
          its foot, lined up with the bottom of what it submits. Its price,
          notice and last error move above it there (`order-last` on the
          button); on a phone they stay under it, in reading order. */}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,1fr)_13rem]">
        {prompt}
        <div className="flex flex-col gap-1.5 lg:justify-end lg:[&>.btn-primary]:order-last">{actions}</div>
      </div>
      {chips && <div className="flex flex-wrap items-center gap-2">{chips}</div>}
      {results}
    </div>
  );
}
