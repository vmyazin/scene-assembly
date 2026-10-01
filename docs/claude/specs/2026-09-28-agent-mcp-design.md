# Agent MCP: let a person's agents run Scene Assembly generation

Status: Approved design
Date: 2026-09-28

## Follow-up decisions (2026-09-28, while planning)

Each note below overrides the section it names. They come from reading the
installed libraries and the code the plan touches; the plan
(`docs/claude/plans/2026-09-28-agent-mcp.md`) implements these, not the
superseded text.

1. **No `agents` package.** `@modelcontextprotocol/server` 2.1.0 ships its own
   `createMcpHandler(factory, { legacy: 'stateless' })`, whose `.fetch(request,
   { authInfo })` serves both the 2026-07-28 protocol and 2025-era clients.
   `agents` 0.24 would add esbuild, babel and a dozen optional peers for the same
   thing. Overrides *Scope → cloud/package.json*.
2. **The OAuth library's consent helpers replace the hand-rolled binding
   cookie.** `@cloudflare/workers-oauth-provider` 1.2.1 has `describeConsent`,
   `beginConsent` (binds a handle to the browser with a cookie and forbids
   framing), `approveConsent` / `denyConsent` (cookie must match, single use,
   600 s TTL, the request sealed in KV). `/oauth/authorize` stores the consent
   handle and `describeConsent` output in D1 instead of a binding hash and the
   raw request; `/oauth/finish` calls `approveConsent`/`denyConsent` with that
   handle. Overrides *Authorization and consent* steps 2 and 5 and the
   `account_agent_authorizations` columns in *Data model*.
3. **Client ID Metadata Documents are enabled**
   (`clientIdMetadataDocumentEnabled: true`), so a client identified by an https
   URL (as Claude.ai is) shows a verified domain; only self-registered clients
   are labelled unverified.
4. **Registration rate limit lives in the entry wrapper.** The library's
   `clientRegistrationCallback` receives no `env`, so `/oauth/register` is
   counted in `cloud/src/entry.ts` before the provider runs.
5. **New var `MCP_ORIGIN`** (production `https://mcp-sceneassembly.smoxu.com`,
   local `http://localhost:8797`): the `/oauth/finish` redirect, the panel's MCP
   URL and the `add_reference` own-host list read it.
6. **Estimates are the ledger.** `estimateCloudJob(request)` is
   `buildAccountSpendEntry` over a one-output synthetic result, so they agree by
   construction. Reading every branch showed the unknown set is larger than the
   spec assumed: **Kie, Runware, Cloudflare, Pollinations and Comet are always
   `unknown`** in the account ledger — every `COMET_MODELS` entry carries
   `price: 'metered'` with no `rate`; Gemini is `estimated` from its
   per-resolution rate and settles to reported tokens (slightly higher, since
   the prompt's own tokens count); fal, Atlas and PiAPI are `estimated`
   from catalog rates. With the default grant an agent therefore cannot use Kie,
   Runware, Cloudflare, Pollinations or Comet until the person allows unknown
   prices. The consent screen lists them. Overrides the estimate bullet in
   *Budget*.
7. **`generate` writes schema defaults into `values`** before estimating and
   submitting. The ledger reads raw `values` (a fal Veo job without `duration`
   prices as unknown, while the adapter would have used the default), so an
   explicit value is what makes the estimate, the submission and the ledger
   describe the same run.
8. **`list_models` describes settings per mode**: `modes[]` of `{ mode, fields,
   references: { min, max }, sourceVideo }`, because fal variants carry
   different fields per mode. Fields are included only when the call names a
   `provider` or `modelId`; the unfiltered catalog (100+ models) is a compact
   list. Overrides the `list_models` row and the `modes?` field member.
9. **Sign-in gains a validated return path.** `AccountAccess` hard-codes
   `/account` in four places and the sign-in page ignores query parameters, so a
   signed-out person sent from `/connect-agent` would lose the request. The
   Worker's `returnPath` moves to `lib/account/return-path.ts` so the page and
   the Worker apply one rule. Adds to *Scope*.
10. **"via <agent>" renders on `CloudJobCardGrid` and `CloudAssetGrid` only.**
    `CloudJobList` has no provider/model meta line to extend.
11. **`add_reference` accepts PNG, JPEG, WebP, AVIF, MP4 and WebM** — not MOV,
    because `writeOutput` (which stores every input) rejects `video/quicktime`.
12. **The charge for a cancelled job is released inside `cancelQueuedJob`'s own
    batch**, so a cancel from the browser releases an agent's charge too.
13. **Agent tables join `LOCAL_SCHEMA`.** The job and asset list queries join
    `account_agents` for the "via" name, so every test database needs the table;
    `LOCAL_SCHEMA` becomes the existing string plus a readable `AGENT_SCHEMA`.
14. **Retryable statuses move to `lib/providers/route-error.ts`**
    (`isRetryableStatus`), because `auto-retry.ts` is a `'use client'` React
    module the Worker cannot import.
15. **CIMD is off** (overrides follow-up 3), until `global_fetch_strictly_public`
    is evaluated — enabling it changes every outbound `fetch` this Worker makes,
    which needs its own decision. Until then every client, including
    URL-identified ones such as Claude.ai, registers through DCR and shows as
    unverified.
16. **`resourceMetadata.resource` is required** (`@cloudflare/workers-oauth-provider`
    1.2.1), derived from `MCP_ORIGIN` as `<origin>/mcp`. Protected-resource
    metadata is then served only at `/.well-known/oauth-protected-resource/mcp`
    on that exact host, so locally the MCP URL must use `localhost`, not
    `127.0.0.1`, and the workers.dev hostname cannot be used as an MCP URL.
17. **Refresh tokens are a fixed 30 days from the grant**, with no sliding idle
    TTL, so a connected agent re-consents monthly.
18. **Completing a connection needs a one-time finish secret returned only to
    the approving browser, as well as the starter's binding cookie** (2026-09-28,
    Task 9 fix round 1), so a link to a request someone else started cannot be
    redeemed by them after you approve it. `/oauth/authorize`'s binding cookie
    proves which browser *started* a request, not which one *approved* it —
    `/oauth/finish` cannot see `__Host-sa_session` (host-only on `APP_ORIGIN`, a
    different origin), so nothing else distinguishes the approver from anyone
    sent the starter's `?request=` link. `POST
    /api/account/agent-authorizations/:id`'s decision now also stores
    `finish_hash = hash(randomToken())` and returns `redirectTo` with
    `&t=<secret>`; `/oauth/finish` requires a matching `t` (checked against
    `finish_hash` in the same consuming `DELETE ... RETURNING`) before it even
    considers the row, in addition to the library's own cookie check —
    completing a connection needs both. `/oauth/authorize` and `/oauth/finish`
    are each limited to 30 requests per minute per client IP (their own
    buckets), next to `/oauth/register`'s existing 20, since both are
    unauthenticated GETs that write to D1. Overrides follow-up 2 and Task 9
    Steps 1 and 3 in the plan.
19. **The four items in "Verify before building on it" held, and the local
    smoke tests mostly passed** (2026-09-28). Item 1: verified — two
    end-to-end smokes ran `@cloudflare/workers-oauth-provider` 1.2.1 and
    `createMcpHandler` from `@modelcontextprotocol/server` 2.1.0 under
    `wrangler dev --local` (Wrangler 4.113, `compatibility_date`
    2026-07-20): registration, authorize, sign-in return, consent, finish,
    token exchange, MCP tool calls, 401 without a token. Item 2: verified —
    `cloud/src/entry.ts` wraps the provider in `{ fetch, scheduled }` and the
    consent helpers on `env.OAUTH_PROVIDER` work. Item 3: props arrive on
    `ctx.props` in `mcpApiHandler.fetch` (`cloud/src/mcp/handler.ts`), which
    `cloud/src/entry.ts` wires as the `OAuthProvider`'s `apiHandler`;
    `serveMcp` (same file) reloads the agent row and passes an `AuthInfo` to
    the MCP handler. `completeAuthorization` returns only `{ redirectTo }`
    (`@cloudflare/workers-oauth-provider`'s type declarations) — it does not
    expose the grant id — so revoke lists grants with `listUserGrants` and
    matches `metadata.agentId` (`cloud/src/mcp/agents.ts`, `revokeUserGrants`,
    around line 79). Item 4: the Images binding runs locally under `wrangler
    dev --local`; `cloud/wrangler.jsonc` declares `"images": { "binding":
    "IMAGES" }`.

    Smoke coverage: the key-free parts passed — `tools/list` shows 12 tools
    for a default grant (`delete_asset` hidden); `list_models`, `get_spend`,
    `list_jobs`, `list_assets` answer; `generate` without a provider
    connection refuses with `connection_required`; `get_job` with an unknown
    id refuses with `not_found`; the account panel shows the MCP URL,
    per-agent 24-hour usage against its limit, the toggles, and Disconnect,
    after which the same token gets 401 `invalid_token`. Not exercised
    locally: `generate` → `get_job` → `view_asset` with a saved provider key,
    the budget refusal loop, and `add_reference` against a live URL; unit
    tests cover them, and Rollout step 4's production live check is where
    they are first run end to end.

    Each reconnect of the same client creates a separate connected agent
    with its own limit — `createAgent` always inserts a new
    `account_agents` row, with no dedupe on `client_id`. The person
    disconnects the old one from the panel. This is current behaviour;
    name-based dedupe is left for later.
20. **The MCP host is `mcp-sceneassembly.mzork.com`, not
    `mcp.sceneassembly.mzork.com`** (2026-09-28). The zone's Universal SSL
    certificate on `mzork.com` covers one subdomain level; the originally
    planned host is two levels deep and Universal SSL does not cover it, while
    `mcp-sceneassembly.mzork.com` sits at the covered level and had no existing
    DNS record, so the Workers custom domain can claim it. `workers_dev` stays
    on in `cloud/wrangler.jsonc` (follow-up 5 and the Goals section's MCP URL
    are corrected to the new host).
21. **The MCP host is `mcp-sceneassembly.smoxu.com`** (2026-09-29), superseding
    follow-up 20. The first production deploy could not attach
    `mcp-sceneassembly.mzork.com`: the mzork.com zone belongs to a different
    Cloudflare account from the Worker, and a Worker can only claim a custom
    domain in its own account's zones (a cross-account CNAME to workers.dev is
    refused as well). smoxu.com is the person's domain for projects like this
    one; the new host sits one level under it, so Universal SSL covers it. The
    app stays at `sceneassembly.mzork.com`, which only matters for the consent
    redirect and the guide's links, both of which already use `APP_ORIGIN`.

## Context

Scene Assembly generates images and video two ways. Guest generation runs in the
browser with keys held by the browser, so nothing outside that tab can reach it.
Signed-in generation runs on the account Worker (`cloud/`): the browser posts a
`CloudJobRequest` to `POST /api/account/jobs`, `acceptJob` books quota and a job
slot, a `GenerationWorkflow` submits to the provider with the key held encrypted in
the account vault, and the output lands in R2 as a library asset. That path already
has everything an agent would need — list, get, cancel, resume, dismiss, a paged
library, reference uploads, a spend ledger — but only a browser can call it: every
route authenticates with the `__Host-sa_session` cookie on the app origin, every
write must carry `Origin: APP_ORIGIN`, and the app reaches the Worker through
`lib/account/gateway.ts`, which allowlists paths, caps bodies at 40 KB and times
out at 25 s.

This design adds a remote MCP server so that any signed-in person can connect an
agent (Claude.ai, Claude Code, Cursor, anything that speaks MCP over Streamable
HTTP) to their own account, and have it generate on their behalf within a spend
limit they set.

## Goals

- **One hosted MCP endpoint per deployment**, served by the account Worker at
  `https://mcp-sceneassembly.smoxu.com/mcp` (a Workers custom domain on the same
  Worker), authorised with OAuth 2.1 so a person connects an agent by signing in
  with the Google account they already use.
- **The whole generation loop**: discover runnable models with their settings,
  price a request, start image or video jobs (including reference, frames and edit
  modes), wait for and inspect results, cancel, resume and dismiss jobs, browse and
  delete library assets, read spend.
- **A spend limit per connected agent**, set at consent and editable afterwards,
  enforced atomically where jobs are accepted.
- **The same rules as the browser.** Every tool goes through the functions the HTTP
  routes use, so quotas, validation, refusal codes and failure reasons cannot drift
  between the two callers.
- **A person can see and control their agents**: a Connected agents panel on
  `/account`, and a "via <agent>" mark on jobs and assets an agent started.

## Non-goals

- Guest (browser-key) generation. An agent can use only providers connected to the
  account and enabled in `CLOUD_GENERATION_PROVIDERS`.
- Anything touching provider keys. No tool reads, writes or lists a secret.
- The timeline, export, gallery import or prompt library.
- Base64 image arguments. A model cannot reliably emit one; URL fetch and a signed
  PUT cover the real cases.
- MCP async Tasks. `get_job`'s bounded wait covers long jobs for v1.
- Reserving job slots for the person. An agent's jobs share the account's 10 active
  slots with the browser's.
- Organisations, shared accounts or third-party-verified clients.

## Scope and implementation boundary

**Lives in (new):**

| Path | Role |
| --- | --- |
| `cloud/src/mcp/auth.ts` | `/oauth/authorize`, `/oauth/finish`, pending-authorization rows |
| `cloud/src/mcp/agents.ts` | `account_agents` rows; `/api/account/agents*` and `/api/account/agent-authorizations/*` routes |
| `cloud/src/mcp/budget.ts` | `reserveCharge`, `attachCharge`, `releaseCharge`, `settleCharge`, `budgetStatus` |
| `cloud/src/mcp/server.ts` | `createServer(agent)` — per-request `McpServer`, server instructions, tool registration gated by the grant |
| `cloud/src/mcp/tools/{models,jobs,references,library,spend}.ts` | Tool handlers as plain functions `(ctx, args) => result` |
| `cloud/src/mcp/errors.ts` | `toolError(code, message, extra)`, the wrapper that turns `AccountError` and unknown errors into tool results |
| `cloud/src/mcp/fetch-reference.ts` | The guarded URL fetch behind `add_reference` |
| `cloud/migrations/0013_agents.sql` | Tables and the `account_jobs.agent_id` column |
| `lib/account/model-schema.ts` | Pure: normalises the four catalog shapes into one field vocabulary |
| `lib/spend/estimate.ts` | Pure: `estimateCloudJob(request)` from the existing resolvers |
| `app/connect-agent/page.tsx` | Consent screen |
| `components/account/ConnectedAgentsPanel.tsx` | The `/account` panel |

**Changes to existing files (behaviour-preserving unless stated):**

- `cloud/src/entry.ts` — default export becomes `{ fetch, scheduled }` around the
  `OAuthProvider`; `GenerationWorkflow` export unchanged.
- `cloud/src/job-routes.ts` — extract `resumeJob`, `dismissJob`, `listAssets` out of
  the route bodies. Route paths, status codes and response shapes do not change.
- `cloud/src/spend.ts` — extract `spendTotals` and `listSpend`; call `settleCharge`
  after `recordAccountSpend` inserts a ledger row.
- `cloud/src/provider-billing.ts` — extract `readAccountBilling(env, owner)`.
- `cloud/src/jobs.ts` — `acceptJob` takes an optional `agentId` written to the new
  column; `jobView` adds an optional `startedBy`.
- `cloud/src/assets.ts` — `assetView` adds an optional `startedBy`.
- `cloud/src/media.ts`, `cloud/src/uploads.ts` — new token purpose `agent-upload`;
  `publicMedia` skips the `Origin` check for that purpose only.
- `cloud/src/ingress.ts` — export the bucket counter so the MCP path can charge
  per-agent buckets.
- `cloud/src/lifecycle.ts` — `deleteAccount` also revokes the account's OAuth grants
  (best effort; the D1 cascade is what actually refuses them).
- `cloud/src/index.ts` — `handleRequest` routes `/oauth/authorize`, `/oauth/finish`
  and the agent routes to `cloud/src/mcp/{auth,agents}.ts`; the cron adds two
  cleanups (expired pending authorizations, orphaned pending charges).
- `cloud/src/schema.ts` — `LOCAL_SCHEMA` catch-up for everything in `0013`.
- `cloud/wrangler.jsonc`, `cloud/wrangler.preview.jsonc` — `OAUTH_KV`, `IMAGES`,
  custom domain route.
- `cloud/package.json` — `@cloudflare/workers-oauth-provider`, `agents`, the MCP
  TypeScript SDK that release of `agents` pairs with, `zod`.
- `lib/account/contracts.ts` — optional `startedBy` on `CloudJobView` and
  `CloudAsset`, optional per the file's deploy-order convention.
- `lib/account/gateway.ts` — allowlist `agents(/<id>)?` and
  `agent-authorizations/<id>`.
- Job and asset card meta lines (`CloudJobCardGrid`, `CloudJobList`,
  `CloudAssetGrid`) — render "via <name>" when `startedBy` is present.
- `/account` page composition — mount `ConnectedAgentsPanel`.

**Must not modify** (importing and calling is fine): `cloud/src/provider-adapters/*`,
`cloud/src/workflow.ts` and `generation-runner.ts` behaviour, `validateRequest`'s
rules, `vault.ts` and `connections.ts` (`list_models` reads which providers are
connected through the existing `listConnections`, never a secret),
`lib/spend/rates.ts` values, the catalogs' model entries, `CLOUD_GENERATION_PROVIDERS`,
any guest/browser generation path, and the existing HTTP route contracts
(additive optional fields only).

## Architecture

```
MCP client ──Bearer──▶ OAuthProvider (cloud/src/entry.ts)
                        ├─ /mcp            → createMcpHandler(createServer(agent))
                        ├─ /oauth/register → library (DCR)
                        ├─ /oauth/token    → library (PKCE, refresh rotation)
                        ├─ /.well-known/*  → library (RFC 8414 / RFC 9728 metadata)
                        └─ everything else → handleRequest (unchanged, incl. /oauth/authorize, /oauth/finish)
```

- `apiRoute: '/mcp'`, `authorizeEndpoint: '/oauth/authorize'`,
  `tokenEndpoint: '/oauth/token'`, `clientRegistrationEndpoint: '/oauth/register'`.
  No existing route shares a prefix with these (`/api/account/*`, `/media/*`,
  `/health`).
- Because the library answers `/mcp` and `/oauth/{register,token}` before
  `handleRequest` runs, those paths never meet the `Origin === APP_ORIGIN` write
  check — correct, since they are called by agents, not the app.
- Access tokens carry encrypted props `{ userId, agentId }` and nothing else. The
  MCP handler loads the `account_agents` row on every request; a missing, revoked
  or ownerless row is a 401. That row, not KV, is the source of truth, so revoking
  is effective on the next call regardless of KV propagation.
- The transport is stateless Streamable HTTP. No Durable Object, no protocol
  session: every tool reads what it needs from D1/R2.

### One `generate` call

1. Library validates the Bearer token; handler loads the agent row, charges the
   agent's `writes` and `submissions` buckets.
2. `model-schema` check → field-level error if a value is outside the schema.
3. `validateRequest(env, request)` — the Worker's authority, unchanged.
4. References given as `{ assetId }` are copied into fresh `account_uploads` rows
   (reserve + R2 copy + `ready`), so they obey the same 24 h input lifecycle.
5. `estimateCloudJob(request)`.
6. `reserveCharge` — conditional insert (see Budget).
7. `acceptJob(env, owner, token, request, agentId)` where
   `token = base64url(sha256(agentId + ':' + idempotencyKey))` (43 chars, satisfies
   `^[a-zA-Z0-9_-]{16,128}$`), or a random token when no key is given. On failure,
   `releaseCharge` and rethrow.
8. `attachCharge(token, job.id)`; `dispatchJob` as the route does.
9. Return the job, the estimate and the budget.

From there the existing Workflow runs. `recordAccountSpend` → `settleCharge`
replaces the estimate with the ledger figure; a successful `cancel_job` →
`releaseCharge`.

## Tools

All tools return `structuredContent` plus a short text rendering. Read-only tools
carry `readOnlyHint: true`; `delete_asset` carries `destructiveHint: true`;
`generate`, `resume_job` carry `openWorldHint: true` (they reach a provider and can
cost money).

| Tool | Input | Output |
| --- | --- | --- |
| `list_models` | `mediaType?`, `inputMode?`, `provider?` | `models[]`: `provider`, `modelId`, `label`, `mediaType`, `modes`, `fields[]`, `price?`, `maxReferences?`, `sourceVideo?` (edit limits), `note?`. Only providers that are enabled **and** connected, and only modes the Worker accepts for that provider (e.g. no `edit`/`reference` for fal and Kie). |
| `estimate_cost` | a generate request | `costUsd` (number or null), `confidence` (`exact` / `estimated` / `unknown`), `note?`, `budget`, `allowed`, `refusal?` |
| `generate` | `provider`, `modelId`, `mediaType`, `inputMode`, `prompt`, `values?`, `references?: ({uploadId}\|{assetId})[]`, `sourceVideo?: {uploadId}\|{assetId}`, `idempotencyKey?` | `job`, `estimate`, `budget` |
| `get_job` | `jobId`, `waitSeconds?` (0–25) | `job` (state, failureReason, failureDetail, attempts); when saved, `outputs[]` (`assetId`, `kind`, `mimeType`, `bytes`, `downloadUrl`, `expiresAt`) plus a `resource_link` per output. The wait re-reads the row every 2 s and returns as soon as the state changes or the time is up. |
| `list_jobs` | `state?` — `active` (queued, submitting, running, saving — the same four `isActiveJob` uses), `needs_attention`, `finished` (saved, failed, cancelled) or `all` (default); `limit?` (≤100) | `jobs[]` |
| `cancel_job` | `jobId` | `job` — refuses `generation_started` exactly as today |
| `resume_job` | `jobId` | `job` — same refusals as the route (`unrecoverable`, `resume_exhausted`, `tracking_state_changed`) |
| `dismiss_job` | `jobId`, `remove?` | `job`, `removed` |
| `add_reference` | `{ url }` or `{ upload: { mimeType, bytes } }` | `uploadId`, `expiresAt`, and for `upload` a `putUrl` (15 min) the agent PUTs the file to with that exact `Content-Type` |
| `list_assets` | `kind?`, `temporaryOnly?`, `cursor?` | `assets[]` (with prompt, provider, model, `jobId`, `startedBy?`, `expiresAt?`), `nextCursor`, `counts` |
| `view_asset` | `assetId` | Image: an inline `image` content block — a WebP no larger than 1024 px on the long edge made with the Images binding — plus metadata. Video: metadata and a `resource_link` to a download URL. |
| `delete_asset` | `assetId` | `ok` — **registered only when the grant allows deleting** |
| `get_spend` | `entries?` (≤50), `balances?` | account `totals`, this agent's `budget`, recent `entries?`, provider `balances?` (Kie, Runware, Atlas, as the existing readout) |

### Field vocabulary (`lib/account/model-schema.ts`)

```ts
type ModelField = {
  key: string;                       // the key in CloudJobRequest.values
  type: 'select' | 'number' | 'boolean' | 'text';
  options?: { value: string | number; label: string }[];
  min?: number; max?: number; step?: number;
  default?: string | number | boolean;
  required?: boolean;
  modes?: CloudJobRequest['inputMode'][];   // absent = every mode
};
```

Kie and fal variants already describe fields this way and map directly. Aggregator
models map `duration` / `durations`, `sizes` and `supportsAudio` to the keys their
adapters already read from `values`. Gemini, Cloudflare and Pollinations expose the
fields their synchronous adapter narrows to per model (e.g. Gemini image size,
aspect ratio). The Worker's validators remain the authority; this module exists so
an agent is told *which* field is wrong instead of "Review the selected model and
generation settings".

### Server instructions

The server's `instructions` string tells an agent the intended loop —
`list_models` → `estimate_cost` → `generate` (with an `idempotencyKey`) →
`get_job` with `waitSeconds` → `view_asset` — that results are saved to the
person's library, that `budget_exceeded` includes when room frees up, and that
download URLs are short-lived and should not be shared.

## Authorization and consent

1. Client calls `/mcp`, gets 401 with `WWW-Authenticate` pointing at the
   protected-resource metadata; discovers, registers (DCR), opens the browser at
   `/oauth/authorize`.
2. `/oauth/authorize` (in `handleRequest`): `parseAuthRequest`, `lookupClient`,
   insert an `account_agent_authorizations` row (10 min), set the binding cookie
   `__Host-sa_agent_auth` on the MCP origin (`sa_agent_auth` locally, following
   `cookieName`), redirect to `APP_ORIGIN/connect-agent?request=<id>`.
3. `/connect-agent` (Next): if signed out, send to `/sign-in` with a return path
   back. Otherwise `GET /api/account/agent-authorizations/<id>` and show:
   - the client's self-reported name, labelled **unverified**, and the host it
     will redirect to;
   - what it will be able to do, in plain words;
   - **Spend limit per 24 hours**, default $5, allowed $0.50–$500;
   - **Allow models without a published price** (off) — copy: "These don't count
     toward the limit unless the provider reports what they cost.", followed by
     the connected providers it applies to (e.g. "Affects: Runware image
     models"), computed from the same schema `list_models` uses;
   - **Allow deleting files from your library** (off);
   - Approve / Deny.
4. `POST /api/account/agent-authorizations/<id>` through the gateway (session
   cookie + `Origin` check, as every write) records `decision`, `user_id` and
   settings on the row and returns `{ redirectTo: <MCP origin>/oauth/finish?request=<id> }`.
5. `/oauth/finish`: require the binding cookie to hash-match the row; consume the
   row with `DELETE … RETURNING` (the Google callback's pattern); on approve insert
   the `account_agents` row, call `completeAuthorization({ request, userId,
   scope, props: { userId, agentId }, metadata: { agentId, clientName } })` and
   redirect to what it returns; on deny redirect to the client's registered
   `redirect_uri` with `error=access_denied` and its `state`. A missing or
   mismatched cookie renders "Finish connecting in the browser that opened this
   page" and does nothing.

The binding cookie is what stops consent phishing: a link to a pending request an
attacker's client started cannot be completed from the victim's browser, because
that browser never received the cookie.

Tokens: access 1 hour, refresh 30 days with rotation. Consent is shown on every
authorization; there is no "remember this client".

### Managing agents

- `GET /api/account/agents` → `{ mcpUrl, agents[] }` with name, connected date, last
  used, 24 h usage vs limit, toggles, revoked flag.
- `POST /api/account/agents/<id>` → update limit and toggles.
- `DELETE /api/account/agents/<id>` → set `revoked_at`, then revoke the grant in KV
  (best effort). The row stays so "via <name>" keeps resolving on old jobs.

(POST, not PATCH, because the gateway route exports only GET, POST and DELETE.)

## Budget

Amounts are integer micro-dollars in D1.

- **Window:** rolling 24 hours.
- **Charged amount** of an agent in the window:
  `SUM(CASE WHEN released=1 THEN 0 ELSE COALESCE(actual_micros, estimate_micros, 0) END)`
  over charges with `at > now - 24h`.
- **`reserveCharge`** is one conditional `INSERT … SELECT … WHERE charged + estimate
  <= limit`, keyed by the `acceptJob` token. D1 serialises writes, and each pending
  reservation counts toward the next, so two concurrent calls cannot both fit
  under the limit. An `INSERT OR IGNORE` on the same token (a retried
  `idempotencyKey`) is a no-op that reports the existing charge.
- **`releaseCharge`** only when the provider certainly never ran the job: acceptance
  failed, or `cancelQueuedJob` succeeded (it only cancels `queued` with no
  `provider_task`). Every other failure keeps its estimate, because the vendor may
  have billed it.
- **`settleCharge`** writes `actual_micros` from the ledger entry when its
  confidence is not `unknown`.
- **Unknown estimate:** refused with `cost_unknown` unless the grant allows it; then
  booked at 0 and counted at its actual once known.
- **Refusal:** `budget_exceeded` with `estimateUsd`, `limitUsd`, `usedUsd`,
  `remainingUsd` and `roomAt` — the earliest time enough charges leave the window
  for this estimate to fit.
- **An estimate comes from a published rate or it is `unknown` — never a guess.**
  Where the ledger prices a job from a published rate (a catalog `rate`, the fal
  catalog, `GEMINI_*_RATES`, free engines), `estimateCloudJob` calls the same
  resolver `buildAccountSpendEntry` uses, with the expected output count, so the
  two agree exactly. Where the ledger uses the cost the provider reports after
  the run (Runware image models, which carry display `price` strings but no
  `rate`), the estimate is `unknown`: parsing a display string would be exactly
  the invented number `lib/spend/rates.ts` exists to prevent. **Consequence:**
  with the default grant, Runware image models are refused with `cost_unknown`
  until the person allows unknown prices. The consent screen names the connected
  providers this affects. Adding cited `rate` entries for those models later
  moves them to `estimated` with no change here.

## Data model (`0013_agents.sql`)

```sql
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
  consent_handle TEXT NOT NULL,       -- follow-up decision 2
  description_json TEXT NOT NULL,     -- describeConsent() output
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_host TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('approved','denied')),
  user_id TEXT REFERENCES account_users(id) ON DELETE CASCADE,
  settings_json TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_agent_charges (
  id TEXT PRIMARY KEY,                -- the acceptJob token
  agent_id TEXT NOT NULL REFERENCES account_agents(id) ON DELETE CASCADE,
  job_id TEXT,                        -- null until acceptJob returns
  estimate_micros INTEGER,            -- null when unknown
  actual_micros INTEGER,
  confidence TEXT NOT NULL,
  released INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_agent_charges_window ON account_agent_charges(agent_id, at);
CREATE INDEX IF NOT EXISTS account_agent_charges_job ON account_agent_charges(job_id);

ALTER TABLE account_jobs ADD COLUMN agent_id TEXT;   -- no FK: jobs outlive agents
```

Every statement is mirrored in `LOCAL_SCHEMA`, because `CREATE TABLE IF NOT
EXISTS` is a no-op on an existing local database and a missing column only shows
up as a runtime error.

## Errors, limits and security

- **Error shape.** Refusals are tool results with `isError: true` and
  `structuredContent: { code, message, retryable, retryAfterSeconds?, ... }` — not
  JSON-RPC errors, so the model reads them. Existing `AccountError` codes pass
  through unchanged (`invalid_settings`, `connection_required`, `input_capacity`,
  `active_jobs`, `temporary_results`, `reference_unavailable`, `generation_started`,
  `unrecoverable`, `resume_exhausted`, …). New codes: `invalid_field` (with
  `field` and `allowed`), `budget_exceeded`, `cost_unknown`, `rate_limited`,
  `reference_fetch_failed`. `retryable` follows the same status logic as
  `isRetryableFailure`. The shared wrapper returns a fixed sentence for anything
  that is not an `AccountError`, keeping the Worker's rule of never serialising a
  raw error (vendor payloads can carry credentials). Protocol-level 401 is reserved
  for bad, revoked or orphaned tokens.
- **Rate limits** in `account_ingress_limits`, per agent: 300 reads, 60 writes and
  10 submissions per minute (`agent:<id>:reads|writes|submissions`). `/oauth/register`
  is limited to 20 per minute per client IP. Account-wide caps are unchanged and
  shared with the browser.
- **Body limit** on `/mcp`: 64 KB, read with the same bounded reader `ingress.ts`
  uses rather than trusting `Content-Length`.
- **`add_reference` URL fetch:** `https:` only; the host must not be the app, the
  Worker, the MCP domain or a `workers.dev` name of this account (so a `/media/`
  capability cannot be laundered through it); redirects followed manually, at most
  3, each hop re-checked; no cookies or auth headers; 20 s timeout; streamed with a
  byte cap (20 MB image, 100 MB video, the existing limits); type decided by magic
  bytes (PNG, JPEG, WebP, AVIF, MP4/MOV, WebM), never by the response header.
- **Agent uploads:** purpose `agent-upload`, 15 min, same size and type checks as
  `upload`. Only this purpose skips the `Origin` check — the token is the
  capability, and a shell PUT has no origin to send. Browser `upload` tokens are
  unchanged.
- **Grant-shaped tool list:** a grant without delete never registers
  `delete_asset`.
- **Logs:** never the `Authorization` header or token props. Invocation logs stay
  disabled.
- **Untrusted text:** tool results contain the person's prompts and provider
  failure text; the latter is already sanitised by `sanitizeProviderMessage` when
  stored. Nothing in a result is executed or followed by the Worker.
- **Cleanup** (existing 5-minute cron): delete expired
  `account_agent_authorizations`; delete charges with `job_id IS NULL` older than
  10 minutes (an `acceptJob` that crashed between reserve and attach).

## Testing

Vitest in `cloud/tests` with the existing `node:sqlite` D1 shim and R2 fake, plus a
Map-backed KV fake. Tool handlers are called directly as functions; the
Streamable HTTP layer is covered by the local smoke test, not unit tests.

- **Schema drift guard:** every `(model, mode)` `list_models` advertises, with its
  schema defaults, passes `validateRequest` (with `DEV_FAKE_GENERATION` off and
  every provider enabled).
- **Estimate vs ledger:** for every model the ledger prices from a published rate,
  `estimateCloudJob(request)` equals `buildAccountSpendEntry`'s figure for the
  same request and a synthetic result of the expected output count; every model
  the ledger prices from a provider-reported cost comes back `unknown`. The test
  iterates the catalogs, so a model added later is covered without editing it.
- **Budget:** concurrent reservations cannot exceed the limit; the same
  `idempotencyKey` twice yields one job and one charge; a different request under
  the same key is `token_conflict`; cancel-while-queued releases; settle replaces;
  charges leave the window; the unknown-price toggle; `roomAt` is correct.
- **Authorization:** decision requires session and `Origin`; `/oauth/finish`
  requires the binding cookie, is single-use and expires; deny redirects with
  `access_denied`; a revoked agent, and an agent of a deleted account, get 401.
- **Tools:** `delete_asset` absent without the grant; `connection_required` for an
  unconnected provider; the URL guard (scheme, own hosts, redirect re-check, magic
  bytes, byte cap) against a stubbed `fetch`; every tool has a description and the
  right hint annotations; `get_job` wait returns early on a state change.
- **Refactor safety:** existing job, spend and billing route tests pass unchanged
  after the extractions.
- **App:** testing-library tests for the consent page (limit validation, the
  unverified label, Deny) and `ConnectedAgentsPanel`.

## Local development

- `npm run dev` with `DEV_FAKE_GENERATION=1` and `DEV_ACCOUNT_EMAIL` runs the full
  loop without credentials: local sign-in, consent, `generate` (fake image, on a
  model with a published rate so a charge is booked),
  `get_job` with wait, `view_asset`, `get_spend`, and a budget refusal after
  setting the limit to $0.50 with a charge booked.
- `wrangler dev --local` emulates KV. Whether the Images binding works locally is
  verified first (see below); if not, `view_asset` returns a link when the binding
  is absent.
- Connect with `npx @modelcontextprotocol/inspector` or
  `claude mcp add --transport http scene-assembly-local http://localhost:8797/mcp`.
- The local fixture only produces images; video paths are covered by unit tests
  with stubbed adapters.

## Verify before building on it

These are the facts this design relies on that were read from docs, not run. The
first plan task checks each, and a failure is a dated follow-up decision here:

1. `workers-oauth-provider` + `createMcpHandler` run under the pinned Wrangler
   4.113 / `compatibility_date` 2026-07-20 in `--local` mode.
2. The `OAuthProvider` fetch can be wrapped in `{ fetch, scheduled }` without
   losing the injected `env.OAUTH_PROVIDER` helpers in `defaultHandler`.
3. How props reach a `createMcpHandler` tool, and whether `completeAuthorization`
   exposes the grant id (if not, revoke looks it up with `listUserGrants` by
   `metadata.agentId`).
4. The Images binding's local support.

## Rollout

1. Create the `OAUTH_KV` namespace, the custom domain and apply `0013` remotely by
   hand — the deploy workflow stops rather than apply a pending migration
   (`docs/deployment.md`).
2. Worker deploys (push to `main` touching `cloud/**` or `lib/**`).
3. App deploys. Until it does, `/oauth/authorize` redirects to a page that does not
   exist yet; harmless, because the MCP URL is only published in the panel that
   ships with the app.
4. Live check before announcing, from Claude Code against production, covering
   both pricing paths: one cheap image on a model with a published rate — confirm
   the charge is booked at the estimate and settles to the same ledger figure;
   then, with unknown prices allowed, one Runware Z-Image Turbo image (~$0.003) —
   confirm it is booked at $0 and settles to Runware's reported cost. Then connect
   Claude.ai as a custom connector and repeat the first.
5. Docs: an AGENTS.md routing entry ("Agent MCP / connected agents → read this spec
   first") and a "Connect an agent" section in the README.

The consent page and the panel are user-visible UI, so their PR carries inline
screenshots per AGENTS.md.
