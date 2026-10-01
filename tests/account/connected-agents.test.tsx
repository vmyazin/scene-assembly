import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectedAgentsPanel from '@/components/account/ConnectedAgentsPanel';
import { accountRequest } from '@/lib/account/client';
import type { ConnectedAgent } from '@/lib/account/contracts';
import { formatAbsoluteTime } from '@/lib/results/meta';
import { UNPRICED_MODELS_HINT } from '@/lib/account/agent-copy';

vi.mock('@/lib/account/client', () => ({ accountRequest: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const agent: ConnectedAgent = { id: 'agent-1', name: 'Claude Code', connectedAt: 1, lastUsedAt: null, budgetUsd: 5, usedUsd: 1.2, allowUnknownCost: false, allowDelete: false };
function answer(agents: ConnectedAgent[] = [agent]) {
  vi.mocked(accountRequest).mockImplementation(async (path, init) => {
    if (path === 'agents') return { accountId: 'owner-1', mcpUrl: 'https://mcp-sceneassembly.smoxu.com/mcp', limits: { minUsd: 0.5, maxUsd: 500 }, agents };
    if (path === 'agents/agent-1' && init?.method === 'POST') return { agent: { ...agent, ...JSON.parse(String(init.body)) } };
    if (path === 'agents/agent-1' && init?.method === 'DELETE') return { ok: true };
    throw new Error(`Unexpected ${path}`);
  });
}
/** A promise the test settles by hand, so it can inspect the UI while a DELETE
 *  is still on the wire instead of it having already resolved by the time the
 *  next assertion runs. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function confirmDisconnect(row: ReturnType<typeof within>) {
  await userEvent.click(row.getByRole('button', { name: 'Disconnect' }));
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
}
// Braces, not an expression body: `mockReset()` returns the mock itself, and
// Vitest treats a value `beforeEach` returns as a teardown to run after the
// test — an expression body here would hand it `accountRequest` and it would
// get invoked with no arguments once the test ends.
beforeEach(() => { vi.mocked(accountRequest).mockReset(); });

describe('connected agents panel', () => {
  it('shows the MCP URL and each agent\'s use of its limit', async () => {
    answer();
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('https://mcp-sceneassembly.smoxu.com/mcp')).toBeInTheDocument();
    expect(screen.getByText('$1.20 of $5.00 in the last 24 hours')).toBeInTheDocument();
  });

  it('links the setup guide next to the MCP URL', async () => {
    answer();
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    expect(await screen.findByRole('link', { name: 'Setup guide' })).toHaveAttribute('href', '/docs/mcp');
  });

  // Every reconnect adds a row, so two rows with the same name are told apart
  // by when each was connected and whether it is still in use.
  it('says when each agent was connected and when it was last used', async () => {
    const connectedAt = Date.UTC(2026, 8, 1, 15, 4);
    answer([{ ...agent, connectedAt, lastUsedAt: Date.now() - 2 * 3_600_000 }]);
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    expect(await screen.findByRole('listitem')).toHaveTextContent(`Connected ${formatAbsoluteTime(connectedAt)} · Last used 2h ago`);
  });

  it('says an agent that has not made a call yet was never used', async () => {
    const connectedAt = Date.UTC(2026, 8, 1, 15, 4);
    answer([{ ...agent, connectedAt, lastUsedAt: null }]);
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    expect(await screen.findByRole('listitem')).toHaveTextContent(`Connected ${formatAbsoluteTime(connectedAt)} · Last used never`);
  });

  it('says when nothing is connected', async () => {
    answer([]);
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    expect(await screen.findByText('No agents connected.')).toBeInTheDocument();
  });

  it('copies the MCP URL', async () => {
    answer();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy MCP URL' }));
    expect(writeText).toHaveBeenCalledWith('https://mcp-sceneassembly.smoxu.com/mcp');
  });

  it('saves a new limit and toggles', async () => {
    answer();
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    const row = within(await screen.findByRole('listitem'));
    const limit = row.getByLabelText('Limit per 24 hours');
    await userEvent.clear(limit); await userEvent.type(limit, '10');
    await userEvent.click(row.getByLabelText('Allow deleting files'));
    await userEvent.click(row.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('agents/agent-1', expect.objectContaining({ method: 'POST' })));
    const [, init] = vi.mocked(accountRequest).mock.calls.find(([path, options]) => path === 'agents/agent-1' && options?.method === 'POST')!;
    expect(JSON.parse(String(init!.body))).toEqual({ budgetUsd: 10, allowUnknownCost: false, allowDelete: true });
  });

  // Switched on later from here, the toggle lets models run outside the dollar
  // limit, so it says so in the consent page's own words.
  it('says what allowing unpriced models means, as the consent page does', async () => {
    expect(UNPRICED_MODELS_HINT).toBe('These don’t count toward the limit unless the provider reports what they cost.');
    answer();
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    const row = within(await screen.findByRole('listitem'));
    expect(row.getByLabelText('Allow unpriced models')).toHaveAccessibleDescription(UNPRICED_MODELS_HINT);
  });

  it('keeps Save disabled until something changes', async () => {
    answer();
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    expect(within(await screen.findByRole('listitem')).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disconnects after confirmation', async () => {
    answer();
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    await userEvent.click(within(await screen.findByRole('listitem')).getByRole('button', { name: 'Disconnect' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('agents/agent-1', expect.objectContaining({ method: 'DELETE' })));
    expect(await screen.findByText('No agents connected.')).toBeInTheDocument();
  });

  it('locks the row while its disconnect is in flight, and fires exactly one DELETE', async () => {
    const gate = deferred<{ ok: true }>();
    vi.mocked(accountRequest).mockImplementation(async (path, init) => {
      if (path === 'agents') return { accountId: 'owner-1', mcpUrl: 'https://mcp-sceneassembly.smoxu.com/mcp', limits: { minUsd: 0.5, maxUsd: 500 }, agents: [agent] };
      if (path === 'agents/agent-1' && init?.method === 'DELETE') return gate.promise;
      throw new Error(`Unexpected ${path}`);
    });
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    const row = within(await screen.findByRole('listitem'));
    await confirmDisconnect(row);

    // The DELETE has not settled yet: the row locks both of its own buttons.
    await waitFor(() => expect(row.getByRole('button', { name: 'Disconnect' })).toBeDisabled());
    expect(row.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(vi.mocked(accountRequest).mock.calls.filter(([path, init]) => path === 'agents/agent-1' && init?.method === 'DELETE')).toHaveLength(1);

    // A second confirmation for the same agent while it is locked must not
    // fire a second DELETE — the button is disabled, so this click is a no-op.
    await userEvent.click(row.getByRole('button', { name: 'Disconnect' }));
    expect(vi.mocked(accountRequest).mock.calls.filter(([path, init]) => path === 'agents/agent-1' && init?.method === 'DELETE')).toHaveLength(1);

    gate.resolve({ ok: true });
    expect(await screen.findByText('No agents connected.')).toBeInTheDocument();
  });

  it('re-enables the row when the disconnect fails', async () => {
    const gate = deferred<{ ok: true }>();
    vi.mocked(accountRequest).mockImplementation(async (path, init) => {
      if (path === 'agents') return { accountId: 'owner-1', mcpUrl: 'https://mcp-sceneassembly.smoxu.com/mcp', limits: { minUsd: 0.5, maxUsd: 500 }, agents: [agent] };
      if (path === 'agents/agent-1' && init?.method === 'DELETE') return gate.promise;
      throw new Error(`Unexpected ${path}`);
    });
    render(<ConnectedAgentsPanel ownerId="owner-1" />);
    const row = within(await screen.findByRole('listitem'));
    await confirmDisconnect(row);
    await waitFor(() => expect(row.getByRole('button', { name: 'Disconnect' })).toBeDisabled());

    gate.reject(new Error('Could not disconnect.'));
    await waitFor(() => expect(row.getByRole('button', { name: 'Disconnect' })).not.toBeDisabled());
    // Still connected: the failed DELETE never removed it from the list.
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });
});
