import { PROVIDER_MODELS, findModel } from '../providers/catalog';
import type { ProviderId, ProviderModel } from '../providers/types';

/** Imports per account per rolling hour, shared by the browser and every agent, so
 *  connecting more agents does not raise the proxy bill. */
export const YOUTUBE_IMPORTS_PER_HOUR = 10;
/** The importer's ceiling for one section, end to end. */
export const YOUTUBE_IMPORT_TIMEOUT_MS = 120_000;
/** Below this a section is a frame, not a clip; P-Video-Edit states no minimum. */
const MIN_SECTION_SECONDS = 1;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

export interface YouTubeLink { videoId: string; startSeconds?: number }
export interface ClipSource { videoId: string; startSeconds: number; endSeconds: number }
/** An imported section as the edit form holds it: where it came from, and whether it was
 *  also saved to the library (with the reason when a requested save did not happen). */
export interface ImportedClipSource extends ClipSource { savedToLibrary?: boolean; libraryNotice?: string }
/** Where a saved library clip came from; stored with the asset and shown on its card. */
export interface ClipOrigin extends ClipSource { site: 'youtube'; title: string }
/** Model id stored on a saved clip's asset metadata; with provider `local-test` it marks
 *  the asset as uploaded media rather than a generation result. */
export const YOUTUBE_CLIP_MODEL = 'youtube-clip';

/** A video title is third-party text: one line, no control characters, at most 200 characters. */
export function cleanTitle(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Only the 11-character id leaves this function, never the pasted text, because the
 *  importer builds a command line from it. */
export function parseYouTubeUrl(input: string): YouTubeLink | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  else if (WATCH_HOSTS.has(host)) id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  if (!id || !VIDEO_ID.test(id)) return null;
  const t = url.searchParams.get('t');
  const startSeconds = t === null ? undefined : parseTimestamp(t);
  return startSeconds === undefined ? { videoId: id } : { videoId: id, startSeconds };
}

/** YouTube's `t` parameter: `75`, `75s` or `1h2m3s`. */
export function parseTimestamp(value: string): number | undefined {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  if (!value || !match) return undefined;
  const [, h = '0', m = '0', s = '0'] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export function watchUrl(source: { videoId: string; startSeconds?: number }): string {
  return `https://www.youtube.com/watch?v=${source.videoId}${source.startSeconds ? `&t=${Math.floor(source.startSeconds)}s` : ''}`;
}

export const roundTenth = (value: number) => Math.round(value * 10) / 10;

/** `m:ss.s`, or `h:mm:ss.s` from an hour, always with one decimal. */
export function formatClock(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const h = Math.floor(tenths / 36000), m = Math.floor((tenths % 36000) / 600);
  const ss = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Accepts `75`, `75.5`, `1:15`, `1:15.5` and `1:01:15.5`; anything else is undefined. */
export function parseClock(text: string): number | undefined {
  const parts = text.trim().split(':');
  if (parts.length > 3 || !/^\d+(?:\.\d)?$/.test(parts.at(-1)!) || parts.slice(0, -1).some(part => !/^\d+$/.test(part))) return undefined;
  const values = parts.map(Number);
  if (values.slice(1).some(value => value >= 60)) return undefined;
  return roundTenth(values.reduce((total, value) => total * 60 + value, 0));
}

export interface ImportBounds { minSeconds: number; maxSeconds: number; capability?: NonNullable<ProviderModel['videoEdit']> }

/** The section length a model accepts as an edit source or, with no model, the widest
 *  any edit model in the catalog accepts. Null for a model that cannot edit. */
export function importBounds(edit?: { provider: string; modelId: string }): ImportBounds | null {
  if (edit) {
    const capability = Object.hasOwn(PROVIDER_MODELS, edit.provider) ? findModel(edit.provider as ProviderId, edit.modelId)?.videoEdit : undefined;
    return capability ? { minSeconds: Math.max(MIN_SECTION_SECONDS, capability.minSeconds ?? 0), maxSeconds: capability.maxSeconds, capability } : null;
  }
  const all = Object.values(PROVIDER_MODELS).flat().flatMap(model => model.videoEdit ? [model.videoEdit] : []);
  return { minSeconds: Math.max(MIN_SECTION_SECONDS, Math.min(...all.map(c => c.minSeconds ?? 0))), maxSeconds: Math.max(...all.map(c => c.maxSeconds)) };
}

/** Why a section cannot be imported, in words a person can act on; null when it can. */
export function rangeProblem(startSeconds: number, endSeconds: number, bounds: ImportBounds): string | null {
  const tenth = (value: number) => Number.isFinite(value) && Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;
  if (!tenth(startSeconds) || !tenth(endSeconds) || startSeconds < 0) return 'Set From and To as times in the video, to a tenth of a second.';
  if (endSeconds <= startSeconds) return 'To must come after From.';
  const length = roundTenth(endSeconds - startSeconds);
  if (length < bounds.minSeconds || length > bounds.maxSeconds) return `Choose a section between ${bounds.minSeconds} and ${bounds.maxSeconds} seconds long.`;
  return null;
}
