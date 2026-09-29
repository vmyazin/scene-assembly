/**
 * Reading a file's type from its first bytes. A Content-Type header is whatever
 * the other server says: an agent's reference URL can lie, and a provider's
 * storage bucket can label a finished JPEG `application/octet-stream`.
 */

// Enough to cover every signature sniffMime checks: the ftyp brand sits at bytes 8-12.
const SNIFF_BYTES = 16;

export function sniffMime(bytes: Uint8Array): string | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    // QuickTime and HEIF are refused: writeOutput stores neither.
    if (['qt  ', 'heic', 'heix', 'mif1', 'msf1'].includes(brand)) return null;
    return 'video/mp4';
  }
  return null;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/**
 * Reads only enough of `reader` to sniff the type, then hands back one
 * contiguous stream that replays those bytes before the rest, so the body can
 * still go straight to storage instead of being held in memory. `readError`
 * turns a failed read (before or after the sniff) into the caller's own error.
 */
export async function peekMediaType(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  readError: (cause: unknown) => unknown = cause => cause,
): Promise<{ mimeType: string | null; body: ReadableStream<Uint8Array> }> {
  const prefix: Uint8Array[] = [];
  let size = 0;
  while (size < SNIFF_BYTES) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try { step = await reader.read(); } catch (cause) { throw readError(cause); }
    if (step.done || !step.value) break;
    prefix.push(step.value);
    size += step.value.byteLength;
  }
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < prefix.length) { controller.enqueue(prefix[index++]); return; }
      try {
        const { done, value } = await reader.read();
        if (done) controller.close(); else controller.enqueue(value);
      } catch (cause) { controller.error(readError(cause)); }
    },
    cancel(reason) { return reader.cancel(reason).catch(() => {}); },
  });
  return { mimeType: sniffMime(concatChunks(prefix)), body };
}
