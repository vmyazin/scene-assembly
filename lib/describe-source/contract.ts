// lib/describe-source/contract.ts

import { DESCRIBE_ERRORS } from '@/lib/describe-source/errors';

/** JSON body cap, under the platform request limit once base64 is wrapped in JSON. */
export const MAX_DESCRIBE_BYTES = 2_500_000;
export const MAX_DESCRIBE_PARTS = 4;

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export interface DescribePart {
  mimeType: string;
  /** Base64, no data-URL prefix. */
  data: string;
  label: string;
}

export interface DescribeRequest {
  apiKey: string;
  target: 'video' | 'image';
  parts: DescribePart[];
}

export function decodedByteLength(data: string): number | null {
  const cleaned = data.replace(/\s/g, '');
  if (cleaned.length === 0 || cleaned.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return (cleaned.length / 4) * 3 - padding;
}

export type ParseResult =
  | { ok: true; request: DescribeRequest }
  | { ok: false; status: number; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/**
 * Accept only the media the vision call knows how to read, and only as much
 * of it as the request body can carry. Labels are kept for the brief and
 * sanitized later; bytes that fail the alphabet check never reach a model.
 */
export function parseDescribeRequest(body: unknown): ParseResult {
  if (!isRecord(body)) return { ok: false, status: 400, error: DESCRIBE_ERRORS.invalid };
  const rawParts = body.parts;
  if (!Array.isArray(rawParts) || rawParts.length === 0) {
    return { ok: false, status: 400, error: DESCRIBE_ERRORS.empty };
  }
  if (rawParts.length > MAX_DESCRIBE_PARTS) {
    return { ok: false, status: 400, error: DESCRIBE_ERRORS.tooLarge };
  }

  const parts: DescribePart[] = [];
  let total = 0;
  for (const raw of rawParts) {
    if (!isRecord(raw) || typeof raw.mimeType !== 'string' || typeof raw.data !== 'string') {
      return { ok: false, status: 400, error: DESCRIBE_ERRORS.invalid };
    }
    const mimeType = raw.mimeType.toLowerCase();
    if (!IMAGE_MIME.has(mimeType) && !VIDEO_MIME.has(mimeType)) {
      return { ok: false, status: 400, error: DESCRIBE_ERRORS.unsupported };
    }
    const bytes = decodedByteLength(raw.data);
    if (bytes === null || bytes <= 0) return { ok: false, status: 400, error: DESCRIBE_ERRORS.invalid };
    total += bytes;
    if (total > MAX_DESCRIBE_BYTES) return { ok: false, status: 413, error: DESCRIBE_ERRORS.tooLarge };
    parts.push({
      mimeType,
      data: raw.data.replace(/\s/g, ''),
      label: typeof raw.label === 'string' ? raw.label.slice(0, 40) : '',
    });
  }

  const target = body.target === 'image' ? 'image' : 'video';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  return { ok: true, request: { apiKey, target, parts } };
}
