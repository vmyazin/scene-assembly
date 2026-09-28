-- Agents connected over MCP: docs/claude/specs/2026-09-28-agent-mcp-design.md.
CREATE TABLE IF NOT EXISTS account_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  budget_micros INTEGER NOT NULL CHECK (budget_micros BETWEEN 500000 AND 500000000),
  allow_unknown_cost INTEGER NOT NULL DEFAULT 0,
  allow_delete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS account_agents_user ON account_agents(user_id);
CREATE TABLE IF NOT EXISTS account_agent_authorizations (
  id TEXT PRIMARY KEY,
  consent_handle TEXT NOT NULL,
  description_json TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_host TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('approved','denied')),
  user_id TEXT REFERENCES account_users(id) ON DELETE CASCADE,
  settings_json TEXT,
  -- One-time secret (hashed) for the approving browser, checked at /oauth/finish
  -- alongside the library's own binding cookie: the cookie proves which browser
  -- *started* the request, not which one *approved* it (fix round 1, finding 1).
  finish_hash TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_agent_authorizations_expiry ON account_agent_authorizations(expires_at);
CREATE TABLE IF NOT EXISTS account_agent_charges (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES account_agents(id) ON DELETE CASCADE,
  job_id TEXT,
  estimate_micros INTEGER,
  actual_micros INTEGER,
  confidence TEXT NOT NULL,
  released INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_agent_charges_window ON account_agent_charges(agent_id, at);
CREATE INDEX IF NOT EXISTS account_agent_charges_job ON account_agent_charges(job_id);
-- No foreign key: a job outlives the agent that started it, and keeps its name.
ALTER TABLE account_jobs ADD COLUMN agent_id TEXT;
