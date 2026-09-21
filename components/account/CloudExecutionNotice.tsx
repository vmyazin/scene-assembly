'use client';
import { Cloud, Monitor } from 'lucide-react';
import type { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';
/** One muted line under the generate button, not a callout above the controls.
 *  Where the run happens is a property of the press, so it belongs next to the
 *  cost line; framed as a panel at the top of the page it read as a warning
 *  about the page rather than a choice about this generation. */
export default function CloudExecutionNotice({workspace}:{workspace:ReturnType<typeof useCloudWorkspace>}) {
  if(!workspace.signedIn&&!workspace.uncertain)return null;
  const status=workspace.uncertain&&workspace.cloud?'Account status unavailable'
    :workspace.cloud?(workspace.fakeGeneration?'Local simulation · returns a test fixture, not a transformation':workspace.enabled?'Runs in the background · saves to your account':'Background generation unavailable for this provider')
    :'Runs in this tab · keep it open';
  /** Explain the destination on the switch itself so the notice stays one line. */
  const consequence=workspace.cloud
    ?'In-browser: closing the tab stops the run, and the result stays in this browser instead of your account.'
    :'Background: runs on your saved connection without this tab open, and the result saves to your account.';
  return <div className="text-center text-xs text-[var(--foreground-subtle)]">
    <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      {workspace.cloud?<Cloud size={12} aria-hidden="true"/>:<Monitor size={12} aria-hidden="true"/>}
      {status}
      <button type="button" title={consequence} onClick={workspace.cloud?workspace.useBrowser:workspace.useCloud} className="underline underline-offset-2 transition-colors hover:text-[var(--foreground)]">{workspace.cloud?'Switch to in-browser':'Switch to background'}</button>
    </p>
  </div>;
}
