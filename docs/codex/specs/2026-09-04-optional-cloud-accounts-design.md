# Optional accounts and durable cloud generation

## Follow-up (2026-11) — one identity control in the studio header

The "no new account calls to action in the existing layout" rule below is narrowed to account *promotion*: no sign-up banners, upsell copy, or account prompts inside workspaces. The studio header carries exactly one identity control at its right edge: for signed-in users an account menu (Account, Spend, Connections, Connected agents, MCP docs, Interface sounds, Sign out); for guests a quiet, secondary "Sign in" link that is never styled as a primary button. Signing out from that menu leaves the person on the page as a guest; signing out on `/account` still goes to `/sign-in`.

## Follow-up decision — 2026-09-05 dedicated account dashboard

The user requested `/account` for signed-in account data. This supersedes placing the signed-in management panels on `/sign-in` and `/sign-up`: those remain authentication entry pages and route authenticated users to `/account`. The new page owns identity, sign-out, library/storage/jobs, saved connections, explicit imports, and account deletion by composing existing shared components. Guests resolve to `/sign-in`; loading or service-unavailable states must not be mistaken for guests. Successful sign-in returns to `/account`. No new studio/global account calls to action are authorized by this change.

The user also requested less yellow glow. Reduce the shared account surface bloom while retaining readable borders, cyan primary actions, and the existing reduced-motion-aware entrance.

## Follow-up decision — 2026-09-04

The user approved the implementation plan, selected sign-in/sign-up as the first milestone, then authorized implementation of all steps and incremental commits. This overrides the original task order and the earlier no-commit condition. Account access must live on dedicated /sign-in and /sign-up pages with no new account calls to action in the existing layout; this supersedes guest promotional messaging in the studio. Shipping still requires localhost review and explicit sign-off.


Status: Approved design
Date: 2026-09-04

## Context

The product must remain functional without creating an account. The user approved Google sign-in first, explicit cloud credential saving, automatic saving of generated assets, durable queued/in-progress jobs across navigation and browser closure, and a free 1 GB account library. Paid plans are a future direction. Browser-assisted Google and Cloudflare configuration is requested for the setup stage; no cloud resources have been created.

Today the Next.js app runs on Vercel. Credentials are persisted by store/useAppStore.ts in browser storage. Gallery metadata and bytes live in IndexedDB through GalleryStorage; video records can lack bytes. Existing lib/auth code is a disabled SQLite/admin-approval gate, not a public account implementation.

## Goals

- Preserve guest generation and downloads without registration.
- Give signed-in users cross-device connections, job status, and saved media.
- Continue accepted jobs after navigation, sign-out, or tab closure.
- Automatically save actual output bytes to private R2, with truthful status.
- Bound free storage and allow future plan-specific limits without implementing billing.
- Run locally with emulated backing services and deterministic fake providers.

## Non-goals

Billing, email/password sign-in, teams, public sharing, timeline/project sync, prompt-library sync, end-to-end encryption, migrating app hosting, server-side timeline rendering, and transferring already-running guest jobs are excluded. Per-asset autosave opt-out was suggested but not adopted as a requirement.

## Scope and implementation boundary

New cloud capabilities belong in cloud/ (Worker, D1 migrations, Workflows and server adapters), lib/account/ (browser-facing contracts/client), store/useAccountStore.ts and store/useAccountJobsStore.ts. Existing provider clients and workspace submit handlers gain an explicit account execution branch, preserving guest behavior. Use store/useGalleryStore.ts record/keep and lib/gallery/storage.ts as the local integration boundary, and lib/spend/capture.ts for compatible spend capture; do not scatter new save logic through provider pages.

The cloud library needs a paginated metadata API and lazy asset reads; do not force remote storage into the existing list-all/local-Blob GalleryStorage contract. Keep browser caches separate from authoritative account state. Reuse existing prompt/layout components; do not redesign them. Existing lib/auth admin gates remain isolated and disabled in public production; new account authorization must never treat a disabled gate as authenticated access. No broad rewrite of timeline, image conversion, provider catalogs, or pricing.

## Architecture

Retain Vercel for the web app. A Cloudflare Worker owns Google OAuth, revocable sessions, account authorization, encrypted connections, job intake, quota accounting, and private media access. D1 holds users, sessions, credential ciphertext, jobs, workflow dispatch records, assets, upload intents, and reservations. R2 holds outputs, thumbnails, and short-lived job inputs. Cloudflare Workflows orchestrates submission, provider completion checks, and file capture.

Prefer a same-origin /api/account gateway from Next.js to the Worker: it forwards browser session cookies and tightly selected request fields. The Worker independently validates sessions; it never trusts a user ID header. Large file transfers bypass Vercel through scoped upload/download authorization. Google callback uses the public app origin and the gateway; OAuth state, PKCE, issuer/audience/nonce validation and secure HttpOnly cookies protect the flow. Use Google subject as identity, not mutable email. Choose a maintained Worker-compatible OAuth implementation during the foundation task; no hand-rolled token verification.

## Credentials

Saving a connection is explicit and authorizes use for account jobs. Encrypt with authenticated encryption, fresh nonces, owner/provider binding, and versioned server encryption secrets stored outside D1. Return masked metadata only. Workflows carry connection IDs, never plaintext keys. Exclude credentials and signed URLs from logs and persisted diagnostic payloads. Replacing/removing a connection affects jobs that still need it; explain this before removal and mark affected jobs as needing attention rather than silently switching keys. Signing out does not revoke connections or cancel jobs.

## Durable job contract

Before acceptance, upload and validate references, validate the connection, reserve storage, and persist an immutable job request. Use a per-account unique client request token, with payload digest validation, so repeated clicks/network retries return the same job. Persist dispatch intent atomically with acceptance. Start the Workflow with the job ID; a scheduled reconciler repairs missed dispatches and stalled capture/deletion work.

Separate job execution state from asset-save state. User labels are Queued, Generating, Saving, Saved, Needs attention, Failed, and Cancelled. Persist the provider task ID immediately. Use bounded backoff for safe status and transfer retries. Disable automatic retries around chargeable submission unless the adapter proves provider idempotency. A crash after provider acceptance but before recording its ID is ambiguous: reconcile where supported, otherwise require attention without another paid submission. This cannot promise exactly-once provider execution where the provider offers no such primitive.

Validate every current provider/model family for runtime support, request limits, submission ambiguity, status/cancellation support, result retention, and output bounds. Cloud support is enabled only for verified adapters, with explicit browser-only labeling for exceptions; never silently downgrade an accepted job. Fal and Kie are the first vertical slice, not the whole release acceptance scope.

Stream output into a deterministic R2 object key and verify size/type before committing asset metadata. Retrying a save must not regenerate content or duplicate quota/spend records. Permit authenticated playback/range downloads without public buckets. Reconcile orphan objects and incomplete metadata writes. Temporary provider URLs are not durable assets. Account deletion marks the account unavailable first, stops new work, requests cancellation where supported, and asynchronously removes objects, keys and records; late callbacks cannot resurrect deleted data.

## Quota

Define 1 GB as 1,000,000,000 bytes. Count retained output and thumbnail bytes. Account usage plus concurrent reservations is checked atomically, and reservations are released exactly once. Temporary references have separate bounded upload/concurrency limits and are removed after terminal jobs; they must not become an unmetered storage path.

Show used and reserved space. At capacity, preserve files and offer deleting assets or deliberately choosing browser execution. No silent eviction of cloud assets. Establish model-specific reservation bounds before enabling each adapter. For an unexpectedly larger completed result, preserve the already-paid result using a bounded service overflow allowance and block new cloud jobs until resolved. The allowance and maximum supported output must be verified and specified in the provider capability report before launch; never discard an accepted result solely because a size estimate was wrong. Reject unsupported unbounded outputs before submission. Add account/global upload and job concurrency caps independently of storage.

## Guest and account UX

Near Generate, offer a dismissible explanation of background processing, automatic saving and cross-device connections. Guest active jobs show a keep-tab-open notice. Do not imply registration protects an already-running guest job. Sign-in offers importing existing keys/assets, never uploads them silently. Import is resumable, quota checked, and deduplicated using stable import IDs. Guest data remains intact. Clear account-scoped caches on sign-out and partition caches by account; local eviction is not cloud deletion. Remote deletions must not be resurrected by stale device caches.

## Local development and verification

One npm run dev starts Next.js plus local Worker/D1/R2/Workflows on registered non-default ports. Bootstrap local schema automatically in development. Use a local-only identity shortcut gated by development runtime plus a localhost backend origin, never by Host alone. Fake provider adapters cover asynchronous completion, timeout, crash windows, quota races and save failures without real keys. Real Google/provider smoke tests are a separate credentialed step, not a dependency for normal local development.

Release acceptance includes closing the browser at every stage, reopening on another device, worker restart after provider submission, lost workflow dispatch, retried R2 capture, concurrent reservations, account switching, deletion during an active job, expired credentials and continued guest generation. Every enabled adapter must have documented recovery limitations. User reviews a localhost preview before any UI/behavior push; no commits or pushes without explicit instruction.

## Sources

- https://developers.cloudflare.com/workflows/ — durable steps and execution.
- https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/ — retry behavior.
- https://developers.cloudflare.com/workflows/build/local-development/ — local emulation.
- https://developers.cloudflare.com/workers/local-development/bindings-per-env/ — D1/R2 local support.
- https://developers.cloudflare.com/r2/pricing/ — storage economics; allowance is not monthly generation credit.
# Implementation follow-up — 2026-09-05

An accepted job whose output exceeds its reserved allowance may use bounded temporary overflow: capture at most 1 GB across all outputs for a job, keep overflow privately downloadable for 24 hours, and mark the job as needing storage attention. Promote the existing bytes after the user frees library space; no new generation is submitted. Expiry removes only temporary outputs and releases the job reservation. The permanent library remains capped at 1 GB and existing assets are preserved. The active-job caps bound temporary generation storage to three jobs per account and 100 globally. These are implementation safety limits pending credentialed model-size verification, not assertions about vendor maxima.
