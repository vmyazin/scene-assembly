import { importBounds, parseYouTubeUrl, rangeProblem, roundTenth, type ClipSource } from '../../../lib/youtube/clip';
import { MAX_EDIT_VIDEO_BYTES, validateEditSource } from '../../../lib/providers/video-edit';
import { sanitizeProviderMessage } from '../failure';
import { AccountError } from '../jobs';
import type { Env } from '../security';
import { copyAssetToUpload, storeUpload } from '../uploads';
import { fromResponse, type ClipFailure } from './importer-core';
import { reserveLibraryRoom, storeClipAsset } from './library';

export interface YouTubeImportInput { url: string; startSeconds: number; endSeconds: number; edit?: { provider: string; modelId: string }; saveToLibrary?: boolean }
export interface YouTubeImportResult {
  uploadId: string; mimeType: 'video/mp4'; bytes: number; durationSeconds: number; width: number; height: number; expiresAt: number; source: ClipSource;
  /** True when the clip was also saved as a library asset (`assetId`). */
  savedToLibrary: boolean; assetId?: string;
  /** Why a requested save did not happen; the import itself still succeeded. */
  libraryNotice?: string;
}

export const LIBRARY_FULL_NOTICE = 'Your library is full, so this clip was imported for this edit only.';

/** Container padding (AAC priming, a last frame) lands within this of the requested
 *  length; further off is a cut that went wrong. */
const LENGTH_SLACK_SECONDS = 0.25;
const UNAVAILABLE: Record<NonNullable<ClipFailure['reason']>, string> = {
  private: 'it is private', members: 'it is for channel members only', age: 'it is age-restricted',
  live: 'it is a live stream or premiere', removed: 'it is unavailable',
};

function withRetry(error: AccountError, seconds: number): AccountError {
  error.retryAfterSeconds = seconds;
  return error;
}

const minutes = (seconds: number) => { const count = Math.ceil(seconds / 60); return `${count} ${count === 1 ? 'minute' : 'minutes'}`; };

function toAccountError(failure: ClipFailure): AccountError {
  // yt-dlp's text is the one string here we did not write, and it can echo the proxy URL.
  const detail = sanitizeProviderMessage(failure.detail);
  if (detail) console.warn('youtube import refused', failure.code, detail);
  const wait = failure.retryAfterSeconds ?? 60;
  switch (failure.code) {
    case 'range': return new AccountError('That section runs past the end of the video.', 400, 'invalid_range');
    case 'unavailable': return new AccountError(`This video can't be imported: ${UNAVAILABLE[failure.reason ?? 'removed']}.`, 422, 'source_unavailable');
    case 'no_720p': return new AccountError('This video has no 720p version, which video editing needs.', 422, 'source_unavailable');
    case 'rate_limited': return withRetry(new AccountError(`Import limit reached. Try again in ${minutes(wait)}.`, 429, 'import_rate_limited'), wait);
    case 'busy': return withRetry(new AccountError('Another import is still running for this account.', 429, 'import_rate_limited'), wait);
    case 'timeout': return withRetry(new AccountError('The import took too long. Try a shorter section.', 503, 'source_refused'), wait);
    case 'cancelled': return withRetry(new AccountError('Import cancelled.', 503, 'source_refused'), 5);
    case 'unconfigured': return withRetry(new AccountError('YouTube import is not available right now.', 503, 'source_refused'), 300);
    default: return withRetry(new AccountError('YouTube refused the download. Try again in a few minutes.', 503, 'source_refused'), wait);
  }
}

/** The one import path: the browser route and the MCP add_reference tool both call
 *  this, so a refusal an agent reads and one a person reads are the same check. */
export async function importYouTubeClip(env: Env, owner: string, input: YouTubeImportInput, signal?: AbortSignal): Promise<YouTubeImportResult> {
  const link = parseYouTubeUrl(input.url);
  if (!link) throw new AccountError('Paste a YouTube video or Shorts link.', 400, 'invalid_field');
  const bounds = importBounds(input.edit);
  if (!bounds) throw new AccountError('That model cannot edit a source video.', 400, 'invalid_field');
  const problem = rangeProblem(input.startSeconds, input.endSeconds, bounds);
  if (problem) throw new AccountError(problem, 400, 'invalid_range');
  if (!env.YOUTUBE_IMPORTER) throw withRetry(new AccountError('YouTube import is not available right now.', 503, 'source_refused'), 300);
  const source: ClipSource = { videoId: link.videoId, startSeconds: input.startSeconds, endSeconds: input.endSeconds };
  let response: Response;
  try {
    response = await env.YOUTUBE_IMPORTER.getByName(owner).fetch('https://youtube-importer/clip', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(source), signal,
    });
  } catch (error) {
    // The caller hung up: the same answer as a cancel the importer saw itself.
    if (signal?.aborted) throw toAccountError({ ok: false, code: 'cancelled', detail: '' });
    // A Durable Object that was reset, overloaded or failed to deploy.
    console.warn('youtube importer unreachable', sanitizeProviderMessage(error instanceof Error ? error.message : String(error)));
    throw withRetry(new AccountError('YouTube refused the download. Try again in a few minutes.', 503, 'source_refused'), 30);
  }
  const clip = await fromResponse(response);
  if (!clip.ok) throw toAccountError(clip);
  if (!Number.isSafeInteger(clip.bytes) || clip.bytes <= 0 || clip.bytes > MAX_EDIT_VIDEO_BYTES) {
    await clip.body.cancel().catch(() => {});
    throw new AccountError('The clip came out larger than 100 MB. Choose a shorter section.', 413, 'invalid_range');
  }
  const requested = roundTenth(input.endSeconds - input.startSeconds);
  // Judge the clip by what the importer reports before any byte is stored, so a bad cut
  // costs neither temporary-input room nor library storage.
  const reject = async (error: AccountError) => { await clip.body.cancel().catch(() => {}); return error; };
  if (!(Math.abs(clip.durationSeconds - requested) <= LENGTH_SLACK_SECONDS)) throw await reject(withRetry(new AccountError('The section could not be cut cleanly. Try again.', 503, 'source_refused'), 10));
  const probed = { durationSeconds: requested, width: clip.width, height: clip.height };
  if (bounds.capability) {
    try { validateEditSource(probed, bounds.capability); }
    catch (error) { throw await reject(new AccountError(error instanceof Error ? error.message : 'This clip cannot be used as an edit source.', 422, 'source_unavailable')); }
  }
  const base = { mimeType: 'video/mp4' as const, bytes: clip.bytes, ...probed, source };
  if (input.saveToLibrary) {
    if (await reserveLibraryRoom(env, owner, clip.bytes)) {
      const assetId = await storeClipAsset(env, owner, clip.body, clip.bytes, { site: 'youtube', ...source, title: clip.title });
      // The edit source is a copy, exactly as when a library clip is picked: the asset
      // outlives the job, the input is cleaned up after it.
      const uploadId = await copyAssetToUpload(env, owner, assetId);
      const row = await env.DB.prepare('SELECT expires_at FROM account_uploads WHERE id=?').bind(uploadId).first<{ expires_at: number }>();
      return { ...base, uploadId, expiresAt: row?.expires_at ?? Date.now(), savedToLibrary: true, assetId };
    }
    const stored = await storeUpload(env, owner, clip.body, clip.bytes, 'video/mp4');
    return { ...base, uploadId: stored.id, expiresAt: stored.expiresAt, savedToLibrary: false, libraryNotice: LIBRARY_FULL_NOTICE };
  }
  const stored = await storeUpload(env, owner, clip.body, clip.bytes, 'video/mp4');
  return { ...base, uploadId: stored.id, expiresAt: stored.expiresAt, savedToLibrary: false };
}
