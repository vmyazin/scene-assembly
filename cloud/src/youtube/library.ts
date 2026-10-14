import { YOUTUBE_CLIP_MODEL, type ClipOrigin } from '../../../lib/youtube/clip';
import { writeOutput } from '../assets';
import { AccountError } from '../jobs';
import type { Env } from '../security';

/** Holds library room for a clip before any byte is written, so a full library is known
 *  while the clip can still go to a temporary input instead. False when it does not fit. */
export async function reserveLibraryRoom(env: Env, owner: string, bytes: number): Promise<boolean> {
  await env.DB.prepare('INSERT OR IGNORE INTO account_storage (user_id) VALUES (?)').bind(owner).run();
  const reserved = await env.DB.prepare('UPDATE account_storage SET reserved_bytes=reserved_bytes+? WHERE user_id=? AND used_bytes+reserved_bytes+?<=limit_bytes')
    .bind(bytes, owner, bytes).run();
  return reserved.meta.changes > 0;
}

async function releaseLibraryRoom(env: Env, owner: string, bytes: number) {
  await env.DB.prepare('UPDATE account_storage SET reserved_bytes=MAX(reserved_bytes-?,0) WHERE user_id=?').bind(bytes, owner).run();
}

/** Writes the clip as a library asset in the room `reserveLibraryRoom` held. Metadata keeps
 *  the job-request shape every asset has (provider `local-test` marks it as uploaded media,
 *  as browser imports are), plus the clip's origin for its library card. */
export async function storeClipAsset(env: Env, owner: string, body: ReadableStream<Uint8Array>, bytes: number, origin: ClipOrigin): Promise<string> {
  const id = crypto.randomUUID(), key = `accounts/${owner}/assets/${id}`;
  const metadata = {
    provider: 'local-test', modelId: YOUTUBE_CLIP_MODEL, mediaType: 'video', inputMode: 'edit',
    prompt: origin.title || 'YouTube clip', values: {}, referenceIds: [], origin,
  };
  try {
    const object = await writeOutput(env, key, body, 'video/mp4', bytes);
    if (object.size !== bytes) throw new AccountError('The imported clip did not store intact.', 502, 'upload_size');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO account_assets (id,user_id,job_id,object_key,kind,mime_type,bytes,metadata_json,created_at) VALUES (?,?,NULL,?,'video','video/mp4',?,?,?)")
        .bind(id, owner, key, bytes, JSON.stringify(metadata), Date.now()),
      env.DB.prepare('UPDATE account_storage SET used_bytes=used_bytes+?,reserved_bytes=MAX(reserved_bytes-?,0) WHERE user_id=?').bind(bytes, bytes, owner),
    ]);
    return id;
  } catch (error) {
    await releaseLibraryRoom(env, owner, bytes);
    await env.ASSETS?.delete(key).catch(() => {});
    throw error;
  }
}
