## Follow-up decision — 2026-09-11
User testing returned the synthetic fixture because the review server remained in DEV_FAKE_GENERATION=1. This supersedes the simulated review server state below: restart with DEV_FAKE_GENERATION=0 for real rendering. Make the simulated submission button explicitly say “Run simulation · test video only” and omit vendor price estimates in simulation, so it cannot look like a real paid edit. Align P-Video-Edit image captions with its prompt syntax.

# P-Video-Edit implementation

## File map
- lib/providers/types.ts:100-180 and catalog.ts:108-120 — capabilities and model.
- lib/providers/video-edit.ts:1-25, components/VideoSourceInput.tsx:25-55 — source validation.
- components/ProviderVideoWorkspace.tsx:217-850 — controls and requests.
- lib/providers/browser.ts:35-50, runware.ts:115-130, app/api/providers/video/route.ts:109-120, cloud/src/provider-adapters/aggregators.ts:28-108 — payload and validation.
- lib/spend/resolve.ts:67-90 and lib/models/listbox-specs.ts:290-310 — estimates and model summary.
- tests/providers and cloud tests — regression coverage.

Do not modify: timeline, credentials, deployment configuration, unrelated main checkout changes.

- [x] Add capabilities, payload and shared validation; verify targeted provider and cloud tests.
- [x] Add draft control and pricing; verify workspace tests and TypeScript.
- [x] Smoke-test browser and local cloud flow on localhost:3153 with worker8853, clearly label fake generation.
- [x] Provide localhost review link before shipping.

## Local setup
Run pnpm --ignore-workspace install --frozen-lockfile --prefer-offline and pnpm --dir cloud install --frozen-lockfile in the worktree. Copy ../../../next-env.d.ts if present; cp cloud/.dev.vars.example cloud/.dev.vars. Main has no .env.local to copy; use credential-free local emulation. Start ACCOUNT_WORKER_PORT=8853 DEV_FAKE_GENERATION=1 npm run dev -- --port 3153.

## Verification — 2026-09-11
- Provider/model/pricing regression suite: 242 passed; final edit regression run: 16 passed, including the added model-switch source-limit test.
- Cloud aggregator/edit suite: 20 tests passed across initial run and corrected test-token rerun.
- Web and Worker TypeScript checks passed; Next production build passed; git diff --check passed.
- Browser smoke: local test account, P-Video-Edit selected, seeded four-second source from cloud library, Standard estimate $0.14 (promo; was $0.18), Draft estimate $0.08 (promo; was $0.10), prompt shortcut, submitted local cloud simulation, saved video and download control visible.
- Local simulation does not verify actual Runware transformation quality. No paid P-Video-Edit run performed.
- Review server remains at http://localhost:3153/?workspace=video&videoMode=edit. No commit, push, or deployment performed; awaiting review.

## Release approval — 2026-09-11
The user added a real Runware connection, reported “test passed,” and explicitly requested deployment. This supersedes the pending-review status above.
