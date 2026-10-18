import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ModelListbox, { type ModelListboxRow } from '@/components/ModelListbox';
import type { SpecColumn } from '@/lib/models/listbox-specs';

const columns: SpecColumn[] = [
  { key: 'length', label: 'Max', align: 'right' },
  { key: 'shapes', label: 'Shapes' },
  { key: 'edit', label: 'Edit' },
];

const rows: ModelListboxRow[] = [
  { id: 'sora-2', label: 'Sora 2', cells: [{ kind: 'text', value: '20s' }, { kind: 'shapes', ratios: ['16:9', '9:16'] }, { kind: 'mark', on: true, label: 'Takes a reference image' }] },
  { id: 'wan2.7', label: 'Wan 2.7', cells: [{ kind: 'text', value: '15s' }, { kind: 'shapes', ratios: ['16:9'] }, { kind: 'mark', on: false, label: 'Takes a reference image' }] },
  { id: 'veo3.1', label: 'Veo 3.1', cells: [{ kind: 'text', value: '8s' }, { kind: 'text', value: '—', tone: 'subtle' }, { kind: 'mark', on: true, label: 'Takes a reference image' }] },
  { id: 'nano', label: 'Nano Banana Pro', cells: [{ kind: 'text', value: '—', tone: 'subtle' }, { kind: 'shapes', ratios: ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'] }, { kind: 'mark', on: true, label: 'Takes a reference image' }] },
];

function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState('wan2.7');
  return (
    <ModelListbox
      label="Model"
      accent="video"
      columns={columns}
      rows={rows}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
    />
  );
}

describe('ModelListbox', () => {
  it('is a listbox whose options are named by the model and described by its specs', () => {
    render(<Harness />);
    const listbox = screen.getByRole('listbox', { name: 'Model' });
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    // Eight shapes are counted, not drawn; the description still lists them.
    expect(within(options[3]).getByText('8 shapes')).toBeInTheDocument();
    expect(options[3]).toHaveAccessibleDescription('Max — · Shapes 21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 2:3, 9:16 · Takes a reference image');
    expect(options[0]).toHaveAccessibleName('Sora 2');
    expect(options[0]).toHaveAccessibleDescription('Max 20s · Shapes 16:9, 9:16 · Takes a reference image');
    expect(options[1]).toHaveAccessibleDescription('Max 15s · Shapes 16:9 · no takes a reference image');
  });

  it('selects on click and walks the list with the arrow keys', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('option', { name: 'Sora 2' }));
    expect(onChange).toHaveBeenLastCalledWith('sora-2');
    expect(screen.getByRole('option', { name: 'Sora 2' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('option', { name: 'Sora 2' }), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('wan2.7');
    fireEvent.keyDown(screen.getByRole('option', { name: 'Wan 2.7' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('nano');
    expect(screen.getByRole('option', { name: 'Nano Banana Pro' })).toHaveFocus();
  });

  it('marks a deprecated model without changing its accessible name', () => {
    render(
      <ModelListbox
        label="Model"
        accent="image"
        columns={columns}
        rows={[{ ...rows[0], deprecated: true }]}
        value="sora-2"
        onChange={() => {}}
      />
    );
    const option = screen.getByRole('option', { name: 'Sora 2' });
    expect(option).toHaveAccessibleName('Sora 2');
    const badge = option.querySelector('.model-listbox-badge');
    expect(badge?.textContent).toBe('deprecated');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps one option in the tab order and paints the workspace accent', () => {
    const { container } = render(<Harness />);
    const tabbable = screen.getAllByRole('option').filter((option) => option.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName('Wan 2.7');
    expect(container.querySelector('.model-listbox')).toHaveAttribute('data-accent', 'video');
    // Glyphs are drawn at ratio: 16:9 lands wider than tall, 9:16 the reverse.
    const glyphs = [...container.querySelectorAll('.model-listbox-glyph')] as HTMLElement[];
    expect(glyphs[0].style.width > glyphs[0].style.height || parseInt(glyphs[0].style.width) > parseInt(glyphs[0].style.height)).toBe(true);
    expect(parseInt(glyphs[1].style.width)).toBeLessThan(parseInt(glyphs[1].style.height));
  });
});

describe('ModelListbox rail layout', () => {
  const railColumns: SpecColumn[] = [
    { key: 'from', label: 'From', align: 'right' },
    { key: 'tier', label: 'Max' },
    { key: 'search', label: 'Search' },
  ];
  const railRows: ModelListboxRow[] = [
    {
      id: 'nb21',
      label: 'Nano Banana 2.1',
      cells: [{ kind: 'text', value: '$0.034/image' }, { kind: 'text', value: '4K' }, { kind: 'mark', on: true, label: 'Search' }],
      tags: [{ label: '4K' }, { label: 'Default' }],
    },
    {
      id: 'nb2',
      label: 'Nano Banana 2',
      deprecated: true,
      cells: [{ kind: 'text', value: '$0.067' }, { kind: 'text', value: '4K' }, { kind: 'mark', on: false, label: 'Search' }],
      tags: [{ label: 'Retired · use 2.1', tone: 'warn' }],
    },
  ];

  it('keeps the price column alone and draws the tags under the name', () => {
    render(<ModelListbox label="Model" accent="image" layout="rail" columns={railColumns} rows={railRows} value="nb21" onChange={() => undefined} />);

    const rows = screen.getAllByRole('option');
    expect(rows[0].querySelectorAll('.model-listbox-cell')).toHaveLength(1);
    // Everything in the image workspace is per image; the rail drops the unit.
    expect(rows[0].querySelector('.model-listbox-cell')?.textContent).toContain('$0.034');
    expect(rows[0].textContent).not.toContain('/image');
    expect(rows[0].textContent).toContain('Default');
    // The retired row says where to go instead of a bare "deprecated" badge.
    expect(rows[1].textContent).toContain('Retired · use 2.1');
    expect(rows[1].textContent).not.toContain('deprecated');
    expect(rows[1].querySelector('.model-listbox-tag')).toHaveAttribute('data-tone', 'warn');
  });

  it('keeps the tags out of the option’s name, so history labels stay stable', () => {
    render(<ModelListbox label="Model" accent="image" layout="rail" columns={railColumns} rows={railRows} value="nb21" onChange={() => undefined} />);

    expect(screen.getByRole('option', { name: 'Nano Banana 2.1' })).toBeTruthy();
  });

  it('draws no tags in the table layout', () => {
    render(<ModelListbox label="Model" accent="image" columns={railColumns} rows={railRows} value="nb21" onChange={() => undefined} />);

    expect(document.querySelector('.model-listbox-tag')).toBeNull();
  });
});

describe('ModelListbox with no spec column left', () => {
  it('keeps a valid two-column template, so the dot stays beside the name', () => {
    render(
      <ModelListbox
        label="Model"
        accent="image"
        layout="rail"
        columns={[{ key: 'tier', label: 'Up to' }]}
        rows={[{ id: 'a', label: 'Nano Banana Pro', cells: [{ kind: 'text', value: '4K' }] }]}
        value="a"
        onChange={() => undefined}
      />
    );

    expect(screen.getByRole('listbox').style.gridTemplateColumns).toBe('18px minmax(0, 1fr)');
  });
});
