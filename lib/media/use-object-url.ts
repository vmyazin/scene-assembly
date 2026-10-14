// lib/media/use-object-url.ts
'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * An object URL for one blob, revoked when the blob changes or the caller
 * unmounts.
 *
 * Created in an effect rather than a `useMemo`: StrictMode runs the cleanup
 * and then the effect again, and a memoised URL stays revoked after that first
 * cleanup, so a preview showed a broken image in development.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      // Synchronises an external browser resource, so the state follows it here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

const EMPTY: ReadonlyMap<string, string> = new Map();

/**
 * One object URL per key, created once and kept until that key goes away or
 * comes back holding a different blob. Pass a memoised map.
 *
 * Keyed by blob identity rather than rebuilt with the map: rebuilding revoked
 * every URL whenever any entry changed, including ones an element was still
 * loading — a restored timeline ended on a black frame with ERR_FILE_NOT_FOUND
 * for a blob that had been valid a moment earlier.
 */
export function useObjectUrls(blobs: ReadonlyMap<string, Blob>): ReadonlyMap<string, string> {
  const heldRef = useRef(new Map<string, { blob: Blob; url: string }>());
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(EMPTY);

  useEffect(() => {
    const held = heldRef.current;
    let changed = false;
    for (const [key, entry] of [...held]) {
      if (blobs.get(key) === entry.blob) continue;
      URL.revokeObjectURL(entry.url);
      held.delete(key);
      changed = true;
    }
    for (const [key, blob] of blobs) {
      if (held.has(key)) continue;
      held.set(key, { blob, url: URL.createObjectURL(blob) });
      changed = true;
    }
    if (changed) setUrls(new Map([...held].map(([key, entry]) => [key, entry.url])));
  }, [blobs]);

  // Whatever is still held when the caller goes away.
  useEffect(() => {
    const held = heldRef.current;
    return () => {
      for (const entry of held.values()) URL.revokeObjectURL(entry.url);
      held.clear();
    };
  }, []);

  return urls;
}
