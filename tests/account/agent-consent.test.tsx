import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentConsent from '@/components/account/AgentConsent';
import { accountRequest } from '@/lib/account/client';
import { RouteError } from '@/lib/providers/route-error';
import { useAccountStore } from '@/store/useAccountStore';
import type { AgentAuthorizationView } from '@/lib/account/contracts';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/lib/account/client', () => ({ accountRequest: vi.fn() }));

const view: AgentAuthorizationView = {
  id: 'req-1', clientName: 'Claude Code', clientDomain: null, redirectHost: '127.0.0.1', redirectIsLoopback: true, expiresAt: Date.now() + 600_000,
  unknownPriceProviders: [{ label: 'Kie.ai', scope: 'all' }, { label: 'fal.ai', scope: 'some' }],
  defaults: { budgetUsd: 5, allowUnknownCost: false, allowDelete: false }, limits: { minUsd: 0.5, maxUsd: 500 },
};
const signIn = () => useAccountStore.getState().applySession({ account: { id: 'owner-1', name: 'Ada', email: 'ada@example.test' }, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
function answer(authorization: AgentAuthorizationView = view) {
  vi.mocked(accountRequest).mockImplementation(async (path, init) => {
    if (path === 'agent-authorizations/req-1' && !init?.method) return { authorization };
    if (path === 'agent-authorizations/req-1' && init?.method === 'POST') return { redirectTo: 'http://localhost:8897/oauth/finish?request=req-1' };
    throw new Error(`Unexpected ${path}`);
  });
}
beforeEach(() => { replace.mockReset(); vi.mocked(accountRequest).mockReset(); });

describe('agent consent page', () => {
  it('sends a signed-out person to sign in and back', async () => {
    render(<AgentConsent requestId="req-1" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/sign-in?returnTo=${encodeURIComponent('/connect-agent?request=req-1')}`));
  });

  it('explains a link without a request', () => {
    signIn();
    render(<AgentConsent requestId={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/missing its connection request/i);
  });

  it('shows who is asking, that the name is unverified, and what an unpriced grant affects', async () => {
    signIn(); answer();
    render(<AgentConsent requestId="req-1" />);
    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText(/unverified/i)).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1, an app on this computer/)).toBeInTheDocument();
    expect(screen.getByText('Affects: Kie.ai and some fal.ai models.')).toBeInTheDocument();
    expect(screen.getByLabelText(/allow models without a published price/i)).not.toBeChecked();
    expect(screen.getByLabelText(/allow deleting files from your library/i)).not.toBeChecked();
  });

  it('names a verified domain instead', async () => {
    signIn(); answer({ ...view, clientName: 'Claude', clientDomain: 'claude.ai' });
    render(<AgentConsent requestId="req-1" />);
    expect(await screen.findByText(/verified for claude\.ai/i)).toBeInTheDocument();
    expect(screen.queryByText(/unverified/i)).toBeNull();
  });

  it('refuses a limit outside the range without asking the server', async () => {
    signIn(); answer();
    render(<AgentConsent requestId="req-1" />);
    const limit = await screen.findByLabelText(/spend limit per 24 hours/i);
    await userEvent.clear(limit); await userEvent.type(limit, '0.1');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Set a limit between $0.50 and $500.00.');
    expect(accountRequest).toHaveBeenCalledTimes(1);
  });

  it('approves with the chosen settings and follows the finish link', async () => {
    signIn(); answer();
    const navigate = vi.fn();
    render(<AgentConsent requestId="req-1" navigate={navigate} />);
    const limit = await screen.findByLabelText(/spend limit per 24 hours/i);
    await userEvent.clear(limit); await userEvent.type(limit, '12');
    await userEvent.click(screen.getByLabelText(/allow models without a published price/i));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('http://localhost:8897/oauth/finish?request=req-1'));
    const [, init] = vi.mocked(accountRequest).mock.calls.at(-1)!;
    expect(JSON.parse(String(init!.body))).toEqual({ decision: 'approve', budgetUsd: 12, allowUnknownCost: true, allowDelete: false });
    expect(new Headers(init!.headers).get('X-Account-Id')).toBe('owner-1');
  });

  it('denies', async () => {
    signIn(); answer();
    const navigate = vi.fn();
    render(<AgentConsent requestId="req-1" navigate={navigate} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(JSON.parse(String(vi.mocked(accountRequest).mock.calls.at(-1)![1]!.body))).toEqual({ decision: 'deny' });
  });

  it('says when the request has expired', async () => {
    signIn();
    vi.mocked(accountRequest).mockRejectedValue(new Error('This connection request has expired or was already used. Start connecting again from your agent.'));
    render(<AgentConsent requestId="req-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('locks both buttons and explains a lost decision on a 409', async () => {
    signIn();
    vi.mocked(accountRequest).mockImplementation(async (path, init) => {
      if (path === 'agent-authorizations/req-1' && !init?.method) return { authorization: view };
      if (path === 'agent-authorizations/req-1' && init?.method === 'POST') throw new RouteError('already_decided', 409);
      throw new Error(`Unexpected ${path}`);
    });
    const navigate = vi.fn();
    render(<AgentConsent requestId="req-1" navigate={navigate} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This request was already answered. Start connecting again from your agent.');
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
