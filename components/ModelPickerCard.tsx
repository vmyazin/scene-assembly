// components/ModelPickerCard.tsx
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

/**
 * The "Model" card of a provider workspace: a title, a search field, and
 * whatever list and note the caller renders below them. Filtering stays with
 * the caller, because a workspace decides what an empty search shows.
 */
export function ModelPickerCard({
  searchLabel,
  search,
  onSearch,
  children,
}: {
  searchLabel: string;
  search: string;
  onSearch: (query: string) => void;
  children: ReactNode;
}) {
  return (
    <section className="glass-card space-y-3 p-3.5 md:p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="display text-base font-semibold">Model</h3>
        <div className="flex w-40 max-w-[48%] items-center gap-2">
          <Search aria-hidden="true" size={14} className="pointer-events-none shrink-0 text-[var(--foreground-subtle)]" />
          <input
            type="search"
            aria-label={searchLabel}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Find a model"
            className="min-w-0 flex-1"
          />
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** "Label: what it is", under the model list. */
export function ModelNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="px-0.5 text-sm leading-relaxed text-[var(--foreground-muted)]">
      <span className="font-medium text-[var(--foreground)]">{label}:</span> {children}
    </p>
  );
}
