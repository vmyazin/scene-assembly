import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CloudExecutionNotice from '@/components/account/CloudExecutionNotice';
import type { useCloudWorkspace } from '@/lib/account/useCloudWorkspace';

type Workspace = ReturnType<typeof useCloudWorkspace>;

/**
 * "Switch to in-browser" asked for a decision about speed, cost, privacy and
 * where the result ends up. The switch tooltip explains the destination without
 * taking another line in the workspace.
 */
function workspaceOn(cloud: boolean) {
  return {
    signedIn: true,
    uncertain: false,
    cloud,
    enabled: true,
    connected: true,
    checking: false,
    useBrowser: () => undefined,
    useCloud: () => undefined,
  } as unknown as Workspace;
}

describe('CloudExecutionNotice', () => {
  it('identifies fixture generation before a simulated run', () => {
    render(<CloudExecutionNotice workspace={{...workspaceOn(true), fakeGeneration:true}} />);
    expect(screen.getByText(/Local simulation.*test fixture, not a transformation/)).toBeInTheDocument();
    expect(screen.queryByText('Runs in the background · saves to your account')).not.toBeInTheDocument();
  });
  it('says what going in-browser costs before the switch is taken', () => {
    render(<CloudExecutionNotice workspace={workspaceOn(true)} />);

    const button = screen.getByRole('button', { name: 'Switch to in-browser' });
    const explanation = 'In-browser: closing the tab stops the run, and the result stays in this browser instead of your account.';
    expect(button).toHaveAttribute('title', explanation);
    expect(button).toHaveAccessibleDescription(explanation);
    expect(screen.queryByText(/^In-browser:/)).not.toBeInTheDocument();
  });

  it('says what going to the background buys', () => {
    render(<CloudExecutionNotice workspace={workspaceOn(false)} />);

    const button = screen.getByRole('button', { name: 'Switch to background' });
    const explanation = 'Background: runs on your saved connection without this tab open, and the result saves to your account.';
    expect(button).toHaveAttribute('title', explanation);
    expect(button).toHaveAccessibleDescription(explanation);
    expect(screen.queryByText(/^Background:/)).not.toBeInTheDocument();
  });

  it('stays out of the way when there is no account to run against', () => {
    const { container } = render(
      <CloudExecutionNotice workspace={{ ...workspaceOn(false), signedIn: false } as Workspace} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
