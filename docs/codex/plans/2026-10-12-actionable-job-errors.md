# Actionable failed-job details plan

## File map
- `lib/account/job-failure.ts:60-130`: next-step guidance.
- `components/account/CloudJobList.tsx:1-100`, new `JobFailureDetails.tsx`: identity and shared disclosure.
- `cloud/src/failure.ts:1-120`, `generation-runner.ts:95-110`, `assets.ts:30-55`: capture evidence.
- `lib/account/contracts.ts:35-44`: clarify existing detail field.
- `tests/account/job-failure.test.tsx`, `cloud/tests/failure-reason.test.ts`: regression checks.
- `scripts/seed-result-recovery.mjs`, `.claude/launch.json`: reproducible local review.
- `AGENTS.md`, `CLAUDE.md`: routing update.

Do not modify: provider adapters, fetch allowlist, resume rules, database schema, spend, authentication, MCP tools, production data.

## Tasks
- [x] Add shared guidance and error detail disclosure; verify with `pnpm exec vitest run tests/account`.
- [x] Preserve safe capture evidence; verify with `pnpm --dir cloud exec vitest run`.
- [x] Add representative local fixtures and port 3281 / Worker 8981; run `ACCOUNT_DEMO_ORIGIN=http://localhost:3281 node scripts/seed-result-recovery.mjs`.
- [x] Run both typechecks, lint changed files, and build; inspect local account and narrow viewport in browser.
- [x] Provided localhost preview; user approved all changes for shipping on 2026-10-12.

## Local setup
Run both frozen-lockfile pnpm installs in the worktree. This main checkout has no `next-env.d.ts` or `.env.local`; Next dev generates its declaration file, and the launcher supplies local Worker vars. No symlinks needed.

## Verification result
- Node 24 (`PATH=/Users/solid/.nvm/versions/node/v24.21.0/bin:$PATH`) is required for the test environment. The host default Node 26 exposes a conflicting localStorage global. Use `pnpm exec vitest run <paths>`; pnpm 11's script forwarding with `--` ran the whole suite instead of the selected paths.
- Account: 36 files / 240 tests passed. Worker: 46 files / 404 tests passed.
- Both TypeScript checks, changed-file ESLint, production build and diff whitespace check passed.
- Live local browser: expanded recorded error, copied report, retrieved explicit provider link, and saved the staged fixture through Retry saving (68 bytes in library, attention count fell from 4 to 3).
- Narrow viewport: 380px rendered width and 380px document width; status wraps below prompt. Restored viewport afterward.
- Review capture: `docs/codex/actionable-job-errors-review.jpg` (seeded local data only).
- Local app remains running on http://localhost:3281/account#jobs for approval. At review time: no commit, push, production data access or paid generation.

## Follow-up — 2026-10-12, compact scan copy
User requested less visible prose. `failureSummary` now owns short cause/next-step lines, actions share a wrapping row, dates omit seconds/year, and full explanation plus retry history move into Issue details. Existing copy/recovery behavior stays intact.
- [x] Account suite: 241 tests passed, including hidden/expanded explanation visibility.
- [x] Typecheck, changed-file lint, and live browser review passed. Review screenshot replaced with compact rows.
- [x] User approved committing and shipping all changes on 2026-10-12.

Suggested commits: all changes `fix: make failed jobs actionable and scannable`; compact follow-up only `refactor: condense failed-job summaries`.

## Follow-up — remove redundant attention label
`CloudJobList` omits the generic attention badge while retaining the specific cause, elapsed time, other states, and navigation filters. Verify with existing job-list/recovery tests and the local seeded account.
Suggested commits: all changes `fix: make failed jobs actionable and scannable`; latest only `refactor: remove redundant attention labels from job rows`.

## Shipping approval — 2026-10-12
User approved “ship all” after reviewing compact copy and removal of redundant attention labels. Final verification runs against the rebased main branch before push.
