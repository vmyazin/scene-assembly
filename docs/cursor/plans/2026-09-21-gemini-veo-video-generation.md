# Plan: Gemini Veo 3.1 Lite video generation

Date: 2026-09-21

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
