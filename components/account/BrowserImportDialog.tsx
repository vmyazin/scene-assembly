// components/account/BrowserImportDialog.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CloudUpload, Film, Image as ImageIcon } from 'lucide-react';

import DialogPortal from '@/components/DialogPortal';
import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';
import { formatAccountBytes as size, type AccountStorage } from '@/lib/account/use-library';
import { browserKeyCandidates } from '@/lib/account/key-import';
import { importRecordTitle, useBrowserAssetImport } from '@/lib/account/use-asset-import';
import { useAppStore } from '@/store/useAppStore';
import type { GalleryRecord } from '@/lib/gallery/storage';
import VideoPlayer from '@/components/video/VideoPlayer';
import AccountKeyImport from './AccountKeyImport';

type Tab = 'files' | 'keys';
type Kind = 'all' | 'image' | 'video';

/**
 * A thumbnail for a local record, decoded only while its cell is on screen.
 *
 * A device can hold ninety of these, and ninety live object URLs is ninety
 * decoded bitmaps held for as long as the dialog is open. Each cell mints its
 * own URL when it intersects the viewport and revokes it on unmount, so the
 * cost tracks what is actually being looked at.
 */
function LocalThumb({ record }: { record: GalleryRecord & { blob: Blob } }) {
  const [url, setUrl] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = holder.current;
    // jsdom implements neither of these, and a viewer with object URLs disabled
    // should still get a usable picker: without a URL the cell falls back to a
    // kind icon rather than failing to render.
    if (typeof URL.createObjectURL !== 'function') return;
    if (!node || typeof IntersectionObserver === 'undefined') {
      const eager = URL.createObjectURL(record.blob);
      setUrl(eager);
      return () => URL.revokeObjectURL(eager);
    }
    let created: string | null = null;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !created) {
        created = URL.createObjectURL(record.blob);
        setUrl(created);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (created) URL.revokeObjectURL(created);
    };
  }, [record.blob]);

  return (
    <div ref={holder} className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-black/40">
      {url
        ? record.kind === 'image'
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt="" className="h-full w-full object-contain" />
          /* No bar: this thumbnail's meaning is carried by the card around it,
             not by the clip. It still gets the poster frame and hover preview. */
          : <VideoPlayer src={url} transport="none" className="h-full w-full" />
        : <span className="text-[var(--foreground-subtle)]">{record.kind === 'image' ? <ImageIcon size={18} aria-hidden="true" /> : <Film size={18} aria-hidden="true" />}</span>}
    </div>
  );
}

export default function BrowserImportDialog({
  open,
  ownerId,
  storage,
  onClose,
  onImported,
}: {
  open: boolean;
  ownerId: string;
  /** Null while the quota is still loading; the fit check then stays quiet. */
  storage: AccountStorage | null;
  onClose: () => void;
  onImported?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('files');
  const [kind, setKind] = useState<Kind>('all');
  const asset = useBrowserAssetImport(ownerId, onImported);
  const apiKey = useAppStore(state => state.apiKey);
  const cfToken = useAppStore(state => state.cfToken);
  const cfAccountId = useAppStore(state => state.cfAccountId);
  const kieApiKey = useAppStore(state => state.kieApiKey);
  const falApiKey = useAppStore(state => state.falApiKey);
  const runwareApiKey = useAppStore(state => state.runwareApiKey);
  const atlasApiKey = useAppStore(state => state.atlasApiKey);
  const piapiApiKey = useAppStore(state => state.piapiApiKey);
  const cometApiKey = useAppStore(state => state.cometApiKey);
  const keyCount = useMemo(
    () => browserKeyCandidates({ apiKey, cfToken, cfAccountId, kieApiKey, falApiKey, runwareApiKey, atlasApiKey, cometApiKey, piapiApiKey }).length,
    [apiKey, atlasApiKey, cfAccountId, cfToken, cometApiKey, piapiApiKey, falApiKey, kieApiKey, runwareApiKey]
  );
  const { eligible, statuses, selected, busy } = asset;

  // A transfer needs this tab alive to send its bytes, so the dialog refuses to
  // close while one is running. Escape and the backdrop are inert; stopping is
  // an explicit choice, not a stray click.
  useAccessibleDialog({ open, onClose: () => { if (!busy) onClose(); }, dialogRef: panelRef });

  const counts = useMemo(() => ({
    all: eligible.length,
    image: eligible.filter(record => record.kind === 'image').length,
    video: eligible.filter(record => record.kind === 'video').length,
  }), [eligible]);

  const visible = useMemo(
    () => (kind === 'all' ? eligible : eligible.filter(record => record.kind === kind)),
    [eligible, kind]
  );

  const free = storage ? Math.max(0, storage.limitBytes - storage.usedBytes - storage.reservedBytes) : null;
  const overBy = free === null ? 0 : Math.max(0, asset.selectedBytes - free);
  const overQuota = overBy > 0;
  const usedShare = storage ? Math.min(100, (storage.usedBytes / storage.limitBytes) * 100) : 0;
  const addShare = storage ? Math.min(100 - usedShare, (asset.selectedBytes / storage.limitBytes) * 100) : 0;

  return (
    <DialogPortal>
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-5"
          onClick={() => { if (!busy) onClose(); }}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Import from this browser"
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={event => event.stopPropagation()}
            className="dialog-panel dialog-mobile-sheet flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden p-0 outline-none"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-4 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="rounded-xl border border-cyan-400/25 bg-gradient-to-br from-cyan-400/15 to-violet-400/15 p-2.5 text-cyan-300">
                  <CloudUpload size={19} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-[var(--foreground)]">Import from this browser</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--foreground-muted)]">Choose local files to add to your private cloud library. Originals remain on this device.</p>
                </div>
              </div>
              <button type="button" disabled={busy} onClick={onClose} className="btn-secondary shrink-0">Close</button>
            </div>

            <div className="flex gap-1 px-4 pt-3 sm:px-5">
              {([['files', `Files ${counts.all}`], ['keys', `Provider keys ${keyCount}`]] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                  className={`rounded-lg px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors motion-reduce:transition-none ${tab === id ? 'bg-[var(--neon-cyan)] font-semibold text-[var(--background)]' : 'text-[var(--foreground-subtle)] hover:text-[var(--foreground)]'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'keys' ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 [&>section]:mt-0">
                <AccountKeyImport ownerId={ownerId} />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" disabled={busy} onClick={() => asset.selectAll(visible.map(record => record.id))} className="btn-secondary px-2.5 py-1 text-xs">Select all</button>
                    <button type="button" disabled={busy || asset.selectedCount === 0} onClick={asset.clearSelection} className="btn-secondary px-2.5 py-1 text-xs">Clear</button>
                    {([['all', `All ${counts.all}`], ['image', `Images ${counts.image}`], ['video', `Video ${counts.video}`]] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={kind === id}
                        onClick={() => setKind(id)}
                        className={`min-h-8 rounded-full border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors motion-reduce:transition-none ${
                          kind === id
                            ? 'border-transparent bg-[var(--neon-cyan)] font-semibold text-[var(--background)]'
                            : id === 'image'
                              ? 'border-[var(--brand-accent)]/35 text-[var(--brand-accent)]'
                              : id === 'video'
                                ? 'border-[var(--neon-purple)]/45 text-violet-300'
                                : 'border-[var(--border-hover)] text-[var(--foreground-muted)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--foreground-subtle)]">Newest first</span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5">
                  {!asset.hydrated ? (
                    <p role="status" className="py-10 text-center text-sm text-[var(--foreground-muted)]">Checking this browser for saved files…</p>
                  ) : visible.length === 0 ? (
                    <p className="py-10 text-center text-sm text-[var(--foreground-muted)]">No eligible local files are available to import.</p>
                  ) : (
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {visible.map(record => {
                        const status = statuses[record.id] ?? 'ready';
                        const title = importRecordTitle(record);
                        const on = selected.has(record.id);
                        return (
                          <li key={record.id} className={`rounded-xl border p-2 transition-colors motion-reduce:transition-none ${on ? 'border-[var(--neon-cyan)] shadow-[0_0_0_1px_var(--neon-cyan)]' : 'border-[var(--border-hover)] hover:border-cyan-400/35'}`}>
                            <label aria-label={`${title}, ${status}`} className="block cursor-pointer">
                              <LocalThumb record={record} />
                              <span className="mt-2 flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={status === 'uploading' || status === 'imported' || asset.restartable.has(record.id)}
                                  onChange={() => asset.toggle(record.id)}
                                  className="size-4 shrink-0 accent-cyan-400"
                                />
                                <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{title}</span>
                              </span>
                              <span className="mt-1 flex items-center justify-between gap-2">
                                <span className="truncate font-mono text-[10px] text-[var(--foreground-subtle)]">{record.provider} · {size(record.blob.size)}</span>
                                <span className={`font-mono text-[10px] capitalize ${status === 'imported' ? 'text-emerald-300' : status === 'error' ? 'text-red-300' : status === 'uploading' ? 'text-cyan-300' : 'text-[var(--foreground-subtle)]'}`}>{status}</span>
                              </span>
                            </label>
                            {asset.restartable.has(record.id) && (
                              <button type="button" className="btn-secondary mt-2 w-full justify-center text-xs" onClick={() => asset.restart(record)}>{`Start new import attempt for ${title}`}</button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {asset.hasLinkOnly && <p className="mt-4 text-xs leading-relaxed text-[var(--foreground-muted)]">Some videos are links only. Choose Keep in the browser library first so the original file is available to import.</p>}
                </div>

                <div className="border-t border-[var(--border)] bg-[var(--background)]/60 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* Counts appear once there is something to count. "0 files
                        selected · 0 MB" next to "Import 0 files" is the same
                        nothing said twice. */}
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {busy
                        ? `${asset.completedCount} of ${asset.batchSize} imported`
                        : asset.selectedCount === 0
                          ? <span className="font-normal text-[var(--foreground-muted)]">Select files to import</span>
                          : `${asset.selectedCount} file${asset.selectedCount === 1 ? '' : 's'} selected · ${size(asset.selectedBytes)}`}
                    </p>
                    <div className="flex gap-2">
                      {/* No idle Cancel: it did exactly what Close does, two
                          controls apart. Stopping a running transfer is a
                          different action, and the only one offered here while
                          Close is locked. */}
                      {busy && <button type="button" onClick={asset.cancel} className="btn-secondary">Stop importing</button>}
                      <button
                        type="button"
                        disabled={busy || asset.selectedCount === 0 || overQuota}
                        onClick={() => void asset.submit()}
                        className="btn-primary min-h-11 px-5"
                      >
                        {busy ? 'Importing…' : asset.selectedCount === 0 ? 'Import' : `Import ${asset.selectedCount} file${asset.selectedCount === 1 ? '' : 's'}`}
                      </button>
                    </div>
                  </div>

                  {storage && (
                    <>
                      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/10">
                        <span className="bg-[var(--foreground-muted)]/50" style={{ width: `${usedShare}%` }} />
                        <span className={overQuota ? 'bg-amber-300' : 'bg-[var(--neon-cyan)]'} style={{ width: `${addShare}%` }} />
                      </div>
                      <p className={`mt-2 text-xs ${overQuota ? 'text-amber-300' : 'text-[var(--foreground-subtle)]'}`}>
                        {overQuota
                          // Blocked rather than attempted: the Worker would take
                          // files until the quota ran out and then fail the rest,
                          // leaving a half-imported batch and spent bandwidth.
                          ? `${size(overBy)} over the space left in your account. Clear space or deselect files to continue.`
                          : `${size(storage.usedBytes)} saved · ${size(free ?? 0)} free · keep this tab open during transfer`}
                      </p>
                    </>
                  )}
                  {asset.notice && <p role="status" className="mt-3 text-sm text-emerald-300">{asset.notice}</p>}
                  {asset.error && <p role="alert" className="mt-3 text-sm text-red-300">{asset.error}</p>}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </DialogPortal>
  );
}
