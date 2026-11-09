import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ApiKeyConfig from '@/components/ApiKeyConfig';

/**
 * A workspace that cannot run asks for one specific key, so the dialog it opens
 * points at that card rather than leaving it to be found among a dozen others.
 */
describe('the API connections dialog opened for one provider', () => {
  it('outlines that provider’s card and puts the cursor in its field', async () => {
    render(<ApiKeyConfig open onOpenChange={() => undefined} focusProvider="atlas" />);

    const card = document.querySelector('[data-provider="atlas"]');
    expect(card).toHaveClass('border-2', 'border-[var(--neon-cyan)]');
    expect(document.querySelector('[data-provider="comet"]')).toHaveClass('border');
    expect(document.querySelector('[data-provider="comet"]')).not.toHaveClass('border-2');

    await waitFor(() =>
      expect(screen.getByLabelText('Atlas Cloud API key')).toHaveFocus()
    );
  });

  it('aims at the Gemini field when the Create image gate opens it (SA-01)', async () => {
    render(<ApiKeyConfig open onOpenChange={() => undefined} focusProvider="gemini" />);

    expect(document.querySelector('[data-provider="gemini"]')).toHaveClass('border-2');
    await waitFor(() => expect(screen.getByLabelText('Gemini API key')).toHaveFocus());
    expect(screen.getByRole('link', { name: /aistudio\.google\.com\/apikey/ })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  });

  it('leaves every card plain when opened from the header', async () => {
    render(<ApiKeyConfig open onOpenChange={() => undefined} />);

    expect(document.querySelectorAll('.border-2')).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText('Atlas Cloud API key')).not.toHaveFocus());
  });
});
