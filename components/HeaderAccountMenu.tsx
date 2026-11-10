'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Bot,
  ChevronDown,
  CircleDollarSign,
  CircleUserRound,
  Key,
  Loader2,
  LogOut,
  Plug,
  UserRound,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';

import AccountAvatar from '@/components/account/AccountAvatar';
import { usePopoverMenu } from '@/components/usePopoverMenu';
import { signOut } from '@/lib/account/sign-out';
import { useAccountSpendTotals } from '@/lib/account/use-spend-totals';
import { setUiSoundsEnabled } from '@/lib/notify/chime';
import { formatUsdTotal } from '@/lib/spend/format';
import { useAccountStore, type AccountIdentity } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { useConnectionsDialog } from '@/store/useConnectionsDialog';

const ROW =
  'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline-none motion-reduce:transition-none';
const ROW_ICON = 'shrink-0 text-[var(--foreground-muted)]';
const ASIDE = 'ml-auto shrink-0 pl-3 text-xs text-[var(--foreground-muted)]';

/**
 * The studio header's one identity control, at its right edge.
 *
 * Before this the header was the same for everyone: Account and Spend sat only
 * in the footer and ⌘K (which phones do not have), and Sign out existed only
 * inside /account. A signed-in person now gets a menu here; a guest gets a
 * quiet link to /sign-in and nothing else.
 *
 * "Quiet" is the rule from AGENTS.md, not a styling preference: the studio
 * must not promote accounts to guests, so the link has no fill and no border
 * and Connections stays the primary action until a key exists.
 *
 * The session resolves a moment after paint. Until it has, the slot holds its
 * 44px with an empty ring, so the row does not shift and a signed-in person
 * never watches "Sign in" flash where their photo is about to be.
 */
export default function HeaderAccountMenu({ showSounds = true }: { showSounds?: boolean }) {
  const status = useAccountStore((s) => s.status);
  const account = useAccountStore((s) => s.session?.account ?? null);
  const epoch = useAccountStore((s) => s.epoch);

  // Nothing here can work without the account service, and a ring that never
  // resolves reads as a broken photo, so the slot goes rather than waits.
  if (status === 'unavailable') return null;

  if (status !== 'ready') {
    return (
      <span data-account-slot="loading" aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center">
        <span className="h-7 w-7 rounded-full ring-1 ring-[var(--border-hover)]" />
      </span>
    );
  }

  if (!account) {
    return (
      <Link
        href="/sign-in"
        aria-label="Sign in"
        data-account-slot="guest"
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-2 text-sm text-[var(--foreground-muted)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)] lg:px-2.5"
      >
        <UserRound size={16} aria-hidden="true" />
        {/* From `lg`, not `sm`: with the words the one-row header is 11px too
            wide at 768, and the wordmark gave up the difference until it
            touched the Image tab. The label names the icon below that. */}
        <span className="hidden lg:inline">Sign in</span>
      </Link>
    );
  }

  // Keyed like every other account surface, so one person's open menu or
  // pending sign-out can never carry over to the next session.
  return <SignedInMenu key={`${account.id}:${epoch}`} account={account} epoch={epoch} showSounds={showSounds} />;
}

function SignedInMenu({ account, epoch, showSounds }: { account: AccountIdentity; epoch: number; showSounds: boolean }) {
  // Destructured, as in `ActionMenu`: the refs lint rule reads `menu.x` on an
  // object that holds refs as a ref access during render.
  const { open, host, menuId, triggerRef, panelRef, panelStyle, close, closeToTrigger, onPanelKeyDown, triggerProps } =
    usePopoverMenu<HTMLButtonElement>();
  const [signingOut, setSigningOut] = useState(false);
  const savedConnections = useAccountStore((s) => s.session?.connections?.length ?? 0);
  const openConnections = useConnectionsDialog((s) => s.openConnections);
  const uiSoundsEnabled = useAppStore((s) => s.uiSoundsEnabled);

  /**
   * Stays on the page. The studio works without an account, so signing out
   * here turns the person into a guest where they stand; only /account, which
   * has nothing to show a guest, moves on to /sign-in.
   */
  async function leave() {
    setSigningOut(true);
    try {
      await signOut(account.id, epoch);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Could not sign out.');
      setSigningOut(false);
    }
    // No reset on success: the session change unmounts this menu.
  }

  const navigate = (href: string, icon: LucideIcon, label: string, aside?: ReactNode, description?: string) => {
    const Icon = icon;
    return (
      <Link href={href} role="menuitem" tabIndex={-1} onClick={close} className={ROW}>
        <Icon size={15} aria-hidden="true" className={ROW_ICON} />
        <span className="min-w-0">
          <span className="block">{label}</span>
          {description && <span className="mt-0.5 block text-xs leading-snug text-[var(--foreground-subtle)]">{description}</span>}
        </span>
        {aside}
      </Link>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Account menu"
        title={account.email}
        disabled={signingOut}
        data-account-slot="account"
        {...triggerProps}
        className={`inline-flex h-11 shrink-0 items-center gap-1 rounded-full border py-0 pl-[7px] pr-2 text-[var(--foreground-muted)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-60 ${
          open ? 'border-[var(--border-hover)] bg-[var(--surface-hover)] text-[var(--foreground)]' : 'border-[var(--border)]'
        }`}
      >
        <AccountAvatar name={account.name} picture={account.picture} size={28} />
        {signingOut ? (
          <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {open && host &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label="Account menu"
            onKeyDown={onPanelKeyDown}
            style={panelStyle}
            // Full width on a phone, where a 20rem panel would leave a sliver
            // of page beside it; the shared placement keeps it on screen.
            className="fixed z-[80] w-[calc(100vw-1rem)] overflow-y-auto rounded-(--radius) border border-[var(--border-hover)] bg-[var(--background-elevated)] p-1.5 shadow-[var(--shadow-md)] sm:w-80"
          >
            <div className="flex items-center gap-2.5 px-2.5 pb-2.5 pt-2">
              <AccountAvatar name={account.name} picture={account.picture} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">{account.name}</p>
                <p className="truncate text-xs text-[var(--foreground-muted)]">{account.email}</p>
              </div>
            </div>
            <Rule />
            <div role="group" aria-label="Account">
              {navigate('/account', CircleUserRound, 'Your account', undefined, 'Cloud library, jobs, storage')}
              {navigate('/spend', CircleDollarSign, 'Spend', <SpendTotal ownerId={account.id} />)}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  // Focus goes back to the avatar first, so the dialog has
                  // an opener to return it to when it closes.
                  closeToTrigger();
                  openConnections();
                }}
                className={ROW}
              >
                <Key size={15} aria-hidden="true" className={ROW_ICON} />
                <span>Connections</span>
                {savedConnections > 0 && <span className={ASIDE}>{savedConnections} saved</span>}
              </button>
              {/* The agents panel has no anchor of its own on /account; the
                  only hashes that page reads are #jobs and #asset-<id>. */}
              {navigate('/account', Bot, 'Connected agents')}
              {navigate('/docs/mcp', Plug, 'MCP docs')}
            </div>
            {showSounds && (
              <>
                <Rule />
                {/* Stays open: a switch is something you flip and look at. */}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={uiSoundsEnabled}
                  tabIndex={-1}
                  onClick={() => setUiSoundsEnabled(!uiSoundsEnabled)}
                  className={ROW}
                >
                  {uiSoundsEnabled ? (
                    <Volume2 size={15} aria-hidden="true" className={ROW_ICON} />
                  ) : (
                    <VolumeX size={15} aria-hidden="true" className={ROW_ICON} />
                  )}
                  <span>Interface sounds</span>
                  <span
                    aria-hidden="true"
                    className={`ml-auto flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors motion-reduce:transition-none ${
                      uiSoundsEnabled ? 'bg-[var(--neon-cyan)]/35' : 'bg-[var(--border-hover)]'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded-full transition-transform motion-reduce:transition-none ${
                        uiSoundsEnabled ? 'translate-x-4 bg-[var(--neon-cyan)]' : 'bg-[var(--foreground-muted)]'
                      }`}
                    />
                  </span>
                </button>
              </>
            )}
            <Rule />
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                closeToTrigger();
                void leave();
              }}
              className={ROW}
            >
              <LogOut size={15} aria-hidden="true" className={ROW_ICON} />
              <span>Sign out</span>
            </button>
          </div>,
          host
        )}
    </>
  );
}

function Rule() {
  return <div role="separator" className="mx-1 my-1.5 h-px bg-[var(--border-hover)]" />;
}

/**
 * The all-time figure the footer shows, from the same hook. Mounted with the
 * panel, so the request is made when the menu opens rather than on every page.
 * A zero is left out, as it is in the footer: "$0.00" tells a new account nothing.
 */
function SpendTotal({ ownerId }: { ownerId: string }) {
  const spend = useAccountSpendTotals(ownerId);
  if (spend.totals?.costUsd === 0) return null;
  return (
    <span className={ASIDE} title={spend.error ?? 'All-time account spend'}>
      {spend.totals ? formatUsdTotal(spend.totals.costUsd) : '—'}
    </span>
  );
}
