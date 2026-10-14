import { mediaAccess } from '../media';
import { AccountError } from '../jobs';
import { json, type Env } from '../security';
import { currentAccount } from '../sessions';
import { discardUploads } from '../uploads';
import { importYouTubeClip, type YouTubeImportInput } from './import';

function parseBody(value: unknown): YouTubeImportInput | null {
  if (!value || typeof value !== 'object') return null;
  const { url, startSeconds, endSeconds, edit, saveToLibrary } = value as Record<string, unknown>;
  if (typeof url !== 'string' || url.length > 2048 || typeof startSeconds !== 'number' || typeof endSeconds !== 'number') return null;
  if (saveToLibrary !== undefined && typeof saveToLibrary !== 'boolean') return null;
  const save = saveToLibrary ? { saveToLibrary: true } : {};
  if (edit === undefined) return { url, startSeconds, endSeconds, ...save };
  const { provider, modelId } = (edit ?? {}) as Record<string, unknown>;
  if (typeof provider !== 'string' || typeof modelId !== 'string' || provider.length > 100 || modelId.length > 200) return null;
  return { url, startSeconds, endSeconds, edit: { provider, modelId }, ...save };
}

/** POST /api/account/youtube-clips. Not under /imports: that path and its gateway
 *  pattern belong to the browser → cloud library import. */
export async function youtubeRoutes(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/account/youtube-clips') return null;
  if (request.method !== 'POST') return json({ error: 'Not found.' }, 404);
  const account = await currentAccount(request, env);
  if (!account) return json({ error: 'Sign in to import a clip.' }, 401);
  const text = await request.text();
  if (text.length > 4096) return json({ error: 'Request is too large.' }, 413);
  let input: YouTubeImportInput | null;
  try { input = parseBody(JSON.parse(text)); } catch { input = null; }
  if (!input) return json({ error: 'Invalid request.', code: 'invalid_field' }, 400);
  try {
    const clip = await importYouTubeClip(env, account.id, input, request.signal);
    // Vercel cannot relay a clip this size, so the browser fetches it from the Worker origin.
    let preview: Awaited<ReturnType<typeof mediaAccess>>;
    try { preview = await mediaAccess(env, account.id, clip.uploadId, 'preview'); }
    catch (error) {
      // The browser never learns this upload's id, so nothing would ever delete it, and it
      // would hold the account's temporary-input room for 24 hours.
      await discardUploads(env, account.id, [clip.uploadId]);
      throw error;
    }
    return json({ ...clip, previewUrl: preview.url }, 201);
  } catch (error) {
    if (!(error instanceof AccountError)) throw error;
    return json({ error: error.message, code: error.code, ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }, error.status);
  }
}
