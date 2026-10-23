import { importGalleryRecord, isImportableGalleryRecord } from '@/lib/account/import';
import { slugify } from '@/lib/example-prompts';
import { LOCAL_PROVIDER, titleFromFileName } from '@/lib/timeline/import-local';
import { useAccountStore } from '@/store/useAccountStore';
import type { DraftReferenceInput } from '@/store/useDraftStore';
import { useGalleryStore } from '@/store/useGalleryStore';

/**
 * Keeping the images a reader attaches, rather than letting them evaporate.
 *
 * A reference used to live only in `useDraftStore`, which holds `File` handles
 * and dies with the tab. So an image uploaded for one clip could not be reused
 * for the next one without finding it on disk again — and the picker that
 * offers "stored images" was empty for anyone who had only ever uploaded, which
 * is what made Replace a dead end.
 *
 * Every upload is now kept in the browser library, and pushed to the cloud
 * library as well when there is an account to hold it. Both are the same call:
 * the cloud import takes a gallery record, so the local write is what makes the
 * upload importable at all.
 */

/**
 * A four-lane hash for a build with no `crypto.subtle` — a plain HTTP origin,
 * say. Same shape as the one `lib/account/import.ts` runs over strings.
 */
function fallbackHash(bytes: Uint8Array): string {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = 0xdeadbeef;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 2654435761);
    b = Math.imul(b ^ byte, 1597334677);
    c = Math.imul(c ^ byte, 2246822507);
    d = Math.imul(d ^ byte, 3266489909);
  }
  return [a, b, c, d].map(part => (part >>> 0).toString(16).padStart(8, '0')).join('');
}

/**
 * The record id for a file, derived from its bytes.
 *
 * Content rather than name or timestamp, because `prepareReferences` re-encodes
 * before this ever sees the file: the name and modified time it arrives with
 * were minted moments ago and differ on every upload. Deriving from the bytes
 * makes attaching the same picture to a second clip a no-op in both libraries —
 * the cloud import id comes from this id, and an import that already completed
 * returns early instead of spending the quota twice.
 */
export async function uploadRecordId(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes);
      const hex = [...new Uint8Array(digest).slice(0, 16)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
      return `upload-${hex}`;
    } catch {
      // Falls through: a digest that will not run is not a reason to lose the file.
    }
  }
  return `upload-${fallbackHash(bytes)}`;
}

async function keepOne(entry: DraftReferenceInput): Promise<void> {
  const { file } = entry;
  if (!file.type.startsWith('image/')) return;

  const id = await uploadRecordId(file);
  await useGalleryStore.getState().hydrate();

  // Already kept: the same bytes attached again cost nothing.
  const held = useGalleryStore.getState().records.find(record => record.id === id);
  const title = titleFromFileName(file.name);
  const record = held?.blob
    ? held
    : await useGalleryStore.getState().record({
        id,
        kind: 'image',
        prompt: title,
        slug: slugify(title),
        // Never generated, so it carries no settings to replay — the same
        // provider an imported clip uses, and the one GalleryGrid hides
        // "Reuse settings" for.
        provider: LOCAL_PROVIDER,
        controlValues: {},
        mimeType: file.type,
        blob: file,
      });

  // `record()` returns null when storage refused, and sets its own
  // `storageError` that the library surfaces. Nothing more to say here.
  if (!record) return;

  const account = useAccountStore.getState();
  const owner = account.session?.account?.id;
  if (!owner || !isImportableGalleryRecord(record)) return;
  await importGalleryRecord(record, owner, account.epoch, new AbortController().signal);
}

/**
 * Keep each uploaded image, in the background.
 *
 * Never throws and never blocks: this runs after the reference is already in
 * the draft, so a full library or a refused import must not cost the reader the
 * generation they were in the middle of starting.
 */
export async function keepUploadedImages(entries: DraftReferenceInput[]): Promise<void> {
  for (const entry of entries) {
    try {
      await keepOne(entry);
    } catch {
      // Storing is a courtesy. The reference itself is already in hand.
    }
  }
}
