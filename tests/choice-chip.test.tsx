import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChoiceChip from '@/components/ChoiceChip';

const options = ['1K', '2K', '4K'].map((value) => ({ label: value, value }));

function stubWidth(wide: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: wide,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('ChoiceChip', () => {
  it('lays the choices out in place on a wide screen', () => {
    stubWidth(true);
    const onChange = vi.fn();
    render(<ChoiceChip label="Size" panelLabel="Resolution" options={options} value="2K" onChange={onChange} />);

    expect(screen.queryByRole('button', { name: /^Size/ })).toBeNull();
    expect(screen.getByRole('radio', { name: '2K' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '4K' }));
    expect(onChange).toHaveBeenCalledWith('4K');
  });

  it('folds the choices into a popover on a narrow screen', () => {
    stubWidth(false);
    render(<ChoiceChip label="Size" panelLabel="Resolution" options={options} value="2K" onChange={() => undefined} />);

    expect(screen.queryByRole('radiogroup', { name: 'Resolution' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Size 2K' }));
    expect(screen.getByRole('radiogroup', { name: 'Resolution' })).toBeTruthy();
  });

  it('states a single option as plain text', () => {
    stubWidth(true);
    render(<ChoiceChip label="Size" panelLabel="Resolution" options={[options[1]]} value="2K" onChange={() => undefined} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('2K')).toBeTruthy();
  });
});
