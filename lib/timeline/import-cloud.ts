import { accountAssetUrl } from '@/lib/account/client';
import type { CloudAsset } from '@/lib/account/contracts';
import { slugify } from '@/lib/example-prompts';
import { MAX_REMOTE_VIDEO_BYTES } from '@/lib/media-download';
import { probeDimensions } from '@/lib/timeline/probe';
import { extractLastFrameFromBlob } from '@/lib/video-frame';
import { useAccountStore } from '@/store/useAccountStore';
import { useGalleryStore } from '@/store/useGalleryStore';

/**
 * Bringing a clip the account generated in the cloud onto the timeline.
 *
 * The timeline only ever resolves clips through `acquireClipMedia`, which looks
 * records up in the gallery store — so a cloud asset has to become a gallery
 * record before it can be placed at all. This is the direction that was
 * missing: `lib/account/import.ts` sends browser bytes up, and
 * `lib/account/reference.ts` pulls a cloud *image* into the draft, but nothing
 * brought a cloud *video* down into the library the editor reads.
 *
 * Records made here are pinned for the same reason imported ones are. Their
 * only re-fetchable source is the relative `/api/account/assets/<id>/content`,
 * and `isDownloadableMediaUrl` rejects a relative URL — so acquire's
 * download-again branch cannot rescue these bytes once eviction takes them.
 * Holding the file is the only durability they have.
 */

const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

/**
 * Derived from the asset id rather than minted, so adding the same cloud clip
 * twice places it on the timeline twice without downloading it twice. Mirrors
 * `defaultAccountImportId`'s stable-id trick in the opposite direction.
 */
export function cloudClipRecordId(assetId: string) {
  return `cloud-${assetId}`;
}

/**
 * Download one saved cloud video into the browser gallery and return the id of
 * the record it became. Throws a message meant to be shown as-is: every caller
 * surfaces failures as a toast.
 */
export async function saveCloudVideoToGallery(
  asset: CloudAsset,
  ownerId: string,
  options: { signal?: AbortSignal } = {}
): Promise<string> {
  const epoch = useAccountStore.getState().epoch;
  // Re-checked after every await. A session change mid-download must not write
  // one account's bytes into another's library — the same guard
  // `addAccountAssetAsReference` runs, for the same reason.
  const assertOwner = () => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const current = useAccountStore.getState();
    if (
      current.status !== 'ready' ||
      current.epoch !== epoch ||
      current.session?.account?.id !== ownerId
    ) {
      throw new Error('Your account changed. Choose the clip again.');
    }
  };

  assertOwner();
  if (asset.kind !== 'video' || !asset.mimeType.startsWith('video/')) {
    throw new Error('Choose a video to add to the timeline.');
  }
  if (asset.bytes > MAX_REMOTE_VIDEO_BYTES) {
    throw new Error(
      `This clip is over ${megabytes(MAX_REMOTE_VIDEO_BYTES)} and is too large to add to the timeline.`
    );
  }

  const recordId = cloudClipRecordId(asset.id);
  await useGalleryStore.getState().hydrate();
  // Bytes already in hand: adding this clip again is a second placement, not a
  // second download. A record without bytes is a dangling entry worth redoing.
  if (useGalleryStore.getState().records.some((record) => record.id === recordId && record.blob)) {
    return recordId;
  }

  const url = await accountAssetUrl(asset.id, options.signal, ownerId);
  assertOwner();
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: options.signal,
  });
  assertOwner();
  if (!response.ok) throw new Error('This cloud clip is no longer available.');

  const blob = await response.blob();
  assertOwner();
  if (blob.size === 0) throw new Error('This cloud clip is empty.');
  if (blob.size > MAX_REMOTE_VIDEO_BYTES) {
    throw new Error(
      `This clip is over ${megabytes(MAX_REMOTE_VIDEO_BYTES)} and is too large to add to the timeline.`
    );
  }

  let probed;
  try {
    probed = await probeDimensions(blob);
  } catch {
    throw new Error('This browser could not read that clip.');
  }
  // Opens but reports nothing usable — it would reach the encoder as a 0x0 frame.
  if (!probed.width || !probed.height) throw new Error('This browser could not read that clip.');

  // The *last* frame, matching what acquire and Keep store: "Continue from last
  // frame" depends on the poster being the end of the clip, not its opening.
  const poster = await extractLastFrameFromBlob(blob).catch(() => undefined);
  assertOwner();

  const title = asset.metadata.prompt || 'Cloud clip';
  const created = await useGalleryStore.getState().record({
    id: recordId,
    kind: 'video',
    prompt: title,
    slug: slugify(title),
    provider: asset.metadata.provider,
    modelId: asset.metadata.modelId,
    inputMode: asset.metadata.inputMode,
    // Carried across so "Reuse settings" still works on the local copy.
    controlValues: asset.metadata.values,
    mimeType: blob.type || asset.mimeType,
    blob,
    posterBlob: poster,
    pinned: true,
    width: probed.width,
    height: probed.height,
    durationSeconds: probed.durationSeconds,
  });

  // `record()` returns null when storage refused — nothing was written, so this
  // is a total failure rather than a degraded success. The store's own reason
  // (quota, usually) is more useful than a generic line.
  if (!created) {
    throw new Error(
      useGalleryStore.getState().storageError ??
        'Your library is full, so this clip was not added.'
    );
  }

  return created.id;
}
