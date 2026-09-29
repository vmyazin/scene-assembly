# Deployment

The live app runs on **Vercel** at <https://sceneassembly.mzork.com>. Pushes to
`main` on `github.com/vmyazin/scene-assembly` deploy automatically through
Vercel's Git integration; there is no deploy script to run by hand.

The account Worker deploys automatically too, since 2026-09-09 — see
[Deploying the account Worker](#deploying-the-account-worker). It used to be a
manual step, and the gap between the two halves broke production twice.

It previously ran on a single VPS behind nginx, under pm2, redeployed by a
systemd timer polling `origin/main` every minute. That path is kept — see
[Self-hosting](#self-hosting-the-former-vps-path) — but it is no longer the one
serving the site.

## Environment variables

Set on the Vercel project (Production + Preview), not in the repo:

| Variable | Required | Notes |
| --- | --- | --- |
| `HF_TOKEN` | no | Server-side, app-owned. Enables the shared micro-AI tier for download filenames and example prompts. Unset and those fall back to the user's Gemini key, then to a regex slugifier. |
| `HF_BASE_URL` | no | Overrides the OpenAI-compatible endpoint the micro-AI tier calls. |
| `AUTH_ADMIN_EMAIL` | **must stay unset** | See [The auth gate](#the-auth-gate-off-on-vercel) — the account store cannot survive on serverless as written. |
| `TIMELINE_FFMPEG_PATH` | **must stay unset** | See [Server-side export](#server-side-export-off-on-vercel). |
| `ACCOUNT_WORKER_ORIGIN` | yes for accounts | Production is configured with `https://scene-assembly-accounts.vasily-or-simon-account.workers.dev`. Preview uses its isolated Worker. Guest routes keep working if this variable is absent. |

Guest Gemini, fal, Kie, and Cloudflare credentials are supplied by each visitor
and kept in browser storage. Active guest requests may proxy a credential
through a Next.js provider route, but the route does not persist it. The
optional account Worker instead stores credentials encrypted; its variables and
secrets are documented below.

## Server-side export (off on Vercel)

`POST /api/timeline/render` 404s unless `TIMELINE_FFMPEG_PATH` names an ffmpeg
binary, and on Vercel it stays unset. Exports run entirely in the browser on the
WebCodecs engine, which the export panel already prefers; when the browser
engine can't handle a timeline, the panel reports *"No server render is
configured"* instead of offering a fallback. Nothing is broken by this — the
degradation was designed in — but timelines that WebCodecs rejects (unsupported
codecs, browsers without `VideoEncoder`) have no second path on Vercel.

The route cannot simply be switched on there. Its design assumes one long-lived
process:

- the job registry (`lib/timeline/jobs.ts`) is in-memory, so the POST that
  creates a job, the GET that polls it, and the GET that downloads its output
  must all land on the same instance — serverless gives no such guarantee;
- inputs and outputs live under `os.tmpdir()`, which is per-invocation;
- `spawn('ffmpeg')` needs a binary that isn't in the runtime image.

### Follow-up: make the render engine portable

Worth doing if browser-only export proves too narrow. The shape that runs both
on Vercel and on a box:

1. **Ship the binary.** Depend on a static ffmpeg build (`ffmpeg-static` or
   similar) and resolve `TIMELINE_FFMPEG_PATH` to it when the env var is unset,
   so the "which binary am I spending CPU on" property that motivated the
   explicit path is preserved — it just gains a default.
2. **Collapse the lifecycle into one request.** Upload → render → respond with
   the file, inside the 300 s function limit, dropping the poll/download round
   trips and with them the cross-request state. A few short clips fit; long
   timelines don't, which is the real bound on this approach.
3. **Or externalize the state** if step 2's ceiling is too low: job rows in a
   hosted DB, inputs and outputs in Vercel Blob, and a function that picks up
   where the last invocation left off. More moving parts, no wall-clock limit.
4. Keep `lib/timeline/render/port.ts` as the seam either way — both engines
   already implement `RenderEngine`, so nothing in the export panel changes.

## The auth gate (off on Vercel)

`AUTH_ADMIN_EMAIL` turns on the gate over `/api/fetch-image` and
`/api/timeline/render`. It must stay unset here: the account store is SQLite via
`node:sqlite` writing to a local file (`lib/auth/db.ts`), and a serverless
filesystem is per-instance and ephemeral — accounts and sessions would vanish
between invocations and differ between concurrent instances. The dedicated
`/sign-in` and `/sign-up` pages belong to the separate optional Cloudflare
account service. They do not supply sessions for this legacy gate, so setting
`AUTH_ADMIN_EMAIL` on Vercel would still lock its protected routes.

Enabling the legacy gate on Vercel still requires moving `lib/auth/db.ts` to a
hosted database and integrating its own session path. Until then the app is
open, exactly as the unset default intends.

## Uploads

`/api/fal/upload`, `/api/kie/upload`, and `/api/timeline/render` take multipart
bodies. Consult Vercel's current
[Functions limits](https://vercel.com/docs/functions/limitations) before
changing these paths; the current documented Function request/response payload
limit is 4.5 MB, smaller than the app's own `MAX_UPLOAD_BYTES` ceiling of 512 MiB in
`app/api/timeline/render/route.ts`. That mismatch is inert while server render
is off, but it is the first thing to reconcile if the follow-up above happens —
the platform will reject the request long before the route's own check runs.
(The equivalent trap on the VPS was nginx's 1 MB `client_max_body_size` default;
same failure, different ceiling.)

Account uploads and downloads avoid this path. The Next gateway carries only
bounded JSON metadata; short-lived capabilities transfer file bytes directly to
the private R2-bound Worker.

## Optional Cloudflare account service (not launched)

The account implementation uses a Cloudflare Worker, D1, a private R2 bucket,
and a `GenerationWorkflow` binding. It provides Google-first `/sign-in` and
`/sign-up` entry pages, a signed-in `/account` dashboard, encrypted account connections, durable background jobs, explicit
browser-asset/key imports, a fixed 1 GB permanent library, and a separate
account spend ledger. Guest use remains available and there are no new global
account calls to action.

The code supports fal, Kie, Runware, Atlas, Comet, Gemini, Cloudflare, and
Pollinations background adapters. Production support is deliberately opt-in via
`CLOUD_GENERATION_PROVIDERS`; its default is empty. Do not enable an adapter
until a real credentialed submission, reconciliation, capture, download, and
cost-label check has passed in the target environment. No real vendor request or full authenticated production web flow has been
verified. The account Worker, database, private bucket, Workflow, and production
OAuth client are configured as recorded below; the web app is not connected yet.

### Isolated account preview — verified 2026-09-05

- Web: <https://scene-assembly-ohuguqu4p-mzork.vercel.app/account> (Vercel preview,
  READY, source `d8d8414`, existing `scene-assembly` project).
- Worker: `scene-assembly-accounts-preview` at
  `https://scene-assembly-accounts-preview.vasily-or-simon-account.workers.dev`.
- D1: `scene-assembly-accounts-preview`,
  `f3499f84-01b0-49ec-bdf3-9d0378d189f8`, migrations 0001–0011.
- R2: `scene-assembly-assets-preview`, private Standard storage, with one-day
  incomplete multipart cleanup and no completed-object expiry.
- Workflow: `scene-assembly-generation-preview`, class `GenerationWorkflow`.
- Google client: **Scene Assembly — Account preview**, with the exact web
  preview callback `/api/account/callback/google`; External / Testing audience.

The preview deployment has only its own `ACCOUNT_WORKER_ORIGIN` override; no
production Vercel environment variable or alias was changed. Its resources and
secrets are separate from production. Preview credential recovery copy:
`~/.config/scene-assembly/preview-worker-secrets.json`, permissions `0600`,
outside Git. Do not copy local dev identity/fake-generation values into it.

Use `--config wrangler.preview.jsonc` for preview Worker operations. The config
pins the current web preview origin. A newly generated Vercel URL requires both
that origin and the Google client's exact callback to be updated; do not promote
this preview directly to production while it still points to preview resources.

Verified real Google sign-in, avatar, reload persistence, sign-out, and returning
sign-in through the Vercel gateway. Private storage verification is reproducible:

```bash
node scripts/verify-account-preview.mjs
```

The script hard-pins preview resources, creates two short-lived fixture accounts
using administrator D1 access, then exercises authenticated Worker APIs with a
68-byte PNG. It verifies direct references, import replay, exact-byte/private
and ranged downloads, cross-account denial and deletion revocation, and removes
its fixture accounts/files. This separately verifies storage; it is not a
substitute for the browser's real Google OAuth check or vendor generation.
After the run, D1 reports one Google account, zero fixture accounts/assets and
zero queued object deletions. Native provider execution remains disabled, so
paid generation, durable provider completion and backup restoration remain
launch acceptance work.

### Deploying the account Worker

`.github/workflows/deploy-account-worker.yml` deploys it on every push to `main`
that touches `cloud/**`, `lib/**`, or the workflow itself, and can also be run
on demand from the Actions tab. The pipeline is: Worker tests, typecheck, a
guard that **reports** unapplied D1 migrations rather than applying them, then
`wrangler deploy`, then a `/health` check.

Two things about it are not incidental:

- **`lib/**` has to be in the path filter.** The Worker bundle imports around
  nineteen modules from `lib/` — provider catalogs, engines, spend resolvers,
  account contracts — so a change there can alter what the deployed Worker
  accepts while touching nothing under `cloud/`. List them with
  `rg -o "from '(\.\./)+lib/[^']+'" cloud/src`.
- **Migrations are never applied unattended.** The Worker queries the current
  schema on its first request, so a migration must land first; applying one to
  the production database is also the single step here that redeploying cannot
  undo. A pending migration fails the run and waits for a person:
  `pnpm --dir cloud exec wrangler d1 migrations apply scene-assembly-accounts --remote`.

It needs one repository secret, `CLOUDFLARE_API_TOKEN`, with Workers
Scripts:Edit, D1:Edit and Workflows:Edit on the Rapid Systems account. The
account id is not a secret and is pinned in both `cloud/wrangler.jsonc` and the
workflow, so a token that can see several accounts cannot misdeliver the deploy.
To roll back, deploy an earlier version from the Cloudflare dashboard or
`wrangler rollback`; the workflow only ever ships the current `main`.

### Worker redeploy — 2026-09-06 library filters and spend totals

*Historical: this is the failure that motivated the automation above; the Worker
deployed by hand at the time.* Anything the browser reads from a *new* Worker
field disappears silently in production until the Worker is redeployed: the response
still parses, the field is just absent, so the UI takes its empty branch instead
of erroring. That is what happened here — production ran version
`2bfca5fe` (built before `ffb1e42`), so `/api/account/assets` returned no
`counts` and `LibraryFilters` rendered nothing, while `/api/account/spend/totals`
404'd and the rail read "Unavailable". Both features looked correct locally,
where `wrangler dev` serves the working tree.

Redeployed `scene-assembly-accounts` from `ef341d6`; live version
`984eafa3-0c46-4562-bc04-3e17baf0be3b` at 100%. Code-only — no migration (the
schema was already at 0011), no secret, `vars`, binding, or provider-list change.
Verified `/health` 200 and both routes answering 401 rather than 404 for an
unauthenticated caller.

**When a UI element is present locally and missing in production, compare the
Worker's deployed timestamp against the commit that added the field it reads
before looking at the component.** `npx wrangler deployments list` in `cloud/`
gives the former; `git log -S<field>` gives the latter.

### Worker skew — 2026-09-09 Gemini Flash background jobs

The same failure, one shape further on: the picker offered Gemini 3.1 Flash
Image and Flash Lite Image, and every background job on them came back
*"Review the selected model and image settings."* That string exists only in
`validateSynchronousRequest`, so the browser half was fine and the deployed
Worker — six hours older than the commit — was rejecting model ids it had never
heard of. Note that the change touching the Worker's behaviour lived entirely in
`lib/engines/gemini-catalog.ts`, with nothing under `cloud/` in that commit;
that is why the workflow's path filter watches `lib/**`.

### Follow-up — 2026-09-05 approved account backend deployment

The user approved the account page in response to the request to deploy the
account Worker and Workflow. This satisfies the localhost review gate for this
backend deployment; it does not record a completed production web rollout.

Deployed `scene-assembly-accounts` in Rapid Systems with D1, private R2,
`scene-assembly-generation` / `GenerationWorkflow`, and the five-minute cron.
Worker origin:
`https://scene-assembly-accounts.vasily-or-simon-account.workers.dev`.
Configured that origin as `PUBLIC_WORKER_ORIGIN`; `APP_ORIGIN` remains
`https://sceneassembly.mzork.com`. Latest deployed version:
`dbb80be7-4a99-4c65-a167-159bad87e291`.

Created a separate **Scene Assembly — Production** Google Web application
client under the selected Google identity, with only
`https://sceneassembly.mzork.com/api/account/callback/google` authorized.
The consent audience remains External / Testing. Stored the Google client
credentials and independent production encryption keys as four Worker secrets:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ACCOUNT_ENCRYPTION_KEYS`, and
`ACCOUNT_ENCRYPTION_VERSION`. A recovery copy is held outside Git at
`~/.config/scene-assembly/production-worker-secrets.json`, permissions `0600`.
Never print or commit this file; preserve the encryption keys for recovery.
Local `.dev.vars` and its credentials were not changed.

Verified the deployed health and session endpoints, disabled local sign-in,
empty enabled-provider list, cross-origin OAuth rejection, the exact production
OAuth client/callback and identity scopes, PKCE, and Secure/HttpOnly/SameSite
OAuth cookies. Wrangler confirms the Workflow registration and all four secret
names. No real provider call or authenticated production account was created.

Still required: connect an isolated web preview and verify full OAuth callback,
private upload/download and background completion; finish public consent
branding/publishing; verify native providers and backup recovery; then connect
the production web app. No Git push or web app deployment was performed.

### Local OAuth setup verified — 2026-09-05

The `scene-assembly-accounts` Google project now has a dedicated local Web
application client, with only
`http://localhost:3097/api/account/callback/google` authorized. Real Google
consent, callback, session persistence, sign-out, and returning sign-in passed
against the local account service. The audience remains External / Testing.
See [local account development](codex/account-development.md#real-google-sign-in-for-local-development)
for the credential location and exact boundaries. Production OAuth configuration
and consent branding are still pending; do not reuse the local client as an
implicit production configuration.

### Cloudflare resource setup — 2026-09-05

The user resumed setup through the Cloudflare browser open on **Rapid Systems**.
Created the dedicated resources in account `7f64edc36bdefec27b66e6ff9b2dcc3d`:

| Resource | Configuration |
| --- | --- |
| D1 `scene-assembly-accounts` | ID `a5146fdd-41c6-47d3-adff-8c7aeddc3071`; all 11 migrations applied; zero account rows |
| R2 `scene-assembly-assets` | Standard storage, Eastern North America, public development URL disabled, no custom domain |
| Multipart lifecycle | Enabled for all prefixes; abort incomplete uploads after one day; no completed-object expiry |

`cloud/wrangler.jsonc` now pins this account and database ID. Its
`preview_database_id` retains the original local-only identity so development
sessions, encrypted connections, and local assets remain reachable. It is not a
remote preview database; provision a separate database for a remote preview.
Do not run remote preview commands using that local-only ID.

Verification: remote migration count is 11, the avatar column exists, and the
new database contains no accounts. Wrangler independently confirmed the one-day
multipart lifecycle and disabled r2.dev access. Worker dry-run bundles all three
bindings successfully. A browser reload preserved the existing local Google
account. No existing resources, billing settings, application deployment, or
production user data were changed.

The Worker and `GenerationWorkflow` are configured but not published. Production
Google OAuth, Worker origin and secrets (including independent production
encryption keys), preview integration, provider acceptance, and backup/restore
verification remain pending. The next deployment requires the repository's
localhost review/sign-off; no push or deployment was performed in this step.

### Production runbook

The person performing setup needs Cloudflare, Google Cloud, Vercel, and provider
credentials, and may need to accept billing. Never put secret values in tracked
files.

1. The dedicated D1 database and R2 bucket above are already created and
   recorded in `cloud/wrangler.jsonc`. For another environment, provision separate
   resources and update its explicit IDs. Keep the binding names exactly `DB`, `ASSETS`, and
   `GENERATION`; the Workflow class is `GenerationWorkflow`. The R2 bucket must
   remain private.
2. Configure the Worker variables `APP_ORIGIN=<target app HTTPS origin>`
   and `PUBLIC_WORKER_ORIGIN=<worker HTTPS origin>`. Keep the checked-in cron and
   the Workflow binding; production reconciliation runs every five minutes.
   The config disables invocation logs because media
   capabilities live in private URL paths.
3. Configure Worker secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `ACCOUNT_ENCRYPTION_KEYS`, and `ACCOUNT_ENCRYPTION_VERSION`. The encryption
   key map is JSON from version strings to base64-encoded 32-byte AES keys; keep
   old versions during rotation.
4. Create a Google OAuth Web application and authorize
   `https://sceneassembly.mzork.com/api/account/callback/google`. Request only
   `openid`, `email`, and `profile`, and complete the consent-screen requirements.
5. Apply every checked-in migration (`0001` through `0011`) in order **before**
   deploying the Worker, because the Worker immediately queries the current schema:

   ```bash
   pnpm --dir cloud exec wrangler d1 migrations apply scene-assembly-accounts --remote
   pnpm --dir cloud exec wrangler deploy
   ```

6. First verify through an isolated preview app connected with
   `ACCOUNT_WORKER_ORIGIN`, using that preview's exact `APP_ORIGIN` and Google
   callback in a separate environment. OAuth needs this working app gateway;
   Worker health alone cannot verify login. Check real Google sign-in, private
   direct upload/download, range download, and one provider at a time. Add only the verified provider
   names to `CLOUD_GENERATION_PROVIDERS`; the all-provider value is
   `fal,kie,runware,atlas,comet,gemini,cloudflare,pollinations`, but it is not a
   launch default.
7. After verification, apply the tested configuration to the production
   resources with `APP_ORIGIN=https://sceneassembly.mzork.com` and the production
   callback. Set production Vercel `ACCOUNT_WORKER_ORIGIN` to the healthy Worker
   origin, redeploy the web app, and repeat the login/download smoke check.
   `PUBLIC_WORKER_ORIGIN` belongs to the Worker;
   `ACCOUNT_WORKER_ORIGIN` belongs to Vercel.

Get explicit user review and localhost sign-off before pushing. A push to
`main` deploys the web app automatically.

### Capacity, recovery, and lifecycle setup

The 1 GB permanent quota is fixed. Intake currently reserves 64 MB for an image
job and 256 MB for a video job; these are placeholders that need measurements
from real provider outputs before launch. The 20 MB reference-file, 12 MB inline
reference, 24 MB inline response, 1 GB job-output/import, concurrency, and rate
limits are application safety bounds rather than verified model entitlements.
New intake is blocked while that account has a retained temporary overflow, and
the global 100-job bound counts retained temporary results after their active
job slots are released. Replays of already accepted jobs remain available;
permanent assets are never evicted. Record measured payloads and provider and
platform limits in the deployment plan before enabling each adapter.

[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
retains 7 days on Workers Free and 30 days on Workers Paid. It restores D1 only;
it cannot restore R2 media. Before launch, define a coordinated D1-and-R2 backup
procedure and complete a restore exercise. Configure an
[R2 object lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
to abort incomplete multipart uploads after one day. Do not add a blanket asset
expiry rule: permanent account assets must remain until the user deletes them.

## Agent MCP rollout

Connecting agents over MCP
([`docs/claude/specs/2026-09-28-agent-mcp-design.md`](claude/specs/2026-09-28-agent-mcp-design.md))
needs its own namespace, migration, and domain step, beyond the Worker deploy above:

1. Both namespaces were created on 2026-09-28; their ids are already in
   `cloud/wrangler.jsonc` (production `OAUTH_KV`) and `cloud/wrangler.preview.jsonc` (preview
   `OAUTH_KV`). Nothing to do here on a normal rollout. If a namespace ever has to be recreated,
   run `pnpm --dir cloud exec wrangler kv namespace create OAUTH_KV` (production) or
   `pnpm --dir cloud exec wrangler kv namespace create OAUTH_KV_PREVIEW` (preview) and put the new
   id in the matching wrangler file.
2. `pnpm --dir cloud exec wrangler d1 migrations apply scene-assembly-accounts --remote`, which
   applies `0013_agents.sql`. The deploy workflow stops on a pending migration rather than
   applying it.
3. Confirm `mcp-sceneassembly.mzork.com` is attached as a custom domain on the Worker, or skip
   this step when `MCP_ORIGIN` is the workers.dev hostname.
4. Merge; the Worker deploys, then the app. Between the two, `/oauth/authorize` redirects to a
   page that is not there yet, which is harmless because the MCP URL is only published by the
   panel that ships with the app.
5. The live check from the spec's Rollout step 4.

## Self-hosting (the former VPS path)

`scripts/deploy-production.sh` plus the units in `deploy/systemd/` still
describe a working single-box deployment: git fast-forward from `origin/main`,
`pnpm install --frozen-lockfile`, `pnpm build`, `pm2 restart`, health check on
`http://127.0.0.1:3020/`. That path is the one where `TIMELINE_FFMPEG_PATH` and
`AUTH_ADMIN_EMAIL` are worth setting, since it has both a persistent filesystem
and a single long-lived process. Raise nginx's `client_max_body_size` there or
every real clip upload 413s.
