'use client';

import { ArrowUpRight, KeyRound } from 'lucide-react';

import ProviderLogo from '@/components/ProviderLogo';
import type { EngineId } from '@/lib/engines/registry';
import { KEY_SOURCES } from '@/lib/providers/key-source';

/**
 * The not-connected state for a provider workspace: without a key every control
 * on the page is inert, and a page full of live-looking controls that cannot
 * submit reads as a broken app rather than an unfinished setup. So the callout
 * sits directly under the workspace header — above the controls it gates — and
 * says the one thing that has to happen, with both routes to it: paste a key
 * here, or go get one from the vendor.
 *
 * Urgency comes from state, not from ornament: a Marker Yellow status dot and a
 * dashed perimeter (the same "nothing here yet" language as the upload
 * dropzones), with Signal Cyan spent only on the action itself.
 */
export default function ConnectKeyCallout({
  provider,
  label,
  storage = 'browser',
  onConnect,
}: {
  provider: EngineId;
  label: string;
  storage?: 'browser' | 'account';
  onConnect: () => void;
}) {
  const { href, urlLabel } = KEY_SOURCES[provider];

  return (
    <section
      aria-labelledby="connect-key-callout-title"
      className="rounded-[var(--radius)] border border-dashed border-[var(--brand-accent)]/30 bg-[var(--brand-accent)]/[0.035] p-5 shadow-[var(--shadow-md)] md:px-7 md:py-6"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-10">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--brand-accent)]/25 bg-[var(--brand-accent)]/10 text-[var(--brand-accent)]"
          >
            <KeyRound size={19} />
          </span>
          <div className="min-w-0 space-y-2">
            <p className="eyebrow flex items-center gap-1.5">
              <span className="connect-key-dot" aria-hidden /> Not connected
            </p>
            <h3
              id="connect-key-callout-title"
              className="display text-base font-semibold text-[var(--foreground)] sm:text-lg"
            >
              Add your {label} key to start generating
            </h3>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
              {storage==='account'?'Keys are encrypted in your account and used by your background jobs.':'Keys stay in this browser and are sent only with your own generations.'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          <button type="button" onClick={onConnect} className="btn-primary">
            <ProviderLogo provider={provider} size={14} />
            Connect key
          </button>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center justify-center gap-1 text-xs text-[var(--foreground-subtle)] transition-colors hover:text-[var(--neon-cyan)]"
          >
            No key yet?{' '}
            {/* Only the URL is underlined: the rule marks what is clickable-looking
                as an actual destination, and the lead-in reads as prose. */}
            <span className="border-b border-current/40 pb-px transition-colors group-hover:border-current">
              {urlLabel}
            </span>
            <ArrowUpRight size={13} />
          </a>
        </div>
      </div>
    </section>
  );
}
