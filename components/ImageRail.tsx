'use client';

import type { ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';

import ChipPopover from '@/components/ChipPopover';
import ProviderLogo from '@/components/ProviderLogo';
import type { EngineId, EngineMeta } from '@/lib/engines/registry';

/**
 * The image workspace's rail, shared by `GenerationInterface` and the Kie image
 * workspace so switching to Kie does not move the engine menu, the model list
 * or the collapse toggle (UX audit L1, variant G).
 */

/** "Engine" with the count of engines, and a field that opens the list of them. */
export function EngineField({
  engines,
  activeEngineId,
  accountMode = false,
  onSelect,
}: {
  engines: EngineMeta[];
  activeEngineId: EngineId;
  /** A background Pollinations job is billed, so it is not called free there. */
  accountMode?: boolean;
  onSelect: (engineId: EngineId) => void;
}) {
  const active = engines.find((engine) => engine.id === activeEngineId) ?? engines[0];
  const isFree = (engine: EngineMeta) => engine.free && !(accountMode && engine.id === 'pollinations');
  const freeCount = engines.filter(isFree).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">Provider</span>
        {engines.length > 1 && (
          <span className="font-mono text-[0.68rem] text-[var(--foreground-subtle)]">
            {engines.length} providers{freeCount ? ` · ${freeCount} free` : ''}
          </span>
        )}
      </div>
      {engines.length > 1 ? (
        <ChipPopover
          variant="field"
          label="Provider"
          panelLabel="Provider"
          value={
            <span className="flex items-center gap-2">
              <ProviderLogo provider={active.id} size={15} />
              {active.label}
            </span>
          }
        >
          {(close) => (
            <ul className="space-y-0.5">
              {engines.map((engine) => {
                const selected = engine.id === active.id;
                return (
                  <li key={engine.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        onSelect(engine.id);
                        close();
                      }}
                      title={accountMode && engine.id === 'pollinations' ? 'Background generation uses your saved Pollinations key and provider balance.' : engine.blurb}
                      className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors ${
                        selected
                          ? 'bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)]'
                          : 'text-[var(--foreground-muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      <ProviderLogo provider={engine.id} size={14} />
                      <span className="flex-1">{engine.label}</span>
                      {isFree(engine) && (
                        <span className="text-[0.62rem] uppercase tracking-wide text-emerald-400">Free</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ChipPopover>
      ) : (
        <div className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm">
          <ProviderLogo provider={active.id} size={15} />
          {active.label}
        </div>
      )}
    </div>
  );
}

/** The rail itself: the engine, then "Model" over whatever the engine offers. */
export function ImageRailCard({
  engineField,
  children,
  onCollapse,
}: {
  engineField?: ReactNode;
  /** The model list, its note, and anything that acts on the chosen model. */
  children: ReactNode;
  onCollapse: () => void;
}) {
  return (
    <section aria-label="Provider and model" className="glass-card space-y-3 p-3.5">
      {engineField}
      <div className="space-y-1.5">
        <span className="eyebrow block">Model</span>
        {children}
      </div>
      <button
        type="button"
        onClick={onCollapse}
        className="hidden w-full items-center gap-1.5 rounded-lg px-1 py-1.5 text-xs text-[var(--foreground-subtle)] transition-colors hover:text-[var(--foreground)] lg:flex"
      >
        <ChevronsLeft size={14} aria-hidden="true" />
        Collapse rail
      </button>
    </section>
  );
}

/** The rail folded to a strip that still names the engine and model. */
export function ImageRailStrip({
  engineId,
  modelLabel,
  onExpand,
}: {
  engineId: EngineId;
  modelLabel: string;
  onExpand: () => void;
}) {
  return (
    <section aria-label="Provider and model" className="glass-card flex flex-col items-center gap-3 px-1.5 py-3">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand provider and model rail"
        title="Expand provider and model rail"
        className="rounded-lg p-2 text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
      >
        <ChevronsRight size={16} aria-hidden="true" />
      </button>
      <ProviderLogo provider={engineId} size={18} />
      <span className="max-h-64 truncate text-xs text-[var(--foreground-muted)] [writing-mode:vertical-rl]">
        {modelLabel}
      </span>
    </section>
  );
}
