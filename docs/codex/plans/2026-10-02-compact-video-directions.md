# Compact video directions plan

> Follow-up decision — 2026-10-08: User explicitly requested “verify and ship” after previously authorizing shipment. Rebase onto current main, preserving Gemini and shared-result changes. The user chose to perform the localhost visual check after both browser automation backends failed. Shipping authorization is already granted; the visual smoke result remains pending.

## File map
- `components/VideoWorkspace.tsx:3-12,38-57,174-231`: selector import/type, stale comment, and selector rendering only.
- `components/VideoDirectionSelector.tsx:1-end`: new presentational selector and transient preview lifecycle.
- `tests/video-direction-selector.test.tsx:1-end`: meaningful delayed interaction/cancellation checks.
- `tests/video-workspace.test.tsx:1-315`: existing provider and navigation regressions (run without changing behavior).
- `design-explorations/video-directions-A.reference.html:1-end`: selected standalone reference.
- `design-explorations/video-directions-A.manifest.md:1-end`: fixture decisions and visual parity.
- `AGENTS.md` / `CLAUDE.md`: one matching routing entry for the new pattern.
- `.claude/launch.json:1-end`: add isolated web 3275 / Worker 8895 scenario.

## Do not modify
ProviderSelector, MediaCard, generation workspaces, shared workspace layout, app routes/styles, lib/provider catalogs or adapters, stores, cloud source, production credentials, other exploration artifacts.

## Tasks
- [x] Extract standalone A reference and resolve fixture manifest from MODES.
- [x] Implement selector and replace only the existing card grid; verify `pnpm exec tsc --noEmit`.
- [x] Verify timer cancellation/selection and existing provider flows: `pnpm exec vitest run tests/video-direction-selector.test.tsx tests/video-workspace.test.tsx`.
- [x] Run `pnpm lint` and `pnpm build` (see baseline lint findings below).
- [x] Start the full local stack; inspect desktop/mobile, delayed preview, loaded Runware and sparse Kie cases against the reference.
- [x] Hand off `http://localhost:3275/?workspace=video` for explicit shipping sign-off. Do not commit or push without instruction.

## Worktree setup
Commands executed from `.claude/worktrees/compact-video-directions`:
```
export PATH=/Users/vsm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/vsm/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH
pnpm install --frozen-lockfile --prefer-offline
pnpm --dir cloud install --frozen-lockfile
cp ../../../next-env.d.ts .
cp cloud/.dev.vars.example cloud/.dev.vars
```
Set `DEV_FAKE_GENERATION=1` in `cloud/.dev.vars`. Main has no `.env.local`; the selector requires no credentials. All five illustrations are checked in, so no thumbnail copy is required. Start with `ACCOUNT_WORKER_PORT=8895 pnpm dev -- --port 3275`.

## Verification — 2026-10-08
- Rebased onto `origin/main` at `1a0b155`; resolved only additive documentation/launch conflicts. Gemini imports/routing and all provider filtering retained.
- Production build including TypeScript passed; existing Turbopack tracing warning remains.
- Changed-file ESLint passed. Full-repo lint reports three `react-hooks/purity` errors at GeminiVideoWorkspace.tsx:318,351,387 and three warnings in unchanged files; GeminiVideoWorkspace is byte-identical to origin/main.
- Local web 3275 returns HTTP 200 and local Worker 8895 `/health` returns `{ "ok": true }`.
- Four-file regression run initially passed 104/106 tests, with two 5-second timeouts during concurrent builds. Re-running serially with a 30-second timeout.
- Browser automation cannot attach the webview and native Computer Use fails to start. User chose manual smoke testing at http://localhost:3275/?workspace=video. No visual parity or manual review is claimed yet.

### Final automated results
- All 106 tests pass across video-direction-selector (6), video-workspace (9), Kie workspace (21), and generation-interface (70). With the slow host, final runs used `--maxWorkers=1 --testTimeout=30000`.
- One retry hit ENOSPC while loading the image suite. Cleared only this worktree’s generated `.next/dev/cache`; the image suite then passed 70/70. No source/dependency files were removed.
- `git diff --check origin/main` passes after trimming reference whitespace.
- Shipping authorization exists; manual browser smoke result requested from the user. The local stack remains running for that check.

### Manual smoke result
On 2026-10-08, the user confirmed “Yes, the checks pass” for compact tabs, the one-second preview, dismissal on leaving, and working direction selection at http://localhost:3275/?workspace=video. This completes the local behavior smoke gate. Automated visual screenshots/parity measurement remain unavailable because the computer-use service failed; the release relies on the user’s visual review.
