// tests/moderation/relaxed-filter-ui.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import RelaxedFilterControl from '@/components/RelaxedFilterControl';
import { useRelaxedFilter, type RelaxedFilterInput } from '@/lib/moderation/use-relaxed-filter';
import { useAppStore } from '@/store/useAppStore';

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
    useAppStore.setState({ relaxedFilter: null, preferredLevel: {} });
  });

  afterEach(() => {
    cleanup();
    delete process.env.NEXT_PUBLIC_RELAXED_FILTER;
    useAppStore.setState({ relaxedFilter: null, preferredLevel: {} });
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
    expect(useAppStore.getState().relaxedFilter?.ageConfirmed).toBe(true);
    expect(useAppStore.getState().relaxedFilter?.policyVersion).toBe(1);

    await user.click(screen.getByRole('radio', { name: 'Standard' }));
    await user.click(screen.getByRole('radio', { name: 'Relaxed' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('level')).toHaveTextContent('relaxed');
  });

  it('locks Relaxed while a reference is attached and says so', () => {
    useAppStore.setState({
      relaxedFilter: { consentedAt: '2026-09-28T00:00:00.000Z', policyVersion: 1, ageConfirmed: true },
      preferredLevel: { image: 'relaxed' },
    });
    render(<Harness {...fal} hasReferences />);
    expect(screen.getByRole('radio', { name: 'Relaxed' })).toBeDisabled();
    expect(screen.getByText('Relaxed is off while references are attached.')).toBeInTheDocument();
    expect(screen.getByTestId('level')).toHaveTextContent('standard');
  });

  it('notes that a minor mention keeps the standard filter on', () => {
    useAppStore.setState({
      relaxedFilter: { consentedAt: '2026-09-28T00:00:00.000Z', policyVersion: 1, ageConfirmed: true },
      preferredLevel: { image: 'relaxed' },
    });
    render(<Harness {...fal} prompt="a child playing in a park" />);
    expect(screen.getByText(/Relaxed is off for this prompt because it mentions a minor/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Relaxed' })).toBeDisabled();
    expect(screen.getByTestId('level')).toHaveTextContent('standard');
  });
});
