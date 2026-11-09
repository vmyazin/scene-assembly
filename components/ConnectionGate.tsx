'use client';

import type { ReactNode } from 'react';

import ConnectKeyCallout from '@/components/ConnectKeyCallout';
import type { EngineId } from '@/lib/engines/registry';

/**
 * The not-connected state, identical for every provider workspace: the callout
 * above a workspace that stays fully usable. The key is asked for at Generate
 * (`ConnectToGenerateButton`), once there is a prompt to run.
 *
 * It lives in one component because three workspaces used to disagree about
 * what "no key yet" looks like, and a person switching providers should not
 * have to relearn the page.
 *
 * Nothing here is dimmed or inert. It used to be, and a visitor could not write
 * a prompt until they had gone and fetched a paid key; writing first gives them
 * a reason to connect, and the draft store keeps the text across providers.
 */
export default function ConnectionGate({
  provider,
  label,
  storage = 'browser',
  needsKey,
  onConnect,
  alternative,
  children,
}: {
  provider: EngineId;
  /** The provider's display name, as the callout says it. */
  label: string;
  storage?: 'browser' | 'account';
  /** No key stored for this provider, so nothing here can be submitted yet. */
  needsKey: boolean;
  onConnect: () => void;
  /** Passed to the callout: a keyless way forward, when the workspace has one. */
  alternative?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {needsKey && (
        <ConnectKeyCallout provider={provider} label={label} storage={storage} onConnect={onConnect} alternative={alternative} />
      )}
      <div>{children}</div>
    </>
  );
}
