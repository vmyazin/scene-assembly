import { slugify } from '@/lib/example-prompts';
import { MAX_REMOTE_VIDEO_BYTES } from '@/lib/media-download';
import { extractLastFrameFromBlob, isVideoFile } from '@/lib/video-frame';
import { probeDimensions } from '@/lib/timeline/probe';
import { useGalleryStore } from '@/store/useGalleryStore';

/**
 * Bringing a video the app never generated into the library.
 *
 * The one thing that makes an imported record different from every other one:
 * it has no `sourceUrl`, so nothing can ever fetch it again. A generated clip
 * that gets evicted loses a URL that may still work; an evicted import is gone
 * from the app for good. That is why these are pinned at creation rather than
 * merely stored, and why a storage refusal has to be reported loudly — a failed
 * import leaves nothing behind at all.
 */

/** What the library calls a record that came off the user's own disk. */
export const LOCAL_PROVIDER = 'local';

export type ImportRejection = 'not-video' | 'empty' | 'too-large' | 'unreadable' | 'storage-full';

export interface ImportRejected {
  status: 'rejected';
  reason: ImportRejection;
  message: string;
  /** So a multi-file import can say which file failed. */
  fileName: string;
}

export interface ImportSucceeded {
  status: 'imported';
  recordId: string;
  fileName: string;
}

export type ImportResult = ImportSucceeded | ImportRejected;

const MESSAGES: Record<ImportRejection, string> = {
  'not-video': 'That is not a video file.',
  empty: 'That file is empty.',
  'too-large': 'That file is larger than this app will store.',
  unreadable: 'This browser could not read that video file.',
  'storage-full': 'Your library is full, so this clip was not imported.',
};

const rejected = (reason: ImportRejection, fileName: string): ImportRejected => ({
  status: 'rejected',
  reason,
  message: MESSAGES[reason],
  fileName,
});

/** `rooftop shot FINAL v2.mp4` → `rooftop shot final v2`, so the card reads like a name. */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return withoutExtension.trim() || 'Imported clip';
}

export async function importLocalVideo(file: File): Promise<ImportResult> {
  if (!isVideoFile(file)) return rejected('not-video', file.name);
  if (file.size === 0) return rejected('empty', file.name);
  if (file.size > MAX_REMOTE_VIDEO_BYTES) return rejected('too-large', file.name);

  let probed;
  try {
    probed = await probeDimensions(file);
  } catch {
    return rejected('unreadable', file.name);
  }
  // Opens but reports nothing usable — it would reach the encoder as a 0x0 frame.
  if (!probed.width || !probed.height) return rejected('unreadable', file.name);

  const poster = await extractLastFrameFromBlob(file).catch(() => undefined);
  const title = titleFromFileName(file.name);

  const created = await useGalleryStore.getState().record({
    kind: 'video',
    // The filename is all the provenance an imported clip has, so it stands in
    // for the prompt — which is what the card and the timeline row read.
    prompt: title,
    slug: slugify(title),
    provider: LOCAL_PROVIDER,
    // Nothing to replay: an imported clip was never generated with settings.
    // `GalleryGrid` hides "Reuse settings" for this provider rather than
    // offering a button that would silently do nothing.
    controlValues: {},
    mimeType: file.type || 'video/mp4',
    blob: file,
    posterBlob: poster,
    // Not optional. With no `sourceUrl` there is no second chance: an evicted
    // import cannot be recovered by any path the app has.
    pinned: true,
    width: probed.width,
    height: probed.height,
    durationSeconds: probed.durationSeconds,
  });

  // `record()` returns null when storage refused — nothing was written, so
  // this is a total failure rather than a degraded success, and it is the one
  // outcome the user must not mistake for an import that worked.
  if (!created) return rejected('storage-full', file.name);

  return { status: 'imported', recordId: created.id, fileName: file.name };
}

/**
 * Import several files, continuing past a failure so one bad file in a
 * multi-select does not discard the rest. Sequential on purpose: these are
 * large blobs being probed and written, and running them together would spike
 * memory for no wall-clock win the user would notice.
 */
export async function importLocalVideos(files: File[]): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const file of files) {
    results.push(await importLocalVideo(file));
  }
  return results;
}
