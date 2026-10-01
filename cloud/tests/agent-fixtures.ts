import { DatabaseSync } from 'node:sqlite';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { createAgent, type AgentRow, type AgentSettings } from '../src/mcp/agents';
import type { Env } from '../src/security';
import { handleRequest } from '../src/index';
import { createSession } from '../src/sessions';

export const OWNER = 'owner';

/** A session cookie for OWNER: createSession upserts by Google subject. */
export async function signIn(env: Env) {
  return (await createSession(env, { subject: `google-${OWNER}`, email: `${OWNER}@example.test`, name: OWNER })).split(';')[0];
}
export function accountCall(env: Env, path: string, method = 'GET', cookie = '', body?: unknown) {
  return handleRequest(new Request(`http://localhost:8797/api/account/${path}`, {
    method, headers: { origin: env.APP_ORIGIN, cookie, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
}
/** A saved library row (the bytes, if a test needs them, go in the memory bucket). */
export function seedAsset(db: DatabaseSync, patch: { id: string; jobId: string | null; kind?: 'image' | 'video'; mimeType?: string; bytes?: number; userId?: string; createdAt?: number }) {
  const key = `accounts/${patch.userId ?? OWNER}/assets/${patch.id}`;
  const metadata = { provider: 'atlas', modelId: 'black-forest-labs/flux-schnell', mediaType: patch.kind ?? 'image', inputMode: 'text', prompt: 'a kite', values: {}, referenceIds: [] };
  db.prepare('INSERT INTO account_assets (id,user_id,job_id,object_key,kind,mime_type,bytes,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(patch.id, patch.userId ?? OWNER, patch.jobId, key, patch.kind ?? 'image', patch.mimeType ?? 'image/png', patch.bytes ?? 3, JSON.stringify(metadata), patch.createdAt ?? 1);
  return key;
}

export function seedUser(db: DatabaseSync, id: string) {
  db.prepare('INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES (?,?,?,?,1)').run(id, `google-${id}`, `${id}@example.test`, id);
}

/** A local-origin Worker env over an in-memory database with one signed-up user. */
export function agentEnv(extra: Partial<Env> = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(LOCAL_SCHEMA);
  seedUser(db, OWNER);
  const { bucket, objects } = memoryBucket();
  const env = {
    DB: adapter(db), ASSETS: bucket,
    APP_ORIGIN: 'http://localhost:3097', PUBLIC_WORKER_ORIGIN: 'http://localhost:8797', MCP_ORIGIN: 'http://localhost:8797',
    ...extra,
  } as Env;
  return { db, env, objects };
}

export function seedAgent(env: Env, settings: Partial<AgentSettings> = {}, userId = OWNER, clientName = 'Claude Code'): Promise<AgentRow> {
  return createAgent(env, { userId, clientId: `client-${clientName}`, clientName, settings: { budgetUsd: 5, allowUnknownCost: false, allowDelete: false, ...settings } });
}

/** A saved provider connection row; the ciphertext is never read by these tests. */
export function connectProvider(db: DatabaseSync, provider: string, userId = OWNER) {
  db.prepare("INSERT INTO account_connections (id,user_id,provider,ciphertext,nonce,key_version,revision,hint,updated_at) VALUES (?,?,?,'c','n','1',1,'****',1)")
    .run(`connection-${provider}-${userId}`, userId, provider);
}
