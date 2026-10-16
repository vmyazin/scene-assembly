# Auto-trim reference clips implementation

## File map
- `lib/media/trim-video.ts:1-120`: shared bounded conversion, cancellation and real duration validation.
- `components/VideoSourceInput.tsx:25-85`: prepare selection and describe trim, retain owner and staging guards.
- `components/ReferenceClipTray.tsx:95-160`: fit uploaded video to per-file and remaining-total limits.
- `tests/media/trim-video.test.ts`, `tests/providers/video-edit-workspace.test.tsx`: boundary and lifecycle regression tests.
- `AGENTS.md`, `CLAUDE.md`: route to the shared helper.
- `.claude/launch.json`: web 3281 / Worker 8981.

Do not modify: cloud/, provider catalog limits, provider adapters, spend, timeline rendering or library originals.

## Tasks
- [x] Implement helper and integrate both selectors; verify with `pnpm exec tsc --noEmit`.
- [x] Add duration and lifecycle tests; verify with `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run tests/media/trim-video.test.ts tests/providers/video-edit-workspace.test.tsx tests/providers/reference-clips.test.ts tests/providers/reference-clip-trim.test.tsx`.
- [x] Run targeted lint and local browser smoke with synthetic audio/video, capture the notice and verify output duration/audio.
- [x] Offer localhost preview and await shipping sign-off — user approved: “looks good, ship it”.

## Local setup
Run `pnpm install --frozen-lockfile --prefer-offline` and `pnpm --dir cloud install --frozen-lockfile` inside this worktree. This host has no root next-env.d.ts or .env.local; Next generates next-env.d.ts when started. The dev launcher creates local Worker vars. Run `ACCOUNT_WORKER_PORT=8981 DEV_FAKE_GENERATION=1 pnpm dev -- --port 3281`.

The host uses Node 26: set `NODE_OPTIONS=--no-experimental-webstorage` for jsdom tests because its global localStorage shadows jsdom without a storage file. Use `pnpm exec vitest run <paths>`; this pnpm version forwards `pnpm test --` as a literal separator and runs the whole suite.

## Verification — 2026-10-15
- TypeScript, targeted ESLint and `git diff --check` pass.
- 84 tests across the trim helper, reference tray, provider edit workspace, reference limits, YouTube source lifecycle and fal workspace pass.
- `scripts/smoke-auto-trim.mjs` runs real browser conversion with a generated 1280×720, 24 fps, 12-second MP4 and an AAC tone. Device and cloud-library selection both produced a 9.962667-second MP4 with audio; the library original remained byte-identical.
- Screenshot: `test-assets/auto-trim-source.png` (gitignored). Local account library contains the synthetic source for manual review. Fake generation is enabled; no provider submission was made.
- Preview: http://localhost:3281/?workspace=video&videoMode=edit . Local test sign-in, fal.ai → Kling O1 Edit → From library → Use video.
- User approved shipping after localhost review. Commit and rebase onto the latest origin/main before pushing.
