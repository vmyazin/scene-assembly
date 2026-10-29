'use client';

import { useEffect } from 'react';
import GalleryGrid from '@/components/GalleryGrid';
import CloudAssetGrid from '@/components/account/CloudAssetGrid';
import { useAccountLibrary } from '@/lib/account/use-library';
import { useAccountStore } from '@/store/useAccountStore';
import { useGalleryStore } from '@/store/useGalleryStore';
import { useLibraryDialog } from '@/store/useLibraryDialog';

function EmptyRecent() {
  return <div className="rounded-lg border border-dashed border-[var(--border-input)] px-5 py-6 text-center text-sm text-[var(--foreground-muted)]">
    <p>Your creations will appear here.</p><p className="mt-1 text-xs">Choose a tool to make your first image or video.</p>
  </div>;
}
function BrowserRecent() {
  const hydrated = useGalleryStore(state => state.hydrated);
  const count = useGalleryStore(state => state.records.length);
  const error = useGalleryStore(state => state.storageError);
  useEffect(() => { void useGalleryStore.getState().hydrate(); }, []);
  if (!hydrated) return <p role="status" className="text-sm text-[var(--foreground-muted)]">Loading recent creations…</p>;
  if (error) return <p role="status" className="text-sm text-[var(--foreground-muted)]">{error}</p>;
  return count ? <GalleryGrid recent /> : <EmptyRecent />;
}
function CloudRecent({ ownerId }: { ownerId: string }) {
  const library = useAccountLibrary(ownerId);
  if (library.loading) return <p role="status" className="text-sm text-[var(--foreground-muted)]">Loading recent creations…</p>;
  if (library.error) return <div role="status" className="text-sm text-[var(--foreground-muted)]">{library.error} <button type="button" className="underline" onClick={library.refresh}>Try again</button></div>;
  return library.assets.length ? <CloudAssetGrid assets={library.assets.slice(0, 4)} ownerId={ownerId} recent onChanged={library.refresh} /> : <EmptyRecent />;
}
export default function RecentCreations() {
  const status = useAccountStore(state => state.status);
  const ownerId = useAccountStore(state => state.session?.account?.id);
  const epoch = useAccountStore(state => state.epoch);
  const openLibrary = useLibraryDialog(state => state.openLibrary);
  return <section aria-labelledby="home-recent-creations">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 id="home-recent-creations" className="text-sm font-semibold">Recent creations</h3>
      <button type="button" className="min-h-9 cursor-pointer text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)]" onClick={() => openLibrary()}>View library →</button>
    </div>
    {status === 'loading' ? <p role="status" className="text-sm text-[var(--foreground-muted)]">Loading recent creations…</p> : ownerId ? <CloudRecent key={`${ownerId}:${epoch}`} ownerId={ownerId} /> : <BrowserRecent />}
  </section>;
}
