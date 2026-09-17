import type { ReactNode } from 'react';

interface GenerationWorkspaceLayoutProps {
  /** Model, source media, and provider controls. */
  setup: ReactNode;
  /** Kept in the output rail so prompt edits stay visually tied to their result. */
  prompt: ReactNode;
  /** Submit action with its cost, progress, execution notice, and retry feedback. */
  actions: ReactNode;
  /** A provider may render one result or a persistent job list here. */
  results: ReactNode;
}

/**
 * Both stuck panels are capped to the screen they have left, so a tall setup
 * column on a short laptop scrolls inside itself rather than hanging its own
 * bottom controls off the end of the viewport, where no scroll can reach them:
 * a stuck panel taller than the screen has no scroll of its own to give.
 */
const setupPanel =
  'lg:sticky lg:top-[var(--workspace-sticky-top)] lg:overflow-y-auto ' +
  'lg:max-h-[calc(100dvh_-_var(--workspace-sticky-top)_-_1rem)]';

/**
 * The prompt parks against the header's own bottom edge rather than a gutter
 * below it, and pays that gutter back as padding inside its scrim — the
 * negative margin leaves the card exactly where it sits at rest. Parked a
 * gutter lower, results climbing past it showed through the strip of bare page
 * between the two stuck things: a bright band flickering under the header on
 * every scroll.
 */
const promptPanel =
  'lg:sticky lg:top-[var(--app-header-height)] lg:-mt-3.5 lg:pt-3.5 lg:overflow-y-auto ' +
  'lg:max-h-[calc(100dvh_-_var(--app-header-height)_-_1rem)]';

/**
 * One composition rule for generation workspaces: configure on the left, then
 * iterate on Prompt -> Generate -> Result/Jobs on the right. On narrow screens the same
 * named slots become a predictable setup -> prompt -> actions -> results stack.
 *
 * From `lg` the two controls — setup on the left, prompt with its Generate
 * button on the right — hold at the top of the viewport while the results
 * scroll past them down to the footer. Everything above Generate is what you
 * change *between* runs, so a growing result rail used to push the controls off
 * screen and made comparing a result against the settings that produced it a
 * round trip back to the top. `--workspace-sticky-top` is the app header's
 * measured height plus a gutter; see `app/globals.css` and the publisher in
 * `components/StudioHeader.tsx`.
 *
 * Two details that make this work rather than merely apply. `items-start`: grid
 * items stretch to their row's height by default, and an item as tall as its
 * track has no room inside it to move, so `sticky` does nothing at all without
 * it. And the prompt block carries the header's own scrim — translucent fill
 * plus blur — because results pass *under* it: every panel surface in this app
 * is near-transparent by design, so with no backdrop an image would read
 * straight through the sentence someone is typing.
 */
export default function GenerationWorkspaceLayout({
  setup,
  prompt,
  actions,
  results,
}: GenerationWorkspaceLayoutProps) {
  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 lg:items-start lg:gap-4">
      <div className={`space-y-3.5 ${setupPanel}`}>{setup}</div>
      <div className="space-y-3.5">
        <div
          className={`space-y-3.5 lg:z-20 lg:rounded-(--radius) lg:bg-[hsl(var(--tint-hue)_38%_5%/0.93)] lg:pb-3.5 lg:backdrop-blur-xl ${promptPanel}`}
        >
          {prompt}
          <div className="space-y-3.5">{actions}</div>
        </div>
        {results}
      </div>
    </div>
  );
}
