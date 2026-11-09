'use client';

import { useEffect, type ReactNode } from 'react';
import GalleryGrid from '@/components/GalleryGrid';
import CloudAssetGrid from '@/components/account/CloudAssetGrid';
import { useAccountLibrary } from '@/lib/account/use-library';
import { useAccountStore } from '@/store/useAccountStore';
import { useGalleryStore } from '@/store/useGalleryStore';
import { useLibraryDialog } from '@/store/useLibraryDialog';

// The section only exists once there is something to show: while sources load
// or when nothing has been made yet, the home page ends at the launcher.
function RecentSection({ children }: { children: ReactNode }) {
  const openLibrary = useLibraryDialog(state => state.openLibrary);
  return <section aria-labelledby="home-recent-creations">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 id="home-recent-creations" className="text-sm font-semibold">Recent creations</h3>
      <button type="button" className="min-h-9 cursor-pointer text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]" onClick={() => openLibrary()}>View library →</button>
    </div>
    {children}
  </section>;
}
function BrowserRecent() {
  const hydrated = useGalleryStore(state => state.hydrated);
  const count = useGalleryStore(state => state.records.length);
  const error = useGalleryStore(state => state.storageError);
  useEffect(() => { void useGalleryStore.getState().hydrate(); }, []);
  if (!hydrated) return null;
  if (error) return <RecentSection><p role="status" className="text-sm text-[var(--foreground-muted)]">{error}</p></RecentSection>;
  return count ? <RecentSection><GalleryGrid recent /></RecentSection> : null;
}
function CloudRecent({ ownerId }: { ownerId: string }) {
  const library = useAccountLibrary(ownerId);
  if (library.loading) return null;
  if (library.error) return <RecentSection><div role="status" className="text-sm text-[var(--foreground-muted)]">{library.error} <button type="button" className="underline" onClick={library.refresh}>Try again</button></div></RecentSection>;
  return library.assets.length ? <RecentSection><CloudAssetGrid assets={library.assets.slice(0, 4)} ownerId={ownerId} recent onChanged={library.refresh} /></RecentSection> : null;
}
export default function RecentCreations() {
  const status = useAccountStore(state => state.status);
  const ownerId = useAccountStore(state => state.session?.account?.id);
  const epoch = useAccountStore(state => state.epoch);
  if (status === 'loading') return null;
  return ownerId ? <CloudRecent key={`${ownerId}:${epoch}`} ownerId={ownerId} /> : <BrowserRecent />;
}
