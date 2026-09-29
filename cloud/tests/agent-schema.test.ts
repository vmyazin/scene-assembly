import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { adapter } from './database';
import { AGENT_SCHEMA, LOCAL_SCHEMA, bootstrapLocalSchema } from '../src/schema';

const migrations = new URL('../migrations/', import.meta.url);
const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name);
const normalize = (sql: string) => sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();
let db: DatabaseSync;
afterEach(() => { try { db?.close(); } catch {} finally { db = undefined; } });

describe('agent schema', () => {
  it('applies on top of every earlier production migration', () => {
    db = new DatabaseSync(':memory:');
    for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
      db.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
    expect(columns(db, 'account_jobs')).toContain('agent_id');
    expect(columns(db, 'account_agents')).toEqual(expect.arrayContaining(['client_name', 'budget_micros', 'allow_unknown_cost', 'allow_delete', 'revoked_at']));
    expect(columns(db, 'account_agent_authorizations')).toEqual(expect.arrayContaining(['consent_handle', 'description_json', 'decision', 'settings_json', 'finish_hash', 'expires_at']));
    expect(columns(db, 'account_agent_charges')).toEqual(expect.arrayContaining(['job_id', 'estimate_micros', 'actual_micros', 'released', 'at']));
  });

  it('keeps the local schema and the migration describing the same tables', () => {
    const migration = normalize(readFileSync(new URL('0013_agents.sql', migrations), 'utf8'));
    for (const statement of AGENT_SCHEMA.split(';').map(normalize).filter(Boolean)) expect(migration).toContain(statement);
  });

  // 0013 becomes immutable once production applies it, so its comments are
  // permanent: they carry the rationale, word for word the same in both texts,
  // and nothing about how the review that produced them went.
  it('keeps the comments identical and free of review-process wording', () => {
    const migration = readFileSync(new URL('0013_agents.sql', migrations), 'utf8');
    expect(migration).toContain(AGENT_SCHEMA.trim());
    for (const text of [migration, AGENT_SCHEMA]) expect(text).not.toMatch(/fix round|finding \d/i);
  });

  it('gives a fresh local database the agent tables and the job column', () => {
    db = new DatabaseSync(':memory:');
    db.exec(LOCAL_SCHEMA);
    expect(columns(db, 'account_jobs')).toContain('agent_id');
    expect(columns(db, 'account_agents')).toContain('client_name');
  });

  it('upgrades a local database created before agents without losing its jobs', async () => {
    db = new DatabaseSync(':memory:');
    db.exec(LOCAL_SCHEMA.replace(AGENT_SCHEMA, '').replace('  agent_id TEXT,\n', ''));
    expect(columns(db, 'account_jobs')).not.toContain('agent_id');
    db.exec("INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','g','o@example.test','Owner',1)");
    db.exec("INSERT INTO account_jobs (id,user_id,request_token,request_digest,provider,request_json,reservation_bytes,created_at,updated_at) VALUES ('job-1','owner','token-1234567890123','d','fal','{}',1,1,1)");
    await bootstrapLocalSchema(adapter(db));
    await bootstrapLocalSchema(adapter(db)); // a second start must be a no-op
    expect(columns(db, 'account_jobs')).toContain('agent_id');
    expect(columns(db, 'account_agent_charges')).toContain('released');
    expect(db.prepare('SELECT id, agent_id FROM account_jobs').get()).toEqual({ id: 'job-1', agent_id: null });
  });
});
