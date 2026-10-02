# Shared model results implementation

## Follow-up decision — 2026-10-02
Rebasing for shipment encountered newer shared image-feed and job-card changes on main. Preserve that image feed across providers and input modes, uploaded-reference exclusion, and the updated job cards. This overrides the earlier image scope boundary and isolation assertion; video results still share models within provider/input mode. Re-run targeted tests and browser smoke after resolving the overlap.


## File map
- `components/account/CloudJobPanel.tsx:21-26`: select account jobs/assets by workspace.
- `components/ProviderVideoWorkspace.tsx:226-284,592-600,939-953`: remove edit pin and browser model filter; label actual result model.
- `components/KieGenerationWorkspace.tsx:148-150,639-647`: share browser results and label actual result model.
- `components/FalGenerationWorkspace.tsx:900` and `components/GenerationInterface.tsx:1428`: update cloud panel props.
- `tests/account/cloud-job-panel.test.tsx`, `tests/providers/video-edit-workspace.test.tsx`, `tests/kie/workspace.test.tsx`: regression coverage.
- `AGENTS.md`, `CLAUDE.md`: route results work to the new spec.
- `.claude/launch.json`: register web 3167 / Worker 8867.

Do not modify: provider requests, job stores, account lifecycle/ownership, media validation, spend, timeline, cloud Worker, existing result display caps.

## Tasks
- [x] Update result selectors and callers, preserving original model labels. Verify: `pnpm exec tsc --noEmit`.
- [x] Add regression coverage for model switching, mixed-model images, workspace isolation and account reset. Verify: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 tests/account/cloud-job-panel.test.tsx tests/providers/video-edit-workspace.test.tsx tests/providers/workspace.test.tsx tests/kie/workspace.test.tsx tests/fal/workspace.test.tsx`.
- [x] Smoke-test synthetic local video edits and switching in browser. Verify: `ACCOUNT_WORKER_PORT=8867 node scripts/dev-account-services.mjs --port 3167`, then `ACCOUNT_DEMO_ORIGIN=http://localhost:3167 node scripts/seed-edit-account.mjs`.
- [x] Share localhost preview and await explicit shipping approval. User approved committing and shipping on 2026-10-02.

## Local setup
Run `pnpm install --frozen-lockfile --prefer-offline` and `pnpm --dir cloud install --frozen-lockfile`. Copy `cloud/.dev.vars.example` to `cloud/.dev.vars`; set `DEV_FAKE_GENERATION=1`. This checkout has no root `.env.local`; fake generation needs no credentials. Next dev creates `next-env.d.ts` on launch. If node is absent from PATH, prepend `/Users/vsm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`.

## Verification results
- 89 targeted tests passed across the five account/provider/Kie/fal suites.
- TypeScript and lint of all changed components/tests passed.
- The first test invocation through the bundled pnpm wrapper unexpectedly ran the full suite and caused resource-related timeouts; it was stopped, and the targeted Vitest command above passed with two workers.
- Browser smoke passed at `http://localhost:3167/?workspace=video&videoMode=edit`: generated a fake P-Video-Edit job from the checked-in synthetic video fixture, switched to Seedance while running, then switched both ways after completion. The exact saved asset URL and Download video control remained available.
- Localhost preview reviewed; user approved shipping on 2026-10-02. Commit, rebase onto origin/main, push, then stop preview services and remove the task worktree.

- Post-rebase verification: all 94 targeted tests, TypeScript and changed-file lint passed. Refreshed both dependency installs from the lockfiles. Browser smoke on the merged code confirmed the same saved video URL and download control remain visible after switching from P-Video-Edit to Seedance 2.5.
