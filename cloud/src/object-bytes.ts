// cloud/src/object-bytes.ts
/**
 * Shared R2 reads for the two places that measure a clip before a job is
 * reserved: Seedance draft pricing and edit-source limits. A second copy of
 * the head-and-cancel plus the range read drifted the moment one side learned
 * a new box type.
 */
import type { Env } from './security';

type AssetBucket = NonNullable<Env['ASSETS']>;

export async function readBody(body: ReadableStream<Uint8Array> | null | undefined): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value) {
      chunks.push(next.value);
      total += next.value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** `head` can still carry a body on the local bucket. Cancel it so the socket is not held open. */
export async function objectByteSize(bucket: AssetBucket | undefined, key: string): Promise<number | null> {
  const head = await bucket?.head(key);
  if (!head) return null;
  await (head as { body?: ReadableStream<Uint8Array> }).body?.cancel?.().catch(() => {});
  return head.size;
}

export async function readObjectRange(bucket: AssetBucket | undefined, key: string, offset: number, length: number): Promise<Uint8Array> {
  const object = await bucket?.get(key, { range: { offset, length } });
  return readBody(object?.body);
}
