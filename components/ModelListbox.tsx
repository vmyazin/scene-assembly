'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import type { SpecCell, SpecColumn } from '@/lib/models/listbox-specs';

export interface ModelListboxRow {
  id: string;
  label: string;
  cells: SpecCell[];
  /** Drawn beside the name, outside the accessible name, so history labels stay stable. */
  deprecated?: boolean;
  /**
   * Short facts drawn under the name in the rail layout ("4K", "Search",
   * "Retired · use 2.1"). Derived from catalog data by `railTags`, never
   * hand-written, so a model shows only what its catalog states.
   */
  tags?: ModelListboxTag[];
}

export interface ModelListboxTag {
  label: string;
  /** `warn` for a retired model's pointer to its successor. */
  tone?: 'warn';
}

export interface ModelListboxProps {
  /** Accessible name of the list — "Model" everywhere it is used. */
  label: string;
  /** Which workspace identity paints the selected row: violet for video, yellow for image. */
  accent: 'image' | 'video';
  columns: SpecColumn[];
  rows: ModelListboxRow[];
  value: string | undefined;
  onChange: (id: string) => void;
  /**
   * `table` (default) aligns every spec in columns. `rail` is the image
   * workspace's narrow side rail: name and tags stacked, price alone on the
   * right, because a 290px rail has no width for five aligned columns.
   */
  layout?: 'table' | 'rail';
}

/** The columns a rail keeps: price, whichever name the catalog gives it. */
const RAIL_COLUMNS = new Set(['from', 'run']);

/**
 * The Model card's picker: an always-open rack where every model's headline
 * specs sit in aligned columns beside its name. It replaced a native select
 * whose options read "Wan 2.7 · metered" eleven times over, because the
 * question at this card is never "which name" but "which one does a
 * 15-second portrait" — and a closed dropdown cannot be scanned for that.
 *
 * Columns are a subgrid so the numbers line up down the whole list rather
 * than per row; the header is sticky inside the scroll so it stays readable
 * on the long CometAPI list.
 */
/** A cell that says "nothing known": a quiet dash, "metered", or an unticked mark. */
function isEmptyCell(cell: SpecCell | undefined): boolean {
  if (!cell) return true;
  if (cell.kind === 'text') return cell.tone === 'subtle';
  if (cell.kind === 'mark') return !cell.on;
  return false;
}

export default function ModelListbox({ label, accent, columns: allColumns, rows: allRows, value, onChange, layout = 'table' }: ModelListboxProps) {
  const rail = layout === 'rail';
  const baseId = useId();
  // A column nobody fills is noise, not information: CometAPI meters every
  // model, so its From column would read "metered" eleven times over — the
  // exact line the old select repeated. Only columns with at least one real
  // value survive; a dash beside a neighbour's number still earns its place.
  const keptIndexes = allColumns
    .map((_, index) => index)
    .filter((index) => !rail || RAIL_COLUMNS.has(allColumns[index].key))
    .filter((index) => allRows.some((row) => !isEmptyCell(row.cells[index])));
  const columns = keptIndexes.map((index) => allColumns[index]);
  const rows = allRows.map((row) => ({
    ...row,
    cells: keptIndexes.map((index) => (rail ? perImageDropped(row.cells[index]) : row.cells[index])),
  }));
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [hiddenBelow, setHiddenBelow] = useState(0);

  const selectedIndex = rows.findIndex((row) => row.id === value);
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex;

  // How many rows sit past the fold, so a scrolled list says it is one.
  const measure = () => {
    const scroller = scrollRef.current;
    const rowHeight = rowRefs.current[0]?.offsetHeight ?? 0;
    if (!scroller || rowHeight === 0) {
      setHiddenBelow(0);
      return;
    }
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    setHiddenBelow(remaining > 4 ? Math.round(remaining / rowHeight) : 0);
  };

  const rowCount = rows.length;
  useEffect(() => {
    measure();
  }, [rowCount]);

  useEffect(() => {
    if (selectedIndex === -1) return;
    rowRefs.current[selectedIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1);
    if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = rows.length - 1;
    if (next === undefined || next === index) return;
    event.preventDefault();
    onChange(rows[next].id);
    rowRefs.current[next]?.focus();
  };

  // `repeat(0, …)` is invalid and voids the whole template, which stacked the
  // dot over the name in a rail with no price column (Kie).
  const template = columns.length > 0
    ? `18px minmax(0, 1fr) repeat(${columns.length}, max-content)`
    : '18px minmax(0, 1fr)';

  return (
    <div className="model-listbox" data-accent={accent} data-layout={layout}>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label={label}
        className="model-listbox-scroll"
        style={{ gridTemplateColumns: template }}
        onScroll={measure}
      >
        <div className="model-listbox-head" aria-hidden="true">
          <span />
          <span>Model</span>
          {columns.map((column) => (
            <span key={column.key} data-align={column.align ?? 'left'} data-column={column.key}>
              {column.label}
            </span>
          ))}
        </div>
        {rows.map((row, index) => {
          const selected = row.id === value;
          const nameId = `${baseId}-${index}-name`;
          const specsId = `${baseId}-${index}-specs`;
          return (
            <button
              key={row.id}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={selected}
              aria-labelledby={nameId}
              aria-describedby={specsId}
              tabIndex={index === tabbableIndex ? 0 : -1}
              className="model-listbox-row"
              onClick={() => onChange(row.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="model-listbox-dot" aria-hidden="true" />
              <span className="model-listbox-name">
                <span id={nameId} className="model-listbox-name-text">
                  {row.label}
                </span>
                {row.deprecated && !rail ? (
                  <span className="model-listbox-badge" aria-hidden="true">
                    deprecated
                  </span>
                ) : null}
                {rail && row.tags?.length ? (
                  <span className="model-listbox-tags">
                    {row.tags.map((tag) => (
                      <span key={tag.label} className="model-listbox-tag" data-tone={tag.tone}>
                        {tag.label}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              {row.cells.map((cell, cellIndex) => (
                <span
                  key={columns[cellIndex]?.key ?? cellIndex}
                  className="model-listbox-cell"
                  data-align={columns[cellIndex]?.align ?? 'left'}
                  data-column={columns[cellIndex]?.key}
                  id={cellIndex === 0 ? specsId : undefined}
                >
                  {cellIndex === 0 && <SpecsSummary cells={row.cells} columns={columns} />}
                  <SpecCellView cell={cell} />
                </span>
              ))}
            </button>
          );
        })}
      </div>
      {hiddenBelow > 0 && (
        <div className="model-listbox-more" aria-hidden="true">
          {hiddenBelow} more ↓
        </div>
      )}
    </div>
  );
}

/**
 * "$0.034/image" (or Atlas's "/img") → "$0.034" in the rail. Everything in the image workspace is
 * priced per image, and at 288px the unit cost every name a line.
 */
function perImageDropped(cell: SpecCell): SpecCell {
  return cell.kind === 'text' && /\/(image|img)$/.test(cell.value)
    ? { ...cell, value: cell.value.replace(/\/(image|img)$/, '') }
    : cell;
}

/** One sentence of the row's specs for assistive tech, since the glyphs say nothing aloud. */
function SpecsSummary({ cells, columns }: { cells: SpecCell[]; columns: SpecColumn[] }) {
  const parts = cells.map((cell, index) => {
    const name = columns[index]?.label ?? '';
    if (cell.kind === 'text') return `${name} ${cell.value}`;
    if (cell.kind === 'shapes') return `${name} ${cell.ratios.join(', ')}`;
    return cell.on ? cell.label : `no ${cell.label.toLowerCase()}`;
  });
  return <span className="sr-only">{parts.join(' · ')}</span>;
}

function SpecCellView({ cell }: { cell: SpecCell }) {
  if (cell.kind === 'text') {
    return (
      <span className="model-listbox-text" data-tone={cell.tone} aria-hidden="true">
        {cell.value}
      </span>
    );
  }
  if (cell.kind === 'mark') {
    return cell.on ? (
      <Check className="model-listbox-mark" size={13} strokeWidth={2.5} aria-hidden="true" />
    ) : (
      <span className="model-listbox-text" data-tone="subtle" aria-hidden="true">
        —
      </span>
    );
  }
  // Past five, a row of frames stops being readable as shapes and becomes
  // texture — Kie's image models take eight — so the cell counts instead.
  if (cell.ratios.length > 5) {
    return (
      <span className="model-listbox-text" aria-hidden="true">
        {cell.ratios.length} shapes
      </span>
    );
  }
  return (
    <span className="model-listbox-shapes" aria-hidden="true">
      {cell.ratios.map((ratio) => (
        <ShapeGlyph key={ratio} ratio={ratio} />
      ))}
    </span>
  );
}

/**
 * A frame drawn at the real ratio, area-normalised so a square and a 21:9
 * strip weigh the same on the row: 16:9 is 14×8, 1:1 is 10×10, 9:16 is 8×14.
 */
function ShapeGlyph({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const scale = 10.5 / Math.sqrt(w * h);
  const width = Math.min(18, Math.max(4, Math.round(w * scale)));
  const height = Math.min(18, Math.max(4, Math.round(h * scale)));
  return <i className="model-listbox-glyph" style={{ width, height }} title={ratio} />;
}
