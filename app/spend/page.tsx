'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryState } from 'nuqs';

import { BrandWordmark } from '@/components/BrandMark';
import ConfirmDialog from '@/components/ConfirmDialog';
import SegmentedToggleGroup from '@/components/SegmentedToggleGroup';
import AccountSpend from '@/components/spend/AccountSpend';
import SpendReport from '@/components/spend/SpendReport';
import ProviderBilling from '@/components/spend/ProviderBilling';
import { isSpendRange, SPEND_RANGES } from '@/lib/spend/rollup';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { useSpendStore } from '@/store/useSpendStore';

type SpendSource = 'account' | 'browser';

function SpendView() {
  const [rangeParam, setRangeParam] = useQueryState('range');
  const range = isSpendRange(rangeParam) ? rangeParam : 'month';
  const accountStatus = useAccountStore((state) => state.status);
  const ownerId = useAccountStore((state) => state.session?.account?.id ?? null);
  const accountEpoch = useAccountStore((state) => state.epoch);
  const localEntries = useSpendStore((state) => state.entries);
  const hasHydrated = useSpendStore((state) => state.hasHydrated);
  const removeLocal = useSpendStore((state) => state.remove);
  const clearLocal = useSpendStore((state) => state.clear);
  const [clearIntent, setClearIntent] = useState<{
    source: SpendSource;
    scope: string;
    clear: () => void | Promise<void>;
  } | null>(null);
  const [now] = useState(() => Date.now());
  const accountScope = `${ownerId ?? 'guest'}:${accountEpoch}`;
  const source: SpendSource = ownerId ? 'account' : 'browser';
  const [accountEmpty, setAccountEmpty] = useState<{ scope: string; empty: boolean } | null>(null);
  const onAccountEmptyChange = useCallback((empty: boolean) => setAccountEmpty({ scope: accountScope, empty }), [accountScope]);
  const hasAnyEntries = source === 'browser'
    ? localEntries.length > 0
    : accountEmpty?.scope === accountScope && !accountEmpty.empty;
  const activeClearIntent = clearIntent?.scope === accountScope && clearIntent.source === source ? clearIntent : null;

  useEffect(() => {
    useAppStore.persist.rehydrate();
    void useSpendStore.persist.rehydrate();
  }, []);

  const waitingForSession = accountStatus === 'loading' && !ownerId;

  return (
    <div className="min-h-screen relative w-full overflow-x-clip">
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[hsl(var(--tint-hue)_38%_5%/0.72)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-3.5 sm:px-8 md:px-12 md:py-4 lg:px-16">
          <Link href="/" aria-label="Go to Scene Assembly home" className="block min-w-0 rounded-lg">
            <BrandWordmark className="h-8 w-auto text-[var(--foreground)] sm:h-9" />
          </Link>
          <Link href="/" className="btn-secondary">Back to studio</Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-4 px-6 py-10 sm:px-8 md:px-12 md:py-14 lg:px-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="display text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">Spend</h1>
            <p className="mt-3 text-base leading-relaxed text-[var(--foreground-muted)]">What your generations cost. Estimates use published rates.</p>
          </div>
          {hasAnyEntries && (
            <div className="w-full sm:w-auto sm:min-w-[22rem]">
              <SegmentedToggleGroup
                label="Range"
                options={SPEND_RANGES}
                value={range}
                onChange={(value) => void setRangeParam(value === 'month' ? null : String(value))}
              />
            </div>
          )}
        </div>

        {!waitingForSession && <ProviderBilling source={source} ownerId={ownerId} epoch={accountEpoch} />}

        {waitingForSession ? (
          <div className="flex items-center justify-center py-16"><div className="loading-spinner" /></div>
        ) : accountStatus === 'unavailable' && ownerId && source === 'account' ? (
          <div role="alert" className="glass-card border-[var(--neon-pink)]/35 p-6 text-center">
            <p className="text-[var(--foreground)]">Account spend is temporarily unavailable.</p>
            <p className="field-hint mt-2">Try again in a moment. Your browser ledger is kept separately and is unaffected.</p>
          </div>
        ) : source === 'account' && ownerId ? (
          <AccountSpend
            ownerId={ownerId}
            range={range}
            now={now}
            onClearRequest={(clear) => setClearIntent({ source: 'account', scope: accountScope, clear })}
            onEmptyChange={onAccountEmptyChange}
          />
        ) : (
          <>
            {accountStatus === 'unavailable' && !ownerId && (
              <div role="alert" className="rounded-xl border border-[var(--neon-violet)]/30 bg-[var(--neon-violet)]/5 px-4 py-3 text-sm">
                <p className="text-[var(--foreground)]">Account status could not be checked. Showing this browser&apos;s separate spend ledger.</p>
              </div>
            )}
            <SpendReport
              source="browser"
              entries={localEntries}
              range={range}
              now={now}
              loading={!hasHydrated}
              onRemove={removeLocal}
              onClearRequest={() => setClearIntent({ source: 'browser', scope: accountScope, clear: clearLocal })}
            />
          </>
        )}
      </main>

      <ConfirmDialog
        open={Boolean(activeClearIntent)}
        title={activeClearIntent?.source === 'account' ? 'Clear account spend history?' : 'Clear this browser ledger?'}
        description={activeClearIntent?.source === 'account'
          ? 'This permanently removes every spend record in your account on every device. Provider billing records are unaffected.'
          : 'This removes every recorded run from this browser. This cannot be undone.'}
        confirmLabel="Clear ledger"
        onConfirm={() => {
          const intent = activeClearIntent;
          setClearIntent(null);
          if (intent) void intent.clear();
        }}
        onCancel={() => setClearIntent(null)}
      />
    </div>
  );
}

export default function SpendPage() {
  return <Suspense fallback={null}><SpendView /></Suspense>;
}
