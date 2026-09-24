import type { ResultStackItem } from '@/components/ResultStack';
import { blobFromDataUrl } from '@/lib/gallery/capture';
import { convertedForDownload } from '@/lib/image/download-format';
import type { ImageFormatPreference } from '@/lib/image/policy';
import {
  boundedMediaBlob,
  downloadRemoteMedia,
  extensionForMimeType,
  isDownloadableMediaUrl,
  MAX_REMOTE_IMAGE_BYTES,
  normalizedMimeType,
  SUPPORTED_RASTER_MIMES,
} from '@/lib/media-download';

export const IMAGE_DOWNLOAD_ERROR = 'Unable to download this image. Please try again.';
export const KIE_URL_EXPIRED_ERROR = 'This Kie result URL has expired and can no longer be downloaded.';

function isSafeFalMediaUrl(value: string) {
  try {
    const url = new URL(value);
    const isFalMedia = url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media');
    return url.protocol === 'https:' && !url.username && !url.password && isFalMedia;
  } catch {
    return false;
  }
}

function clickDownload(href: string, filename: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
}

/**
 * Saves one card of the shared image feed, whichever engine made it.
 *
 * One function because the feed is shared: the Kie panel can be showing a
 * Nano Banana data URL and the Gemini panel a Kie CDN link, so each panel
 * needs every source's path, and two copies of the three would drift. The
 * paths stay as they were per source — a data URL is decoded locally, fal
 * media is fetched only from fal's host with a size bound, and Kie's
 * cross-origin links go through `downloadRemoteMedia` and its proxy fallback.
 *
 * Throws with a message fit for the panel on failure; returns quietly when
 * `signal` aborts, since a superseded download is not an error.
 */
export async function downloadImageResult(
  item: ResultStackItem,
  options: {
    filenameBase: string;
    imageFormat: ImageFormatPreference;
    signal?: AbortSignal;
    /** For a data URL whose item carries none, the anchor fallback's extension. */
    fallbackMimeType?: string;
  }
): Promise<void> {
  const { filenameBase, imageFormat, signal, fallbackMimeType } = options;
  const src = item.src;

  if (src.startsWith('data:image/')) {
    // Decoded rather than handed straight to the anchor, so the chosen format
    // applies here too — this is the path nano banana's PNG results take.
    // A decode failure falls back to the original direct-anchor download:
    // saving the result must not depend on converting it.
    try {
      const saved = await convertedForDownload(blobFromDataUrl(src), imageFormat);
      const objectUrl = URL.createObjectURL(saved);
      try {
        clickDownload(objectUrl, `${filenameBase}.${extensionForMimeType(saved.type)}`);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      clickDownload(src, `${filenameBase}.${extensionForMimeType(item.mimeType ?? fallbackMimeType)}`);
    }
    return;
  }

  if (item.provider === 'kie') {
    if (!isDownloadableMediaUrl(src)) throw new Error(KIE_URL_EXPIRED_ERROR);
    // Kie serves results cross-origin, where the download attribute is
    // ignored — fetch the bytes so the semantic name survives.
    await downloadRemoteMedia({ url: src, mediaType: 'image', filenameBase, imageFormat, signal });
    return;
  }

  if (!isSafeFalMediaUrl(src)) throw new Error(IMAGE_DOWNLOAD_ERROR);

  try {
    await saveFalImage(src, filenameBase, imageFormat, signal);
  } catch {
    if (signal?.aborted) return;
    // One fixed sentence, never the caught message: a network error can echo
    // the request, and the request can carry a key.
    throw new Error(IMAGE_DOWNLOAD_ERROR);
  }
}

async function saveFalImage(
  src: string,
  filenameBase: string,
  imageFormat: ImageFormatPreference,
  signal: AbortSignal | undefined
) {
  const response = await fetch(src, { signal });
  if (signal?.aborted) return;

  const responseMime = normalizedMimeType(response.headers.get('Content-Type'));
  if (!response.ok || !SUPPORTED_RASTER_MIMES.has(responseMime)) {
    throw new Error(IMAGE_DOWNLOAD_ERROR);
  }

  const blob = await boundedMediaBlob(
    response,
    responseMime,
    signal ?? new AbortController().signal,
    MAX_REMOTE_IMAGE_BYTES
  );
  if (signal?.aborted) return;

  const saved = await convertedForDownload(blob, imageFormat);
  if (signal?.aborted) return;

  const objectUrl = URL.createObjectURL(saved);
  try {
    // From the saved blob, never the response header: a browser that cannot
    // encode the chosen format leaves the original bytes, and the name must
    // follow the bytes.
    clickDownload(objectUrl, `${filenameBase}.${extensionForMimeType(saved.type)}`);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
