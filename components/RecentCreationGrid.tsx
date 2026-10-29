'use client';

import { useState } from 'react';
import VideoPlayer from '@/components/video/VideoPlayer';
import { useLibraryDialog } from '@/store/useLibraryDialog';

export interface RecentCreation {
  id: string; title: string; provider: string; kind: 'image' | 'video';
  url?: string; isVideo?: boolean;
}

function RecentCard({ item }: { item: RecentCreation }) {
  const [failed, setFailed] = useState(false);
  const openLibrary = useLibraryDialog(state => state.openLibrary);
  return <li className="min-w-0">
    <button type="button" aria-label={`Open library: ${item.title}`} onClick={() => openLibrary()}
      className="block w-full cursor-pointer overflow-hidden rounded-lg bg-[var(--background-elevated)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--neon-cyan)]">
      <span className="flex aspect-video w-full items-center justify-center overflow-hidden">
        {!item.url || failed ? <span className="px-2 text-center text-[0.625rem] text-[var(--foreground-muted)]">Preview unavailable · Open library</span> : item.isVideo ?
          <VideoPlayer src={item.url} fit="cover" transport="none" className="h-full w-full" /> :
          // eslint-disable-next-line @next/next/no-img-element -- blob and authenticated library URLs
          <img src={item.url} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />}
      </span>
    </button>
    <p className="mt-1.5 truncate text-xs font-medium" title={item.title}>{item.title}</p>
    <p className="mt-0.5 text-[0.625rem] text-[var(--foreground-muted)]">{item.provider} · {item.kind === 'image' ? 'Image' : 'Video'}</p>
  </li>;
}

/** Compact, read-only entry points; all asset actions remain in the existing library. */
export default function RecentCreationGrid({ items }: { items: RecentCreation[] }) {
  return <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">{items.map(item => <RecentCard key={`${item.id}:${item.url ?? ''}`} item={item} />)}</ul>;
}
