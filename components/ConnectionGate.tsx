'use client';

import type { ReactNode } from 'react';

import ConnectKeyCallout from '@/components/ConnectKeyCallout';
import type { EngineId } from '@/lib/engines/registry';

/**
 * The not-connected state, identical for every provider workspace: the callout
 * above the controls it gates, then those controls dimmed and inert with the
 * whole area clickable as a way into the key dialog.
 *
 * It lives in one component because three workspaces used to disagree about
 * what "no key yet" looks like — one dimmed nothing, one only put a button in
 * its header — and a person switching providers should not have to relearn the
 * page.
 */
export default function ConnectionGate({
  provider,
  label,
  storage = 'browser',
  needsKey,
  hasFinishedWork = false,
  onConnect,
  alternative,
  children,
}: {
  provider: EngineId;
  /** The provider's display name, as the callout and the overlay say it. */
  label: string;
  storage?: 'browser' | 'account';
  /** No key stored for this provider, so nothing here can be submitted. */
  needsKey: boolean;
  /**
   * This workspace already holds results. A key can be cleared after a
   * generation lands, and taking the download away from the person who paid for
   * it is worse than letting inert controls sit there, so the gate lifts.
   */
  hasFinishedWork?: boolean;
  onConnect: () => void;
  /** Passed to the callout: a keyless way forward, when the workspace has one. */
  alternative?: ReactNode;
  children: ReactNode;
}) {
  const gated = isGated(needsKey, hasFinishedWork);

  return (
    <>
      {needsKey && (
        <ConnectKeyCallout provider={provider} label={label} storage={storage} onConnect={onConnect} alternative={alternative} />
      )}
      <div className="relative">
        {/* The whole dimmed area is the target: someone who reaches for a control
            that is switched off is asking for the key dialog, so give them that
            instead of a dead click. It precedes the panels so `peer-hover` can
            lift them slightly on hover, and paints above them via z-index. Not a
            tab stop and never ringed — the callout's button is the keyboard
            route, and left focusable this would catch the dialog's focus restore
            and draw a ring around the whole workspace on close. */}
        {gated && (
          <button
            type="button"
            onClick={onConnect}
            aria-label={`Connect your ${label} key to use these controls`}
            tabIndex={-1}
            className="peer absolute inset-0 z-10 w-full cursor-pointer rounded-[var(--radius)] outline-none focus:outline-none focus-visible:outline-none"
          />
        )}
        <div
          inert={gated}
          className={`transition-[opacity,filter] duration-300 ${gated ? 'pointer-events-none opacity-[0.42] saturate-[0.55] peer-hover:opacity-[0.55]' : ''}`}
        >
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * The gating rule itself, exported because a workspace needs the same answer for
 * its prompt panel: a lap of cyan running around a dead control invites an edit
 * that goes nowhere, so `PromptPanel` is paused on exactly this condition.
 */
export function isGated(needsKey: boolean, hasFinishedWork: boolean) {
  return needsKey && !hasFinishedWork;
}
