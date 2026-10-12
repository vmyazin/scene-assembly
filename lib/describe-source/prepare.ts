// lib/describe-source/prepare.ts

import { FRAME_EXTRACTION_ERROR, isVideoFile, sampleVideoStills } from '@/lib/video-frame';

import {
  decodedByteLength,
  DESCRIBE_IMAGE_MIME,
  DESCRIBE_VIDEO_MIME,
  MAX_DESCRIBE_BYTES,
  MAX_DESCRIBE_PARTS,
  type DescribePart,
} from '@/lib/describe-source/contract';
import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';

export interface DescribeSourceInput {
  file: File;
  label: string;
}

export interface PreparedDescription {
  parts: DescribePart[];
  /** Sources that could not take a part. The button tells the reader. */
  omitted: string[];
}

/** A short clip can travel whole when Gemini will watch it. */
export const INLINE_VIDEO_BYTES = 1_500_000;
const INLINE_IMAGE_BYTES = 1_200_000;
const IMAGE_MAX_EDGE = 1280;
const MAX_STILLS = 3;

export interface PrepareOptions {
  /**
   * Send a short clip as video. Only Gemini can watch it. When this is off,
   * the clip becomes stills, because the shared vision model only reads images.
   */
  inlineVideo?: boolean;
  /** Test seam. Production uses a canvas shrink that gets smaller each pass. */
  shrinkImage?: (blob: Blob, pass: number) => Promise<Blob>;
}

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

async function defaultShrink(file: Blob, pass: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const edge = Math.max(320, Math.round(IMAGE_MAX_EDGE / (pass + 1)));
    const quality = Math.max(0.45, 0.82 - pass * 0.12);
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(DESCRIBE_ERRORS.unreadable);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error(DESCRIBE_ERRORS.unreadable);
    return blob;
  } finally {
    bitmap.close();
  }
}

interface Piece {
  mimeType: string;
  blob: Blob;
  label: string;
  kind: 'image' | 'video';
  sourceFile?: File;
}

function pieceBytes(pieces: Piece[]): number {
  return pieces.reduce((total, piece) => total + piece.blob.size, 0);
}

/** Every kept source gets one slot. Spare slots become extra stills, never a reason to drop an image. */
function stillsForVideo(kept: DescribeSourceInput[]): number {
  const videos = kept.filter((source) => looksLikeVideo(source.file)).length;
  if (videos === 0) return 0;
  const spare = Math.max(0, MAX_DESCRIBE_PARTS - kept.length);
  return Math.min(MAX_STILLS, 1 + Math.floor(spare / videos));
}

async function stillPieces(file: File, count: number): Promise<Piece[]> {
  try {
    const stills = await sampleVideoStills(file);
    const chosen = stills.slice(0, Math.max(1, Math.min(MAX_STILLS, count)));
    if (chosen.length === 0) throw new Error(DESCRIBE_ERRORS.unreadable);
    return chosen.map((still) => ({
      mimeType: 'image/jpeg',
      blob: still.blob,
      label: still.label,
      kind: 'image' as const,
    }));
  } catch (caught) {
    if (caught instanceof Error && caught.message === FRAME_EXTRACTION_ERROR) {
      throw new Error(DESCRIBE_ERRORS.unreadable);
    }
    throw caught instanceof Error ? caught : new Error(DESCRIBE_ERRORS.unreadable);
  }
}

async function imagePiece(file: File, label: string, shrink: NonNullable<PrepareOptions['shrinkImage']>): Promise<Piece> {
  const type = file.type.toLowerCase();
  if (file.size > 0 && file.size <= INLINE_IMAGE_BYTES && DESCRIBE_IMAGE_MIME.has(type)) {
    return { mimeType: type, blob: file, label, kind: 'image' };
  }
  const shrunk = await shrink(file, 0);
  return { mimeType: 'image/jpeg', blob: shrunk, label, kind: 'image' };
}

async function toParts(pieces: Piece[]): Promise<DescribePart[]> {
  const parts: DescribePart[] = [];
  let total = 0;
  for (const piece of pieces) {
    const data = await blobToBase64(piece.blob);
    const bytes = decodedByteLength(data);
    if (bytes === null) throw new Error(DESCRIBE_ERRORS.unreadable);
    total += bytes;
    parts.push({ mimeType: piece.mimeType, data, label: piece.label });
  }
  if (total > MAX_DESCRIBE_BYTES) throw new Error(DESCRIBE_ERRORS.tooLarge);
  return parts;
}

/**
 * Turn the selected files into the parts the route accepts.
 *
 * A short clip is video only when Gemini will watch it. Otherwise, and for
 * anything larger, it becomes stills: the shared vision model only reads
 * images, and a 100MB source cannot fit in the request. If the parts still
 * exceed the byte cap, the inline video is sampled and the largest images
 * are re-encoded before the request is refused.
 */
export async function prepareDescribeParts(
  sources: DescribeSourceInput[],
  options: PrepareOptions = {}
): Promise<PreparedDescription> {
  if (sources.length === 0) throw new Error(DESCRIBE_ERRORS.empty);
  const shrink = options.shrinkImage ?? defaultShrink;

  const kept = sources.slice(0, MAX_DESCRIBE_PARTS);
  const omitted = sources.slice(MAX_DESCRIBE_PARTS).map((source) => source.label);
  const videoStills = stillsForVideo(kept);

  const pieces: Piece[] = [];
  for (const source of kept) {
    if (source.file.size === 0) throw new Error(DESCRIBE_ERRORS.unreadable);

    if (looksLikeVideo(source.file)) {
      const type = source.file.type.toLowerCase();
      const sendVideo =
        options.inlineVideo === true &&
        source.file.size <= INLINE_VIDEO_BYTES &&
        DESCRIBE_VIDEO_MIME.has(type);
      if (sendVideo) {
        pieces.push({
          mimeType: type,
          blob: source.file,
          label: 'Source video',
          kind: 'video',
          sourceFile: source.file,
        });
      } else {
        pieces.push(...(await stillPieces(source.file, videoStills)));
      }
      continue;
    }

    if (!looksLikeImage(source.file)) throw new Error(DESCRIBE_ERRORS.unsupported);
    pieces.push(await imagePiece(source.file, source.label, shrink));
  }

  if (pieces.length === 0) throw new Error(DESCRIBE_ERRORS.unreadable);

  for (let pass = 0; pass < 8 && pieceBytes(pieces) > MAX_DESCRIBE_BYTES; pass += 1) {
    const videoAt = pieces.findIndex((piece) => piece.kind === 'video' && piece.sourceFile);
    if (videoAt >= 0 && pieces[videoAt].sourceFile) {
      const room = MAX_DESCRIBE_PARTS - (pieces.length - 1);
      const stills = await stillPieces(pieces[videoAt].sourceFile, Math.min(MAX_STILLS, room));
      pieces.splice(videoAt, 1, ...stills);
      continue;
    }

    let largest = 0;
    for (let index = 1; index < pieces.length; index += 1) {
      if (pieces[index].blob.size > pieces[largest].blob.size) largest = index;
    }
    const target = pieces[largest];
    if (target.kind !== 'image') throw new Error(DESCRIBE_ERRORS.tooLarge);
    const shrunk = await shrink(target.blob, pass + 1);
    if (shrunk.size >= target.blob.size) throw new Error(DESCRIBE_ERRORS.tooLarge);
    pieces[largest] = { ...target, mimeType: 'image/jpeg', blob: shrunk, kind: 'image' };
  }

  if (pieceBytes(pieces) > MAX_DESCRIBE_BYTES) throw new Error(DESCRIBE_ERRORS.tooLarge);

  if (pieces.length > MAX_DESCRIBE_PARTS) {
    omitted.push(...pieces.slice(MAX_DESCRIBE_PARTS).map((piece) => piece.label));
    pieces.length = MAX_DESCRIBE_PARTS;
  }

  return { parts: await toParts(pieces), omitted };
}
