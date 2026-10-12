// tests/media/container-duration.test.ts
import { describe, expect, it } from 'vitest';
import { readContainerDuration, type ByteRangeSource } from '@/lib/media/container-duration';

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function mvhd(timescale: number, duration: number): Uint8Array {
  const payload = new Uint8Array(100);
  const view = new DataView(payload.buffer);
  view.setUint32(12, timescale);
  view.setUint32(16, duration);
  return box('mvhd', payload);
}

function mp4(seconds: number): Uint8Array {
  const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]));
  const mdat = box('mdat', new Uint8Array(4));
  const moov = box('moov', mvhd(1000, Math.round(seconds * 1000)));
  return concat(ftyp, mdat, moov);
}

function element(id: number[], data: Uint8Array): Uint8Array {
  const out = new Uint8Array(id.length + 1 + data.length);
  out.set(id, 0);
  out[id.length] = 0x80 | data.length;
  out.set(data, id.length + 1);
  return out;
}

function webm(seconds: number): Uint8Array {
  const scale = new Uint8Array(4);
  new DataView(scale.buffer).setUint32(0, 1_000_000);
  const duration = new Uint8Array(8);
  new DataView(duration.buffer).setFloat64(0, seconds * 1000);
  const info = element([0x15, 0x49, 0xa9, 0x66], concat(
    element([0x2a, 0xd7, 0xb1], scale),
    element([0x44, 0x89], duration),
  ));
  const cluster = element([0x1f, 0x43, 0xb6, 0x75], new Uint8Array([0]));
  const segment = element([0x18, 0x53, 0x80, 0x67], concat(info, cluster));
  const header = element([0x1a, 0x45, 0xdf, 0xa3], new Uint8Array(4));
  return concat(header, segment);
}

function sourceOf(bytes: Uint8Array): ByteRangeSource {
  return {
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
  };
}

describe('container duration', () => {
  it('reads an MP4 mvhd and a WebM Duration', async () => {
    expect(await readContainerDuration(sourceOf(mp4(30)))).toBe(30);
    expect(await readContainerDuration(sourceOf(webm(12.5)))).toBeCloseTo(12.5, 5);
  });

  it('skips a large mdat and still reads moov at the end', async () => {
    const ftyp = box('ftyp', new Uint8Array(8));
    const moov = box('moov', mvhd(1000, 30_000));
    const mdatSize = 5_000_000;
    const fileSize = ftyp.length + mdatSize + moov.length;
    const moovAt = ftyp.length + mdatSize;
    const seconds = await readContainerDuration({
      size: fileSize,
      read: async (offset, length) => {
        if (offset > ftyp.length + 16 && offset < moovAt) throw new Error(`read inside mdat at ${offset}`);
        const out = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
          const at = offset + i;
          if (at < ftyp.length) out[i] = ftyp[at];
          else if (at < moovAt) {
            if (at === ftyp.length) out[i] = (mdatSize >>> 24) & 0xff;
            else if (at === ftyp.length + 1) out[i] = (mdatSize >>> 16) & 0xff;
            else if (at === ftyp.length + 2) out[i] = (mdatSize >>> 8) & 0xff;
            else if (at === ftyp.length + 3) out[i] = mdatSize & 0xff;
            else if (at === ftyp.length + 4) out[i] = 'm'.charCodeAt(0);
            else if (at === ftyp.length + 5) out[i] = 'd'.charCodeAt(0);
            else if (at === ftyp.length + 6) out[i] = 'a'.charCodeAt(0);
            else if (at === ftyp.length + 7) out[i] = 't'.charCodeAt(0);
          } else if (at - moovAt < moov.length) out[i] = moov[at - moovAt];
        }
        return out;
      },
    });
    expect(seconds).toBe(30);
  });

  it('returns null when the file has no duration', async () => {
    expect(await readContainerDuration(sourceOf(new Uint8Array(16)))).toBeNull();
    expect(await readContainerDuration(sourceOf(element([0x1a, 0x45, 0xdf, 0xa3], new Uint8Array(4))))).toBeNull();
  });
});
