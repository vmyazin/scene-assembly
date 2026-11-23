import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MenuChip from '@/components/MenuChip';

const options = [
  { value: '1:1', label: '1:1 (Square)', detail: '1024 × 1024', ratio: '1:1' },
  { value: '16:9', label: '16:9 (Wide)', detail: '1344 × 768', ratio: '16:9' },
];

describe('MenuChip', () => {
  it('lists the choices in its own panel, with no select inside it', () => {
    render(<MenuChip label="Shape" panelLabel="Aspect ratio" value="1:1" options={options} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Shape 1:1 (Square)' }));

    const menu = screen.getByRole('group', { name: 'Aspect ratio' });
    expect(within(menu).queryByRole('combobox')).toBeNull();
    expect(within(menu).getByRole('button', { pressed: true })).toHaveAccessibleName('1:1 (Square) · 1024 × 1024');
  });

  it('picks a choice in one click and closes', () => {
    const onChange = vi.fn();
    render(<MenuChip label="Shape" panelLabel="Aspect ratio" value="1:1" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^Shape/ }));
    fireEvent.click(screen.getByRole('button', { name: '16:9 (Wide) · 1344 × 768' }));

    expect(onChange).toHaveBeenCalledWith('16:9');
    expect(screen.queryByRole('group', { name: 'Aspect ratio' })).toBeNull();
  });
});
