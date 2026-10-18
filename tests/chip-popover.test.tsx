import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ChipPopover from '@/components/ChipPopover';

function Row() {
  return (
    <>
      <ChipPopover label="Shape" value="1:1">
        <p>Shape panel</p>
      </ChipPopover>
      <ChipPopover label="Size" value="2K">
        {(close) => (
          <button type="button" onClick={close}>
            Pick 4K
          </button>
        )}
      </ChipPopover>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe('ChipPopover', () => {
  it('states its value while closed and opens its panel in place', () => {
    render(<Row />);
    const chip = screen.getByRole('button', { name: 'Shape 1:1' });

    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Shape panel')).toBeNull();

    fireEvent.click(chip);

    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Shape' })).toHaveTextContent('Shape panel');
    expect(chip.getAttribute('aria-controls')).toBe(screen.getByRole('group', { name: 'Shape' }).id);
  });

  it('closes on Escape and hands focus back to the chip', () => {
    render(<Row />);
    const chip = screen.getByRole('button', { name: 'Shape 1:1' });
    fireEvent.click(chip);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('Shape panel')).toBeNull();
    expect(chip).toHaveFocus();
  });

  it('closes on a press outside, but not on one inside its panel', () => {
    render(<Row />);
    fireEvent.click(screen.getByRole('button', { name: 'Shape 1:1' }));

    fireEvent.pointerDown(screen.getByText('Shape panel'));
    expect(screen.getByText('Shape panel')).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByText('Shape panel')).toBeNull();
  });

  it('keeps one panel open at a time', () => {
    render(<Row />);
    fireEvent.click(screen.getByRole('button', { name: 'Shape 1:1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Size 2K' }));

    expect(screen.queryByText('Shape panel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pick 4K' })).toBeTruthy();
  });

  it('lets a panel whose choice ends it close itself', () => {
    render(<Row />);
    fireEvent.click(screen.getByRole('button', { name: 'Size 2K' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick 4K' }));

    expect(screen.queryByRole('button', { name: 'Pick 4K' })).toBeNull();
  });

  it('as a field, is named by its label for assistive tech and shows the aside', () => {
    render(
      <ChipPopover variant="field" label="Engine" value="Google Gemini" aside="9 engines · 2 free">
        <p>Engines</p>
      </ChipPopover>
    );

    expect(screen.getByRole('button', { name: /^Engine:\s*Google Gemini\s+9 engines · 2 free$/ })).toBeTruthy();
  });
});

describe('ChipPopover field panel', () => {
  const Field = () => (
    <div data-testid="rail" style={{ overflowY: 'auto' }}>
      <ChipPopover variant="field" label="Engine" value="Pollinations">
        {(close) => (
          <>
            <button type="button" onClick={close}>Gemini</button>
            <button type="button" aria-pressed="true">Pollinations</button>
          </>
        )}
      </ChipPopover>
      <button type="button">After</button>
    </div>
  );

  it('floats outside the scrolling rail, so the rail cannot clip it', () => {
    render(<Field />);
    fireEvent.click(screen.getByRole('button', { name: /^Engine:/ }));

    const panel = screen.getByRole('group', { name: 'Engine' });
    expect(screen.getByTestId('rail').contains(panel)).toBe(false);
    expect(panel.className).toContain('fixed');
  });

  it('moves focus to the current choice, and closes when focus leaves it', () => {
    render(<Field />);
    fireEvent.click(screen.getByRole('button', { name: /^Engine:/ }));

    expect(screen.getByRole('button', { name: 'Pollinations' })).toHaveFocus();

    fireEvent.blur(screen.getByRole('button', { name: 'Pollinations' }), {
      relatedTarget: screen.getByRole('button', { name: 'After' }),
    });
    expect(screen.queryByRole('group', { name: 'Engine' })).toBeNull();
  });

  it('treats a press inside the floating panel as inside', () => {
    render(<Field />);
    fireEvent.click(screen.getByRole('button', { name: /^Engine:/ }));

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Gemini' }));
    expect(screen.getByRole('group', { name: 'Engine' })).toBeTruthy();
  });
});
