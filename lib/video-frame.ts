// lib/video-frame.ts
import {
  isDownloadableMediaUrl,
  isSameOriginMediaUrl,
  MAX_REMOTE_VIDEO_BYTES,
  remoteVideoBlob,
} from '@/lib/media-download';

/**
 * Pulls the final frame out of a finished video so it can be saved, copied, or
 * used as the opening frame of the next clip.
 *
 * The bytes are fetched into a Blob and played from an object URL rather than
 * pointing a <video> straight at the provider CDN. A `blob:` URL is same-origin,
 * so the canvas is never tainted and `toBlob` stays legal — no `crossOrigin`
 * attribute, and the inline preview element is left alone.
 */

export const FRAME_EXTRACTION_ERROR = 'Unable to read the last frame of this video.';

/**
 * How far before `duration` to sample. Must be shorter than one frame, or the
 * seek lands on the second-to-last frame: at 24fps a frame is 41.7ms, and a
 * 50ms epsilon measurably returned frame 190 of 192 on a real clip. 10ms stays
 * inside the final frame for anything up to 100fps.
 *
 * It is not zero because end-clamping behaviour varies by browser — Chromium
 * returns the last frame for a seek to exactly `duration`, which is not a
 * guarantee worth depending on.
 */
const DEFAULT_EPSILON_SECONDS = 0.01;
/** Fragmented MP4s report Infinity until a seek past the end forces the real duration. */
const UNBOUNDED_SEEK_SECONDS = 1e7;
const SEEK_TIMEOUT_MS = 15_000;
/** currentTime deltas below this never emit `seeked`, so awaiting one would hang. */
const SEEK_EPSILON = 1e-3;

/** The media-element surface this module touches, so tests can supply a double. */
export interface SeekableVideo {
  currentTime: number;
  readonly duration: number;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Where to sample the final frame, or null when the duration is not yet known
 * (`Infinity` before buffering, `NaN` before metadata, `0` for an empty video).
 */
export function lastFrameSeekTarget(duration: number, epsilonSeconds = DEFAULT_EPSILON_SECONDS) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, duration - epsilonSeconds);
}

function seekTo(video: SeekableVideo, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < SEEK_EPSILON) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    // `timer` is read only from handlers, which cannot run before it is bound.
    const done = (settle: () => void) => () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      settle();
    };
    const onSeeked = done(resolve);
    const onError = done(() => reject(new Error(FRAME_EXTRACTION_ERROR)));

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    const timer = setTimeout(onError, SEEK_TIMEOUT_MS);
    video.currentTime = time;
  });
}

/**
 * Park a loaded video on its final frame. Probes past the end first when the
 * duration is not yet reported, which is how fragmented MP4s reveal theirs.
 */
export async function seekToLastFrame(
  video: SeekableVideo,
  epsilonSeconds = DEFAULT_EPSILON_SECONDS
): Promise<void> {
  if (lastFrameSeekTarget(video.duration, epsilonSeconds) === null) {
    await seekTo(video, UNBOUNDED_SEEK_SECONDS);
  }

  const target = lastFrameSeekTarget(video.duration, epsilonSeconds);
  if (target === null) throw new Error(FRAME_EXTRACTION_ERROR);

  await seekTo(video, target);
}

function loadVideo(objectUrl: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    // Muted + inline is what lets mobile Safari decode a frame without a gesture.
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const settle = (finish: () => void) => () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
      finish();
    };
    // `loadeddata`, not `loadedmetadata`: it guarantees a decoded frame exists.
    const onLoaded = settle(() => resolve(video));
    const onError = settle(() => reject(new Error(FRAME_EXTRACTION_ERROR)));

    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    const timer = setTimeout(onError, SEEK_TIMEOUT_MS);
    video.src = objectUrl;
  });
}

function releaseVideo(video: HTMLVideoElement) {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    // Teardown is best effort; the object URL revoke below is what matters.
  }
}

function drawFrame(
  video: HTMLVideoElement,
  format: { mimeType: 'image/png' | 'image/jpeg'; quality?: number; maxEdge?: number }
): Promise<Blob> {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) throw new Error(FRAME_EXTRACTION_ERROR);

  const maxEdge = format.maxEdge ?? Number.POSITIVE_INFINITY;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(FRAME_EXTRACTION_ERROR);
  context.drawImage(video, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(FRAME_EXTRACTION_ERROR));
    }, format.mimeType, format.quality);
  });
}

function drawToPng(video: HTMLVideoElement): Promise<Blob> {
  return drawFrame(video, { mimeType: 'image/png' });
}

/**
 * Decode the final frame of video bytes already in hand — a downloaded result
 * or a file the user picked off their drive. Playing from an object URL keeps
 * the canvas same-origin either way.
 */
export async function extractLastFrameFromBlob(
  blob: Blob,
  options: { epsilonSeconds?: number } = {}
): Promise<Blob> {
  if (blob.size === 0 || blob.size > MAX_REMOTE_VIDEO_BYTES) {
    throw new Error(FRAME_EXTRACTION_ERROR);
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const video = await loadVideo(objectUrl);
    try {
      await seekToLastFrame(video, options.epsilonSeconds);
      return await drawToPng(video);
    } finally {
      releaseVideo(video);
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Read the final frame of a finished clip, wherever it is addressed.
 *
 * Two shapes of address reach here and both are legitimate: a provider CDN's
 * absolute https URL, and the relative `/api/account/assets/<id>/content` that
 * every cloud-library card passes. The relative one used to be refused before a
 * single request was made — `isDownloadableMediaUrl` parses an absolute URL, so
 * a path with no origin simply returned false — which is why "Save last frame"
 * failed on every clip in the cloud library while the card's own preview played.
 *
 * The bytes then come through `remoteVideoBlob`, which falls back to the app's
 * own streaming route when a CDN refuses the browser: a `<video>` element plays
 * a cross-origin file with no CORS headers at all, so the preview above the
 * button keeps playing while the fetch behind it cannot read a byte.
 */
export async function extractLastFrame(
  url: string,
  options: { signal?: AbortSignal; epsilonSeconds?: number } = {}
): Promise<Blob> {
  if (!isSameOriginMediaUrl(url) && !isDownloadableMediaUrl(url)) {
    throw new Error(FRAME_EXTRACTION_ERROR);
  }

  let blob: Blob;
  try {
    blob = await remoteVideoBlob(url, options.signal);
  } catch (caught) {
    // An abort is the caller cancelling and must stay distinguishable; every
    // other transport failure reads the same to the person waiting on a frame.
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;
    throw new Error(FRAME_EXTRACTION_ERROR);
  }

  return extractLastFrameFromBlob(blob, options);
}

/** `neon-tiger-in-the-rain` → `neon-tiger-in-the-rain-last-frame.png` */
export function lastFrameFilename(base: string) {
  return `${base}-last-frame.png`;
}

export function isVideoFile(file: File) {
  return file.type.toLowerCase().startsWith('video/');
}

/** `previous-take.mp4` → `previous-take-last-frame.png` */
export function lastFrameFileName(videoName: string) {
  return lastFrameFilename(videoName.replace(/\.[^.]+$/, '') || 'video');
}

/**
 * Turn a saved clip into a reference image: its last frame, named after the
 * source so it stays recognizable once uploaded.
 */
export async function lastFrameAsImageFile(video: File): Promise<File> {
  const frame = await extractLastFrameFromBlob(video);
  return new File([frame], lastFrameFileName(video.name), { type: 'image/png' });
}

/** Longest edge of a still sent to a vision model. Full-resolution frames blow the request body. */
const DESCRIPTION_STILL_MAX_EDGE = 768;

/**
 * Where to sample a clip so a vision model can see how it changes.
 * A single instant when the clip is too short to have a middle, otherwise
 * the open, the middle, and just before the end.
 */
export function descriptionSampleTimes(duration: number, epsilonSeconds = DEFAULT_EPSILON_SECONDS): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const last = Math.max(0, duration - epsilonSeconds);
  if (last < 0.05) return [0];
  const times = [0, duration / 2, last];
  const unique: number[] = [];
  for (const time of times) {
    if (unique.every((kept) => Math.abs(kept - time) >= 0.05)) unique.push(time);
  }
  return unique;
}

/** `1.5` → `1.5s`, the label the describe route accepts. */
export function frameTimeLabel(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

function drawToJpeg(video: HTMLVideoElement): Promise<Blob> {
  return drawFrame(video, { mimeType: 'image/jpeg', quality: 0.72, maxEdge: DESCRIPTION_STILL_MAX_EDGE });
}

/**
 * Ordered stills from a local clip: open, middle, and end.
 *
 * A source video is often larger than the JSON body a vision route can accept,
 * and the shared vision model only reads images. Three small JPEGs keep the
 * change across the clip without uploading the file.
 */
export async function sampleVideoStills(blob: Blob): Promise<Array<{ blob: Blob; label: string }>> {
  if (blob.size === 0 || blob.size > MAX_REMOTE_VIDEO_BYTES) {
    throw new Error(FRAME_EXTRACTION_ERROR);
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const video = await loadVideo(objectUrl);
    try {
      if (!Number.isFinite(video.duration)) await seekTo(video, UNBOUNDED_SEEK_SECONDS);
      const frames: Array<{ blob: Blob; label: string }> = [];
      for (const time of descriptionSampleTimes(video.duration)) {
        await seekTo(video, time);
        frames.push({ blob: await drawToJpeg(video), label: frameTimeLabel(time) });
      }
      return frames;
    } finally {
      releaseVideo(video);
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
