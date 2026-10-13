import { accountRequest } from './client';
import { stageSource } from './staged-sources';
import type { ClipSource } from '@/lib/youtube/clip';

export interface YouTubeClipInput { url: string; startSeconds: number; endSeconds: number; provider: string; modelId: string }
interface ImportedClip { uploadId: string; bytes: number; expiresAt: number; previewUrl: string; source: ClipSource }

/** Cuts the section on the Worker, then fetches the finished clip once from the
 *  Worker origin (Vercel cannot relay it) so preview, probing and validation work on
 *  a File like any other source. The returned File is staged: submitting it skips the
 *  second upload. */
export async function importYouTubeClip(input: YouTubeClipInput, signal: AbortSignal, owner: string, onImported?: () => void): Promise<{ file: File; source: ClipSource }> {
  const clip = await accountRequest<ImportedClip>('youtube-clips', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Account-Id': owner },
    body: JSON.stringify({ url: input.url, startSeconds: input.startSeconds, endSeconds: input.endSeconds, edit: { provider: input.provider, modelId: input.modelId } }),
  });
  onImported?.();
  const response = await fetch(clip.previewUrl, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!response.ok) throw new Error('The clip was imported but could not be loaded. Try again.');
  const file = new File([await response.blob()], `youtube-${clip.source.videoId}-${Math.floor(clip.source.startSeconds)}s.mp4`, { type: 'video/mp4' });
  stageSource(file, { uploadId: clip.uploadId, owner, expiresAt: clip.expiresAt });
  return { file, source: clip.source };
}
