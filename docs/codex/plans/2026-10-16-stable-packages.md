# Current stable dependencies implementation

## File map
- `package.json:1-48`, `cloud/package.json:1-26`: stable dependency versions and package-manager pin.
- `pnpm-lock.yaml:1-end`, `cloud/pnpm-lock.yaml:1-end`: regenerated dependency graph.
- `pnpm-workspace.yaml:1-6`, `cloud/pnpm-workspace.yaml:1-5`: installation compatibility.
- `.github/workflows/deploy-account-worker.yml:68-72`: matching package-manager version.
- `.claude/launch.json:1-end`: review scenario on web 3267 / Worker 8967.
- Compatibility changes only as demonstrated by compiler, test, lint, or build failures; record them below.

Do not modify: provider catalogs or rates, database migrations, authentication policy, production configuration/secrets, or unrelated user work.

## Tasks
- [x] Inspect both manifests, registry stable versions, local runtime, and repo workflow.
- [x] Update manifests, lockfiles, build policy and CI package-manager pin; verify both frozen installs.
- [x] Resolve necessary compatibility changes; verify root/Worker typechecks, both test suites, lint and production build.
- [x] Start registered local scenario and smoke-test studio/account flow with credential-free fake generation.
- [x] Record verification and hand over localhost link for required review before shipping.

## Results

- Both frozen installs pass with pnpm 12.14.0; both projects report no peer dependency issues.
- Root `outdated` reports only the documented ESLint 10 incompatibility; the Worker reports no outdated direct dependencies.
- Root tests: 226 files, 2,474 tests passed. Worker tests: 46 files, 402 tests passed.
- Root TS 7 typecheck and Worker TS 7 typecheck pass. `next typegen` creates the missing local Next declarations.
- Production Next build and Worker `wrangler deploy --dry-run` pass. No deployment was performed.
- Lint runs but reports three existing `react-hooks/purity` errors in `components/GeminiVideoWorkspace.tsx:318,351,387`, plus three warnings. An isolated install of the original ESLint 9.39.5 / eslint-config-next 16.2.10 / TypeScript 5.9.3 reproduced those same three errors. No rules were disabled and the unrelated handler was left unchanged.
- Next emits a filesystem tracing warning for the existing configurable legacy SQLite path in `lib/auth/db.ts`, and Node 26 warns about unavailable server localStorage. These do not fail the build; no legacy auth behavior was changed.
- Credential-free local smoke passes: staging/cleanup, fake generation through Workflows, private R2 full/range download, import and idempotent replay. Browser verification covers studio rendering, video/provider switching, local sign-in, and both seeded library entries. No browser console errors.
- Localhost review was provided at http://localhost:3267 (Worker 8967). The user explicitly approved committing and shipping on 2026-10-16; deployment follows rebase onto current `origin/main`.


### Compatibility decisions (2026-10-16)
- Use ESLint 9.39.5: the current Next React/import/accessibility plugins do not support ESLint 10.
- Root uses Microsoft's documented side-by-side compiler aliases: `@typescript/native` provides TS 7 `tsc`, while `typescript` aliases `@typescript/typescript6` for Next and typescript-eslint's compiler API. The Worker can use TS 7 directly.
- Update README's TypeScript badge and pnpm prerequisite. `next-env.d.ts` is absent even in the main checkout on this host; generate it via `next typegen` before standalone typechecks.
- Source: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0

### Follow-up decision (2026-10-16)
Next 16.4 automatically appended agent instructions on first dev startup. `next.config.ts:4-6` now sets `agentRules: false` with rationale, because this repo maintains its own routing. `AGENTS.md:19-23` routes future dependency work to `docs/codex/dependency-updates.md`; `CLAUDE.md` already refers to AGENTS.md. The generated block was removed and a restarted dev server preserves the maintained file. This extends the config/doc file map without changing product behavior.

### Shipping verification — 2026-10-16
Rebased onto `25f3690` from origin/main after user sign-off, preserving both sides of the AGENTS.md and launch-registry additions. Repeated verification on the combined code: 2,675 web tests (241 files), 472 Worker tests (48 files), both typechecks, frozen installs, lint, production build and the credential-free account smoke all pass. The latest main already fixes the prior Gemini lint errors; lint now has no errors or warnings. Browser account/library verification also passes with no console errors.
