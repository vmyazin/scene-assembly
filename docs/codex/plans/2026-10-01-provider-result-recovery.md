# Provider result recovery implementation
Date: 2026-10-01

## File map
- `cloud/src/assets.ts:23-33`: delegate address validation, preserving typed errors.
- `lib/account/result-location.ts` (new), `cloud/src/result-recovery.ts` (new): shared policy and recovery projection.
- `cloud/src/jobs.ts:69-82`, `cloud/src/job-routes.ts:46-70,88-120`: current-policy retry capability and authenticated recovery read.
- `lib/account/contracts.ts:20-40`, `lib/account/job-failure.ts:56-110`, `lib/account/gateway.ts:14`: optional capability, copy, route.
- `components/account/CloudJobList.tsx:40-63`, `components/account/ProviderResultRecovery.tsx` (new): recovery UI.
- `cloud/tests/result-recovery.test.ts` and `tests/account/provider-result-recovery.test.tsx` (new), existing gateway/failure tests: behavior verification.
- `scripts/seed-result-recovery.mjs` (new), `.claude/launch.json`, account development guide and agent router: reproducible local review.

## Do not modify
Provider adapters, generation submission, generation-runner, pricing/spend, storage/migrations, MCP tools, timeline, other worktrees, and the main checkout.

## Tasks
- [x] Add policy, metadata, and retry enforcement. Verify: `pnpm --dir cloud test -- tests/result-recovery.test.ts tests/failure-reason.test.ts tests/workflow.test.ts`.
- [x] Compose recovery UI with owner/epoch guards. Verify: `pnpm test -- tests/account/provider-result-recovery.test.tsx tests/account/job-failure.test.tsx tests/account/gateway.test.ts`.
- [x] Register ports 3167/8867 and seed deterministic local recovery rows. Verify in browser on `/account#jobs` and through the API.
- [x] Run Worker/root typechecks and scoped lint; record results and present localhost preview. Do not commit or push before user instruction/sign-off.

## Verification — 2026-10-01
- Cloud suite: 42 files / 383 tests passed, including approved-host recovery without submission/polling, owner isolation, bounded retries, and URL restrictions.
- Focused browser-side tests: 3 files / 23 tests passed using `node node_modules/vitest/vitest.mjs run tests/account/provider-result-recovery.test.tsx tests/account/job-failure.test.tsx tests/account/gateway.test.ts --maxWorkers=2`.
- Worker and root TypeScript checks passed; scoped ESLint and `git diff --check` passed.
- Headless Chromium smoke against real local Next/Worker/D1/R2: manual recovery read returns the illustrative link; Retry saving reaches Saved with the staged PNG; 390px mobile viewport has no horizontal overflow; no page errors. Desktop and mobile captures inspected.
- The bundled pnpm 11 wrapper forwarded `--` such that the initial test command ran the whole suite. The broad root run timed out unrelated UI tests under host load and was stopped; only the focused root run above is claimed as passing.
- Local fixture recovery initially retained a quota-overflow journal from a missing storage row. Seed now bootstraps account storage and clears only its own retention records before resetting its assets. Workflow attempts are preserved to avoid reusing an old local Workflow instance; `--fresh` creates another retry example for review.
- No production provider requests, commit, or push. Preview remains running pending user review.

## Follow-up decision — 2026-10-01 shipping
The user approved shipping. The Worker CI run (also the three preceding runs) failed before deployment because its cloud-only installation cannot resolve `@fal-ai/client` imported by `lib/fal/server.ts`. Extend the file map to `.github/workflows/deploy-account-worker.yml`: install both root and Worker dependencies, cache both locks, and trigger Worker deployments on root dependency changes. This is a deployment prerequisite and does not alter the reviewed UX. Verify through the full Worker CI suite, typecheck, deployment and health check.
