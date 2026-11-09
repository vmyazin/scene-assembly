'use client';

import { ArrowUpRight, KeyRound } from 'lucide-react';

import ProviderLogo from '@/components/ProviderLogo';
import type { EngineId } from '@/lib/engines/registry';
import { KEY_SOURCES } from '@/lib/providers/key-source';

/**
 * The not-connected state for a provider workspace: nothing can run without a
 * key, though a person can still write a prompt and set things up first. So the
 * callout sits directly under the workspace header and says, in plain words,
 * what is needed, why, and the two steps to get it: fetch a key from the
 * vendor's own page, then paste it into Connections. The button opens that
 * dialog on this provider's field, because validating and storing a key already
 * lives there, and a second paste field here would be a second copy of both.
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
  // Cloudflare issues a token. Its name is precise on purpose, so a person
  // matches what the vendor's page calls it.
  const credential = provider === 'cloudflare' ? 'API token' : 'API key';

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
              Generating needs your own {label} {credential}
            </h3>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
              Generations run on your {label} account and are billed there. The key is what connects that account.
            </p>
            <ol className="max-w-2xl list-decimal space-y-1 pl-5 text-sm leading-relaxed text-[var(--foreground)]">
              <li>
                Get a key at{' '}
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[var(--neon-cyan)] underline underline-offset-2"
                >
                  {urlLabel}
                  <ArrowUpRight size={13} aria-hidden="true" />
                </a>
              </li>
              <li>Select Connect key and paste it in.</li>
            </ol>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
              {storage==='account'?'Keys are encrypted in your account and used by your background jobs.':'Keys stay in this browser and are sent only with your own generations.'}
            </p>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
              Write your prompt first. It stays here while you connect, and carries over to any provider you switch to.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch sm:items-end">
          <button type="button" onClick={onConnect} className="btn-primary">
            <ProviderLogo provider={provider} size={14} />
            Connect key
          </button>
        </div>
      </div>
    </section>
  );
}
