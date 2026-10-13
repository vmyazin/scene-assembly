// app/api/fal/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';

import { FalApiError, uploadFalFile } from '@/lib/fal/server';
import {
  FalRequestBodyTooLarge,
  parseBoundedFalFormData,
} from '@/lib/fal/request-body';

const GENERIC_FAL_ERROR = 'Something went wrong while contacting fal.';
// Kling O1/O3 publish a 200 MB source. The body cap leaves room for the multipart wrapper.
const MAX_UPLOAD_BODY_BYTES = 201 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200_000_000;
const MAX_API_KEY_LENGTH = 1024;
const SIGNATURE_PREFIX_BYTES = 64;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);

function isFile(value: unknown): value is File {
  if (value === null || typeof value !== 'object') return false;
  if (Object.prototype.toString.call(value) !== '[object File]') return false;
  if (
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !('size' in value) ||
    typeof value.size !== 'number' ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    return false;
  }

  try {
    const filePrototype = Object.getPrototypeOf(value);
    const blobPrototype = Object.getPrototypeOf(filePrototype);
    const slice = Reflect.get(blobPrototype, 'slice');
    if (typeof slice !== 'function') return false;
    Reflect.apply(slice, value, [0, 0]);
    return true;
  } catch {
    return false;
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasAvifBrand(bytes: Uint8Array, fileSize: number): boolean {
  if (bytes.length < 16) return false;
  if (!startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])) return false;
  const boxSize =
    bytes[0] * 2 ** 24 +
    bytes[1] * 2 ** 16 +
    bytes[2] * 2 ** 8 +
    bytes[3];
  if (boxSize < 16 || boxSize > fileSize) return false;
  const boxEnd = Math.min(boxSize, bytes.length);

  const brandAt = (offset: number) =>
    bytes[offset] === 0x61 &&
    bytes[offset + 1] === 0x76 &&
    bytes[offset + 2] === 0x69 &&
    (bytes[offset + 3] === 0x66 || bytes[offset + 3] === 0x73);

  if (brandAt(8)) return true;
  for (let offset = 16; offset + 3 < boxEnd; offset += 4) {
    if (brandAt(offset)) return true;
  }
  return false;
}

async function hasValidImageSignature(file: File): Promise<boolean> {
  try {
    const filePrototype = Object.getPrototypeOf(file);
    const blobPrototype = Object.getPrototypeOf(filePrototype);
    const slice = Reflect.get(blobPrototype, 'slice');
    const arrayBuffer = Reflect.get(blobPrototype, 'arrayBuffer');
    if (typeof slice !== 'function' || typeof arrayBuffer !== 'function') return false;

    const prefix = Reflect.apply(slice, file, [0, SIGNATURE_PREFIX_BYTES]);
    const bytes = new Uint8Array(await Reflect.apply(arrayBuffer, prefix, []));
    if (file.type === 'image/png') {
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    if (file.type === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
    if (file.type === 'image/webp') {
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
      );
    }
    return file.type === 'image/avif' && hasAvifBrand(bytes, file.size);
  } catch {
    return false;
  }
}

/** MP4 and MOV are ISO BMFF: the first box type is `ftyp`. */
async function hasIsoBmffSignature(file: File): Promise<boolean> {
  try {
    const filePrototype = Object.getPrototypeOf(file);
    const blobPrototype = Object.getPrototypeOf(filePrototype);
    const slice = Reflect.get(blobPrototype, 'slice');
    const arrayBuffer = Reflect.get(blobPrototype, 'arrayBuffer');
    if (typeof slice !== 'function' || typeof arrayBuffer !== 'function') return false;
    const prefix = Reflect.apply(slice, file, [0, 12]);
    const bytes = new Uint8Array(await Reflect.apply(arrayBuffer, prefix, []));
    return bytes.length >= 8
      && bytes[4] === 0x66
      && bytes[5] === 0x74
      && bytes[6] === 0x79
      && bytes[7] === 0x70;
  } catch {
    return false;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof FalApiError) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  }
  return NextResponse.json({ success: false, error: GENERIC_FAL_ERROR }, { status: 500 });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await parseBoundedFalFormData(request, MAX_UPLOAD_BODY_BYTES);
  } catch (error) {
    if (error instanceof FalRequestBodyTooLarge) {
      return NextResponse.json(
        { success: false, error: 'The request body is too large.' },
        { status: 413 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'The request body must be valid multipart form data.' },
      { status: 400 }
    );
  }

  const apiKey = form.get('apiKey');
  const file = form.get('file');
  if (
    typeof apiKey !== 'string' ||
    !apiKey.trim() ||
    apiKey.length > MAX_API_KEY_LENGTH
  ) {
    return NextResponse.json(
      { success: false, error: 'A fal API key is required.' },
      { status: 400 }
    );
  }
  if (!isFile(file)) {
    return NextResponse.json(
      { success: false, error: 'A source file is required.' },
      { status: 400 }
    );
  }
  const video = ALLOWED_VIDEO_TYPES.has(file.type);
  if (!ALLOWED_IMAGE_TYPES.has(file.type) && !video) {
    return NextResponse.json(
      { success: false, error: 'The source file must be a supported raster image, or an MP4 or MOV video.' },
      { status: 415 }
    );
  }
  if (file.size > (video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
    return NextResponse.json(
      { success: false, error: 'The source file is too large.' },
      { status: 413 }
    );
  }
  if (video ? !(await hasIsoBmffSignature(file)) : !(await hasValidImageSignature(file))) {
    return NextResponse.json(
      { success: false, error: video ? 'The source video must be an MP4 or MOV.' : 'The source file must be a supported raster image.' },
      { status: 415 }
    );
  }

  try {
    const url = await uploadFalFile({ apiKey: apiKey.trim(), file });
    return NextResponse.json({ success: true, url });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
