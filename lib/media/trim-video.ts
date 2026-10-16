import { probeDimensions, type ProbedDimensions } from '@/lib/timeline/probe';

export interface PreparedVideo extends ProbedDimensions {
  file: File;
  trimmedFromSeconds?: number;
}

/** Fit a temporary copy; never change the library original or just falsify its duration. */
export async function trimVideoToLimit(
  file: File,
  dimensions: ProbedDimensions,
  maxSeconds: number,
  options: { signal?: AbortSignal; onTrimming?: () => void } = {},
): Promise<PreparedVideo> {
  options.signal?.throwIfAborted();
  if (!Number.isFinite(dimensions.durationSeconds) || dimensions.durationSeconds <= 0 || !Number.isFinite(maxSeconds) || maxSeconds <= 0.1) {
    throw new Error('Could not read a usable video length.');
  }
  if (dimensions.durationSeconds <= maxSeconds) return { file, ...dimensions };
  options.onTrimming?.();
  const { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, Conversion } = await import('mediabunny');
  options.signal?.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined;
  const abort = () => { void conversion?.cancel().catch(() => {}); };
  try {
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    // Frame and AAC packet boundaries can extend past the requested end. Leave
    // a small margin, then check the actual container, as the Worker does.
    conversion = await Conversion.init({
      input, output, trim: { start: 0, end: maxSeconds - 0.1 },
      video: { codec: 'avc', forceTranscode: true },
      audio: { codec: 'aac' }, showWarnings: false,
    });
    if (!conversion.isValid || conversion.discardedTracks.length || !(await input.getPrimaryVideoTrack())) {
      throw new Error('This browser cannot trim this clip while keeping its video and audio. Trim it locally and choose it again.');
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    options.signal?.throwIfAborted();
    await conversion.execute();
    options.signal?.throwIfAborted();
    if (!target.buffer) throw new Error('Could not create a trimmed video.');
    const trimmed = new File([target.buffer], `${file.name.replace(/\.[^.]+$/, '')}-trimmed.mp4`, { type: 'video/mp4' });
    const actual = await probeDimensions(trimmed);
    options.signal?.throwIfAborted();
    if (!Number.isFinite(actual.durationSeconds) || actual.durationSeconds <= 0 || actual.durationSeconds > maxSeconds) {
      throw new Error('Could not trim this clip to the model’s limit. Trim it locally and choose it again.');
    }
    return { file: trimmed, ...actual, trimmedFromSeconds: dimensions.durationSeconds };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (conversion && conversion.state !== 'done') await conversion.cancel().catch(() => {});
    input.dispose();
  }
}

export function videoTrimNotice(video: PreparedVideo): string | undefined {
  return video.trimmedFromSeconds === undefined ? undefined
    : `Trimmed to the first ${video.durationSeconds.toFixed(2).replace(/\.?0+$/, '')} seconds to fit this model. The original clip is unchanged.`;
}
