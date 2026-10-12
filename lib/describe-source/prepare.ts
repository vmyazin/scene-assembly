// lib/describe-source/prepare.ts

import { FRAME_EXTRACTION_ERROR, isVideoFile, sampleVideoStills } from '@/lib/video-frame';

import { decodedByteLength, MAX_DESCRIBE_BYTES, MAX_DESCRIBE_PARTS, type DescribePart } from '@/lib/describe-source/contract';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';

export interface DescribeSourceInput {
  file: File;
  label: string;
}

/** A short clip can travel whole. Anything larger is sampled into stills first. */
export const INLINE_VIDEO_BYTES = 1_500_000;
const INLINE_IMAGE_BYTES = 1_200_000;
const IMAGE_MAX_EDGE = 1280;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function looksLikeVideo(file: File): boolean {
  return isVideoFile(file) || /\.(mp4|mov|webm)$/i.test(file.name);
}

function looksLikeImage(file: File): boolean {
  return file.type.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

async function shrinkImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(DESCRIBE_ERRORS.unreadable);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error(DESCRIBE_ERRORS.unreadable);
    return blob;
  } finally {
    bitmap.close();
  }
}

async function imagePart(file: File, label: string): Promise<DescribePart> {
  const type = file.type.toLowerCase();
  if (file.size > 0 && file.size <= INLINE_IMAGE_BYTES && IMAGE_TYPES.has(type)) {
    return { mimeType: type, data: await blobToBase64(file), label };
  }
  const shrunk = await shrinkImage(file);
  return { mimeType: 'image/jpeg', data: await blobToBase64(shrunk), label };
}

function assertBudget(parts: DescribePart[]): void {
  let total = 0;
  for (const part of parts) {
    const bytes = decodedByteLength(part.data);
    if (bytes === null) throw new Error(DESCRIBE_ERRORS.unreadable);
    total += bytes;
  }
  if (total > MAX_DESCRIBE_BYTES) throw new Error(DESCRIBE_ERRORS.tooLarge);
}

/**
 * Turn the selected files into the parts the route accepts.
 *
 * A video under the inline cap is sent as video, because Gemini can watch it.
 * A longer clip becomes three JPEGs: the shared vision model only reads images,
 * and a 100MB source cannot fit in the request.
 */
export async function prepareDescribeParts(sources: DescribeSourceInput[]): Promise<DescribePart[]> {
  if (sources.length === 0) throw new Error(DESCRIBE_ERRORS.empty);

  const parts: DescribePart[] = [];
  for (const source of sources) {
    if (parts.length >= MAX_DESCRIBE_PARTS) break;
    if (source.file.size === 0) throw new Error(DESCRIBE_ERRORS.unreadable);

    if (looksLikeVideo(source.file)) {
      const type = source.file.type.toLowerCase();
      if (source.file.size <= INLINE_VIDEO_BYTES && VIDEO_TYPES.has(type)) {
        parts.push({ mimeType: type, data: await blobToBase64(source.file), label: 'Source video' });
        continue;
      }
      try {
        const stills = await sampleVideoStills(source.file);
        for (const still of stills) {
          if (parts.length >= MAX_DESCRIBE_PARTS) break;
          parts.push({ mimeType: 'image/jpeg', data: await blobToBase64(still.blob), label: still.label });
        }
      } catch (caught) {
        if (caught instanceof Error && caught.message === FRAME_EXTRACTION_ERROR) {
          throw new Error(DESCRIBE_ERRORS.unreadable);
        }
        throw caught instanceof Error ? caught : new Error(DESCRIBE_ERRORS.unreadable);
      }
      continue;
    }

    if (!looksLikeImage(source.file)) throw new Error(DESCRIBE_ERRORS.unsupported);
    parts.push(await imagePart(source.file, source.label));
  }

  if (parts.length === 0) throw new Error(DESCRIBE_ERRORS.unreadable);
  assertBudget(parts);
  return parts;
}
