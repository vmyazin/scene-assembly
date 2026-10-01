// tests/moderation/relaxed-filter-ui.test.tsx
// tests/moderation/relaxed-filter-ui.test.tsx
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RelaxedFilterControl from '@/components/RelaxedFilterControl';
import { GUEST_CONSENT_KEY, consentStorageKey } from '@/lib/moderation/level';
import { useRelaxedFilter, type RelaxedFilterInput } from '@/lib/moderation/use-relaxed-filter';
import { useAccountStore, type AccountSession } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';

const guestConsent = {
  consentedAt: '2026-09-28T00:00:00.000Z',
  policyVersion: 1,
  ageConfirmed: true as const,
  accountId: null,
};

function session(id: string): AccountSession {
  return {
    account: { id, name: 'Ada', email: 'ada@example.com' },
    googleEnabled: false,
    localSignIn: true,
    providers: [],
    connections: [],
  };
}

function Harness(props: RelaxedFilterInput) {
  const filter = useRelaxedFilter(props);
  return (
    <>
      <RelaxedFilterControl filter={filter} />
      <span data-testid="level">{filter.effective}</span>
    </>
  );
}

const fal: RelaxedFilterInput = {
  workspaceKey: 'image',
  provider: 'fal',
  modelId: 'nano-banana-2',
  endpointId: 'fal-ai/nano-banana-2',
  prompt: 'a red kite',
  hasReferences: false,
};

describe('Relaxed filter control', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_RELAXED_FILTER = 'all';
    useAppStore.setState({ relaxedConsents: {}, preferredLevel: {} });
  });

  afterEach(() => {
    cleanup();
    delete process.env.NEXT_PUBLIC_RELAXED_FILTER;
    vi.unstubAllGlobals();
    useAppStore.setState({ relaxedConsents: {}, preferredLevel: {} });
  });

  it('hides the toggle when the flag is off and on an engine with no knob', () => {
    process.env.NEXT_PUBLIC_RELAXED_FILTER = 'off';
    const view = render(<Harness {...fal} />);
    expect(screen.queryByRole('radiogroup', { name: 'Filter' })).not.toBeInTheDocument();

    process.env.NEXT_PUBLIC_RELAXED_FILTER = 'all';
    view.rerender(
      <Harness
        {...fal}
        provider="gemini"
        modelId="gemini-3-pro-image-preview"
        endpointId={undefined}
      />
    );
    expect(screen.queryByRole('radiogroup', { name: 'Filter' })).not.toBeInTheDocument();

    view.rerender(<Harness {...fal} provider="fal" modelId="seedance-2" endpointId="bytedance/seedance-2.0/text-to-video" />);
    expect(screen.queryByRole('radiogroup', { name: 'Filter' })).not.toBeInTheDocument();
  });

  it('asks for the 18+ confirmation once and then keeps Relaxed', async () => {
    const user = userEvent.setup();
    render(<Harness {...fal} />);
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Relaxed' }));
    expect(screen.getByRole('dialog', { name: 'Turn on Relaxed filter?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/uncensored|NSFW/i);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('level')).toHaveTextContent('relaxed');
    expect(useAppStore.getState().relaxedConsents[GUEST_CONSENT_KEY]?.ageConfirmed).toBe(true);
    expect(useAppStore.getState().relaxedConsents[GUEST_CONSENT_KEY]?.policyVersion).toBe(1);
    expect(useAppStore.getState().relaxedConsents[GUEST_CONSENT_KEY]?.accountId).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Standard' }));
    await user.click(screen.getByRole('radio', { name: 'Relaxed' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('level')).toHaveTextContent('relaxed');
  });

  it('locks Relaxed while a reference is attached and says so', () => {
    useAppStore.setState({
      relaxedConsents: { [GUEST_CONSENT_KEY]: guestConsent },
      preferredLevel: { image: 'relaxed' },
    });
    render(<Harness {...fal} hasReferences />);
    expect(screen.getByRole('radio', { name: 'Relaxed' })).toBeDisabled();
    expect(screen.getByText('Relaxed is off while references are attached.')).toBeInTheDocument();
    expect(screen.getByTestId('level')).toHaveTextContent('standard');
  });

  it('notes that a minor mention keeps the standard filter on', () => {
    useAppStore.setState({
      relaxedConsents: { [GUEST_CONSENT_KEY]: guestConsent },
      preferredLevel: { image: 'relaxed' },
    });
    render(<Harness {...fal} prompt="a child playing in a park" />);
    expect(screen.getByText(/Relaxed is off for this prompt because it mentions a minor/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Relaxed' })).toBeDisabled();
    expect(screen.getByTestId('level')).toHaveTextContent('standard');
  });

  it('asks again after sign-in and stores consent for that account only', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    useAppStore.setState({
      relaxedConsents: { [GUEST_CONSENT_KEY]: guestConsent },
      preferredLevel: { image: 'relaxed' },
    });
    render(<Harness {...fal} />);
    expect(screen.getByTestId('level')).toHaveTextContent('relaxed');

    await act(async () => {
      useAccountStore.getState().applySession(session('account-a'));
    });
    expect(screen.getByTestId('level')).toHaveTextContent('standard');
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Relaxed' }));
    expect(screen.getByRole('dialog', { name: 'Turn on Relaxed filter?' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/account/relaxed-consent');
    expect(screen.getByTestId('level')).toHaveTextContent('relaxed');
    expect(useAppStore.getState().relaxedConsents[consentStorageKey('account-a')]?.accountId).toBe('account-a');
    expect(useAppStore.getState().relaxedConsents[GUEST_CONSENT_KEY]?.accountId).toBeNull();

    await act(async () => {
      useAccountStore.getState().applySession(session('account-b'));
    });
    expect(screen.getByTestId('level')).toHaveTextContent('standard');
    await user.click(screen.getByRole('radio', { name: 'Relaxed' }));
    expect(screen.getByRole('dialog', { name: 'Turn on Relaxed filter?' })).toBeInTheDocument();
  });

  it('keeps the toggle on Standard when the account confirmation cannot be saved', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'missing' }) })));
    useAccountStore.getState().applySession(session('account-a'));
    render(<Harness {...fal} />);

    await user.click(screen.getByRole('radio', { name: 'Relaxed' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(screen.getByText('Could not save this confirmation on your account. Try again.')).toBeInTheDocument();
    expect(screen.getByTestId('level')).toHaveTextContent('standard');
    expect(useAppStore.getState().relaxedConsents[consentStorageKey('account-a')]).toBeUndefined();
  });
});
