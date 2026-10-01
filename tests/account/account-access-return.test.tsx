import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccountAccess from '@/components/account/AccountAccess';
import { useAccountStore } from '@/store/useAccountStore';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/lib/account/session', () => ({ refreshAccount: vi.fn(), accountChanged: vi.fn() }));

const back = '/connect-agent?request=req-1';
beforeEach(() => { replace.mockReset(); vi.unstubAllGlobals(); });

describe('sign-in return path', () => {
  it('sends a signed-in visitor to the requested page', async () => {
    useAccountStore.getState().applySession({ account: { id: 'o', name: 'O', email: 'o@example.test' }, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
    render(<AccountAccess mode="sign-in" returnTo={back} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(back));
  });

  it('ignores a return path to another site', async () => {
    useAccountStore.getState().applySession({ account: { id: 'o', name: 'O', email: 'o@example.test' }, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
    render(<AccountAccess mode="sign-in" returnTo="https://evil.example" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/account'));
  });

  it('asks Google to come back to the requested page', async () => {
    useAccountStore.getState().applySession({ account: null, googleEnabled: true, localSignIn: false, providers: [], connections: [] });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }));
    vi.stubGlobal('fetch', fetcher);
    render(<AccountAccess mode="sign-in" returnTo={back} />);
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ returnTo: back });
  });

  it('carries the return path to the other account page', () => {
    render(<AccountAccess mode="sign-in" returnTo={back} />);
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', `/sign-up?returnTo=${encodeURIComponent(back)}`);
  });
});
