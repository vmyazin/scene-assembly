import { describe, expect, it } from 'vitest';
import { listAssets } from '../src/job-routes';
import { accountCall, agentEnv, OWNER, seedAsset, seedUser, signIn } from './agent-fixtures';
import type { DatabaseSync } from 'node:sqlite';

/** A saved asset from one run of `prompt` on `modelId`. */
function seedRun(db: DatabaseSync, id: string, modelId: string, createdAt: number, userId = OWNER) {
  seedAsset(db, { id, jobId: null, kind: 'video', mimeType: 'video/mp4', createdAt, userId });
  const metadata = { provider: 'runware', modelId, mediaType: 'video', inputMode: 'text', prompt: 'A fox at dawn', values: { duration: 5 }, referenceIds: [] };
  db.prepare('UPDATE account_assets SET metadata_json=? WHERE id=?').run(JSON.stringify(metadata), id);
}

const list = (env: ReturnType<typeof agentEnv>['env'], options: { rating?: string; provider?: string; modelId?: string } = {}) =>
  listAssets(env, OWNER, { kind: null, cursor: null, temporaryOnly: false, ...options });

describe('asset ratings', () => {
  it('saves, returns and clears a rating through the account route', async () => {
    const { db, env } = agentEnv();
    seedRun(db, 'clip-1', 'bytedance:seedance@2.5', 1);
    const cookie = await signIn(env);

    const rated = await accountCall(env, 'assets/clip-1/rating', 'POST', cookie, { rating: 'great' });
    expect(rated.status).toBe(200);
    expect((await rated.json()).asset.rating).toBe('great');
    expect((await list(env)).assets[0].rating).toBe('great');

    await accountCall(env, 'assets/clip-1/rating', 'POST', cookie, { rating: null });
    expect((await list(env)).assets[0]).not.toHaveProperty('rating');
  });

  it('refuses a mark outside the vocabulary', async () => {
    const { db, env } = agentEnv();
    seedRun(db, 'clip-1', 'bytedance:seedance@2.5', 1);
    const response = await accountCall(env, 'assets/clip-1/rating', 'POST', await signIn(env), { rating: 'exceptional' });
    expect(response.status).toBe(400);
  });

  it('cannot rate another account\'s asset', async () => {
    const { db, env } = agentEnv();
    seedUser(db, 'other');
    seedRun(db, 'theirs', 'bytedance:seedance@2.5', 1, 'other');
    const response = await accountCall(env, 'assets/theirs/rating', 'POST', await signIn(env), { rating: 'down' });
    expect(response.status).toBe(404);
    expect(db.prepare("SELECT rating FROM account_assets WHERE id='theirs'").get()?.rating).toBeNull();
  });

  it('filters by rating and by model before paging, and counts account-wide', async () => {
    const { db, env } = agentEnv();
    seedRun(db, 'seedance-great', 'bytedance:seedance@2.5', 3);
    seedRun(db, 'seedance-miss', 'bytedance:seedance@2.5', 2);
    seedRun(db, 'kling-good', 'klingai:kling@3', 1);
    db.prepare("UPDATE account_assets SET rating='great' WHERE id='seedance-great'").run();
    db.prepare("UPDATE account_assets SET rating='down' WHERE id='seedance-miss'").run();
    db.prepare("UPDATE account_assets SET rating='good' WHERE id='kling-good'").run();

    expect((await list(env, { rating: 'good-up' })).assets.map(asset => asset.id)).toEqual(['seedance-great', 'kling-good']);
    expect((await list(env, { rating: 'down' })).assets.map(asset => asset.id)).toEqual(['seedance-miss']);
    expect((await list(env, { rating: 'unrated' })).assets).toEqual([]);
    expect((await list(env, { provider: 'runware', modelId: 'klingai:kling@3' })).assets.map(asset => asset.id)).toEqual(['kling-good']);

    const { counts } = await list(env, { rating: 'great' });
    expect(counts.ratings).toEqual({ unrated: 0, down: 1, good: 1, great: 1 });
    expect(counts.models).toEqual([
      { provider: 'runware', modelId: 'bytedance:seedance@2.5', mediaType: 'video', count: 2 },
      { provider: 'runware', modelId: 'klingai:kling@3', mediaType: 'video', count: 1 },
    ]);
  });

  it('rejects an unknown rating filter or a model without its provider', async () => {
    const { env } = agentEnv();
    await expect(list(env, { rating: 'best' })).rejects.toMatchObject({ status: 400 });
    await expect(list(env, { provider: 'runware' })).rejects.toMatchObject({ status: 400 });
  });
});
