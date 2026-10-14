// lib/media/container-duration.ts
/**
 * Duration from an MP4/MOV `mvhd`, a WebM Info/Duration element, or a WAV
 * `fmt` byte rate and `data` size.
 *
 * The Worker prices a Seedance edit draft from this, before it reserves, so a
 * claimed length cannot under-charge a longer clip. It reads box headers and
 * the start of `moov` only: a multi-megabyte `mdat` is skipped by its size.
 * A file with no readable duration returns null. The caller refuses the draft
 * rather than pricing it as unknown.
 */

export interface ByteRangeSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const CLUSTER = 0x1f43b675;

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** Width and height from a `tkhd`. Audio tracks store 0×0 and are skipped. */
function tkhdFrame(payload: Uint8Array): { width: number; height: number } | null {
  if (payload.length < 4) return null;
  const version = payload[0];
  const offset = version === 0 ? 76 : version === 1 ? 88 : -1;
  if (offset < 0 || payload.length < offset + 8) return null;
  const view = viewOf(payload);
  const width = view.getUint32(offset) / 65536;
  const height = view.getUint32(offset + 4) / 65536;
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

function mvhdSeconds(payload: Uint8Array): number | null {
  if (payload.length < 20) return null;
  const view = viewOf(payload);
  const version = payload[0];
  if (version === 0) {
    const timescale = view.getUint32(12);
    const duration = view.getUint32(16);
    if (!timescale) return null;
    return duration / timescale;
  }
  if (version === 1 && payload.length >= 32) {
    const timescale = view.getUint32(20);
    const high = view.getUint32(24);
    const low = view.getUint32(28);
    if (!timescale) return null;
    return (high * 2 ** 32 + low) / timescale;
  }
  return null;
}

/** Walks boxes already in memory. Returns true when `visit` asks to stop. */
function walkBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (type: string, payloadStart: number, payloadEnd: number) => boolean,
): boolean {
  const view = viewOf(bytes);
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = fourcc(bytes, offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return false;
      size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
      header = 16;
    }
    if (size === 0) size = end - offset;
    if (!Number.isFinite(size) || size < header || offset + header > end) return false;
    const payloadEnd = Math.min(offset + size, end);
    if (visit(type, offset + header, payloadEnd)) return true;
    if (offset + size > end) return false;
    offset += size;
  }
  return false;
}

interface MeasuredVideo { durationSeconds: number | null; width: number | null; height: number | null }

async function mp4Video(source: ByteRangeSource): Promise<MeasuredVideo | null> {
  let offset = 0;
  while (offset + 8 <= source.size) {
    const header = await source.read(offset, 16);
    if (header.length < 8) return null;
    const view = viewOf(header);
    let size = view.getUint32(0);
    const type = fourcc(header, 4);
    let headerLen = 8;
    if (size === 1) {
      if (header.length < 16) return null;
      size = view.getUint32(8) * 2 ** 32 + view.getUint32(12);
      headerLen = 16;
    }
    if (size === 0) size = source.size - offset;
    if (!Number.isFinite(size) || size < headerLen) return null;
    if (type === 'moov') {
      const boxBytes = await source.read(offset, Math.min(size, 256 * 1024));
      let duration: number | null = null;
      let width: number | null = null;
      let height: number | null = null;
      walkBoxes(boxBytes, headerLen, boxBytes.length, (child, payloadStart, payloadEnd) => {
        if (child === 'mvhd') duration = mvhdSeconds(boxBytes.subarray(payloadStart, payloadEnd));
        if (child === 'trak') {
          walkBoxes(boxBytes, payloadStart, payloadEnd, (grand, grandStart, grandEnd) => {
            if (grand !== 'tkhd' || width !== null) return false;
            const frame = tkhdFrame(boxBytes.subarray(grandStart, grandEnd));
            if (frame) {
              width = frame.width;
              height = frame.height;
            }
            return false;
          });
        }
        return false;
      });
      if ((duration === null || !(duration > 0)) && width === null) return null;
      return { durationSeconds: duration !== null && duration > 0 ? duration : null, width, height };
    }
    offset += size;
    if (offset > source.size) return null;
  }
  return null;
}

function readVint(data: Uint8Array, offset: number, strip: boolean): { value: number; length: number; unknown: boolean } | null {
  if (offset >= data.length || data[offset] === 0) return null;
  const first = data[offset];
  let length = 0;
  let marker = 0x80;
  while (marker > 0 && (first & marker) === 0) {
    length += 1;
    marker >>= 1;
  }
  length += 1;
  if (marker === 0 || offset + length > data.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + data[offset + i];
  if (strip) {
    let place = 1;
    for (let i = 1; i < length; i++) place *= 256;
    value -= marker * place;
  }
  let max = 1;
  for (let i = 0; i < 7 * length; i++) max *= 2;
  return { value, length, unknown: strip && value === max - 1 };
}

function walkElements(
  data: Uint8Array,
  start: number,
  end: number,
  visit: (id: number, dataStart: number, dataEnd: number) => boolean,
): void {
  let offset = start;
  while (offset + 2 <= end) {
    const id = readVint(data, offset, false);
    if (!id) return;
    const size = readVint(data, offset + id.length, true);
    if (!size) return;
    const dataStart = offset + id.length + size.length;
    if (size.unknown) {
      visit(id.value, dataStart, end);
      return;
    }
    if (dataStart > end || size.value > end - dataStart) return;
    const dataEnd = dataStart + size.value;
    if (visit(id.value, dataStart, dataEnd)) return;
    offset = dataEnd;
  }
}

function readUnsigned(data: Uint8Array, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end && i < start + 8; i++) value = value * 256 + data[i];
  return value;
}

function readFloat(data: Uint8Array, start: number, end: number): number | null {
  const length = end - start;
  if (length !== 4 && length !== 8) return null;
  const view = new DataView(data.buffer, data.byteOffset + start, length);
  const value = length === 4 ? view.getFloat32(0) : view.getFloat64(0);
  return Number.isFinite(value) ? value : null;
}

function webmDuration(data: Uint8Array): number | null {
  let scale = 1_000_000;
  let duration: number | null = null;
  walkElements(data, 0, data.length, (id, start, end) => {
    if (id !== SEGMENT) return false;
    walkElements(data, start, end, (child, childStart, childEnd) => {
      if (child === CLUSTER) return true;
      if (child !== INFO) return false;
      walkElements(data, childStart, childEnd, (field, fieldStart, fieldEnd) => {
        if (field === TIMECODE_SCALE) {
          const next = readUnsigned(data, fieldStart, fieldEnd);
          if (next > 0) scale = next;
        }
        if (field === DURATION) duration = readFloat(data, fieldStart, fieldEnd);
        return false;
      });
      return duration !== null;
    });
    return true;
  });
  if (duration === null || scale <= 0) return null;
  const seconds = (duration * scale) / 1e9;
  return seconds > 0 ? seconds : null;
}

function isEbml(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && EBML_MAGIC.every((byte, index) => bytes[index] === byte);
}

function isRiffWave(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
}

/** `fmt ` then `data`. The data payload itself is never read; its size is enough. */
async function wavDuration(source: ByteRangeSource): Promise<number | null> {
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= source.size && offset < 64 * 1024) {
    const header = await source.read(offset, 8);
    if (header.length < 8) return null;
    const size = viewOf(header).getUint32(4, true);
    if (!Number.isFinite(size) || size < 0) return null;
    const id = fourcc(header, 0);
    if (id === 'fmt ') {
      const fmt = await source.read(offset + 8, Math.min(size, 16));
      if (fmt.length >= 16) byteRate = viewOf(fmt).getUint32(8, true);
    } else if (id === 'data') {
      if (!byteRate) return null;
      const seconds = size / byteRate;
      return seconds > 0 ? seconds : null;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Duration plus the first video track's frame size.
 *
 * Width and height come from an MP4/MOV `tkhd` (16.16 fixed point). WebM and
 * WAV stay duration-only: their picture size is not in the boxes this reader
 * already walks, and a missing frame does not invent one.
 */
export async function readContainerVideo(source: ByteRangeSource): Promise<MeasuredVideo | null> {
  if (!Number.isFinite(source.size) || source.size < 8) return null;
  const head = await source.read(0, Math.min(12, source.size));
  if (isEbml(head)) {
    const window = await source.read(0, Math.min(source.size, 1024 * 1024));
    const durationSeconds = webmDuration(window);
    return durationSeconds === null ? null : { durationSeconds, width: null, height: null };
  }
  if (isRiffWave(head)) {
    const durationSeconds = await wavDuration(source);
    return durationSeconds === null ? null : { durationSeconds, width: null, height: null };
  }
  return mp4Video(source);
}

/** Seconds, or null when the container has no duration we can trust. */
export async function readContainerDuration(source: ByteRangeSource): Promise<number | null> {
  const measured = await readContainerVideo(source);
  return measured?.durationSeconds ?? null;
}
