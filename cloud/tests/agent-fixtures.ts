import { DatabaseSync } from 'node:sqlite';
import { adapter } from './database';
import { memoryBucket } from './bucket';
import { LOCAL_SCHEMA } from '../src/schema';
import { createAgent, type AgentRow, type AgentSettings } from '../src/mcp/agents';
import type { Env } from '../src/security';

export const OWNER = 'owner';

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
