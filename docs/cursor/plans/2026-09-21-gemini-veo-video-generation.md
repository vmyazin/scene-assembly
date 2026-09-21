# Plan: Gemini Veo 3.1 Lite video generation

Date: 2026-09-21

## Follow-up decision — 2026-09-21

Overrides the original success-only capture and broad submission retry behavior.
File map: `components/GeminiVideoWorkspace.tsx:320-440` (submission and accounting),
`tests/gemini-video-workspace.test.tsx:280-360` (failure regression coverage).
Do not modify SDK helpers, other providers, catalogs, or Worker adapters.

- [x] Restrict automatic start retries to explicit quota rejection; verify with
  `pnpm exec vitest run tests/gemini-video-workspace.test.tsx`.
- [x] Capture completed generation spend despite transfer/storage failure, once;
  verify with the same workspace suite and the spend tests.
- [x] Typecheck and smoke-test the current localhost Gemini workspace.

## File map

- `lib/engines/gemini.ts` — replace stubs with `generateVideos` /
  `getVideosOperation` / URI fetch. Keep `geminiGenerate` unchanged aside from
  sharing the client constructor.
- `lib/engines/gemini-video-catalog.ts` — clamp 1080p duration to 8s.
- `lib/spend/resolve.ts`, `lib/spend/capture.ts` — `resolveGeminiVideo` /
  `captureGeminiVideo`.
- `lib/download-name.ts` — Veo `fileCode` from the video catalog.
- `components/GeminiVideoWorkspace.tsx` — real generate loop, results, remove
  callout.
- `components/VideoWorkspace.tsx` — pass `onContinueFromFrame`.
- `tests/engines/gemini-video.test.ts` — mock SDK.
- `tests/gemini-video-workspace.test.tsx` — mock helpers; no stub copy.
- `tests/spend/capture.test.ts`, `tests/spend/resolve.test.ts`,
  `tests/download-name.test.ts` — video pricing and filenames.

## Do not modify

- `cloud/src/provider-adapters/synchronous.ts`
- fal / Kie / Runware clients and catalogs
- Gemini image `generateContent` request shape

## Tasks

- [x] Implement start/poll/download helpers against `@google/genai` 2.11.
- [x] Wire the workspace; remove the orange note.
- [x] Capture spend + gallery on success.
- [x] Tests with mocked SDK and mocked helpers.
- [x] `pnpm test` on the files above.

## Follow-up verification — 2026-09-21

Updated the isolated worktree to origin/main at fbe3577 before making these fixes.
The superseded draft is preserved in a Git stash and is not part of this diff.
Focused SDK/workspace/spend/naming suite: 143 tests passed. Next route type generation
and TypeScript passed. Browser smoke at http://localhost:3163/?workspace=video
verified the Gemini Lite controls, price, and missing-key gate. Paid generation
was not repeated against this revision; failure paths are covered with mocks.
The earlier standalone live API test used Veo Fast, not this Lite workspace.

Local launch: `ACCOUNT_WORKER_PORT=8863 npm run dev -- --port 3163` in this worktree.
Dependencies were installed with the frozen-lockfile pnpm commands in AGENTS.md;
`next-env.d.ts` and ignored thumbnails were copied using its documented commands.
Use `cloud/.dev.vars.example` for local Worker configuration; no provider key is
needed for this smoke check. No cloud video adapter is added by this follow-up.
