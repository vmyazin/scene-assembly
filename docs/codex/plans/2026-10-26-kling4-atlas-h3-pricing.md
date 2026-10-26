# Implementation plan

## File map
- `lib/providers/catalog.ts:953-1200`: Atlas models and capabilities.
- `lib/providers/atlas.ts:174-207,303-370`: image/reference and edit wire mapping.
- `components/ProviderVideoWorkspace.tsx:376-414,900-1040`: capability-driven reference UI if needed.
- `cloud/src/provider-adapters/aggregators.ts`: matching cloud validation and request mapping.
- `lib/account/model-schema.ts:180-280`: advertised agent modes, only if capabilities need expansion.
- `lib/spend/rates.ts:250-400`, fal pricing/display and spend capture: promotion window and rate selection.
- Provider, fal, spend and cloud tests: contract and expiry coverage.
- `.claude/launch.json`: isolated web/Worker review ports 3331/8931.

Do not modify: provider enablement configuration, unrelated catalogs, timeline, authentication, existing ledger records, production infrastructure.

## Tasks
- [x] Verify Atlas contracts and fal promotional scope against official sources.
- [x] Add Atlas catalog and payloads; verify with provider and catalog-rate tests.
- [x] Align account/API validation; verify cloud model-schema and adapter tests.
- [x] Correct fal promotion prices and cutoff; verify pricing and spend tests.
- [x] Run `pnpm exec tsc --noEmit`, `pnpm --dir cloud typecheck`, relevant lint and production build.
- [x] Start credential-free local app on 3331/8931 and inspect all changed controls; deliver localhost URL for review.

## Verification record — 2026-10-26
- Root suite: 244 files, 2,705 tests passed.
- Cloud: Kling contracts, model descriptors, edit/source validation, MCP docs and spend tests passed; cloud typecheck passed.
- Root TypeScript, targeted lint, `git diff --check`, and production build passed. Build retains the existing `lib/auth/db.ts` dynamic-filesystem tracing warning.
- Browser review: Atlas text 5s/720p ~$0.71; 1080p ~$1.07; image mode ordered keyframes and no aspect/audio control; reference mode ten-image limit; edit output-duration selector and source-defined shape. fal Turbo 5s/768p ~$0.15 with 35% sale note.
- Screenshots: `docs/pr-screenshots/atlas-kling-4.png`, `docs/pr-screenshots/fal-h3-turbo-sale.png`.
- Local seed: `node scripts/seed-kling4-preview.mjs`; dummy Atlas/fal connections only. No paid vendor jobs.
- Local review completed at http://localhost:3331/?workspace=video (Worker 8931). The user approved shipping to main on 2026-10-26.
