# Gemini Veo 3.1 Lite video generation

Status: Approved design
Date: 2026-09-21

## Follow-up decision — 2026-09-21

This overrides the retry and success-only spend acceptance below. Missing start
responses do not establish that Google rejected a paid job. Automatically retry
only an explicit 429 quota rejection; leave ambiguous failures for manual review.
Once an operation completes with video output, capture its estimated spend exactly
once, including when download or library storage fails. Keep library linkage when
storage succeeds. This follow-up is bounded to `GeminiVideoWorkspace` and its tests;
it does not add models, cloud execution, or persistent operation recovery.

## Context

Veo 3.1 Lite is already in `lib/engines/gemini-video-catalog.ts`, the video
provider selector, and the Gemini video workspace. Generate still throws. The
orange callout under the button exists only because that work was scoped out —
there is no API blocker. Image Gemini already uses `@google/genai`
(`GoogleGenAI` + `generateContent`). Video uses the same SDK's long-running
operation surface, documented at https://ai.google.dev/gemini-api/docs/veo
(read 2026-09-21).

## Goals

- Start a Veo job with `ai.models.generateVideos`, poll with
  `ai.operations.getVideosOperation` every 10 seconds until `done`, then fetch
  the clip bytes.
- Support text-to-video and image-to-video (one still from the draft store).
- Honour catalog constraints for `veo-3.1-lite-generate-preview`: 720p/1080p,
  4/6/8s (1080p is 8s only), 16:9 and 9:16.
- File a successful clip into the library and the spend ledger the same way
  other video providers do.
- Remove the “coming in the next update / use other providers” callout.

## Non-goals

- Cloud/Worker background jobs. Gemini video is a long-running operation, not
  the synchronous image adapter, and `CLOUD_GENERATION_PROVIDERS` is gated on a
  live check.
- Extension, last-frame interpolation, or `referenceImages` (Lite does not
  publish those).
- A persistent Gemini job store. This BYOK path waits in the workspace, like
  image Gemini, rather than fal/Kie's queue.

## Scope and implementation boundary

Helpers live in `lib/engines/gemini.ts` next to `geminiGenerate`, using the
documented JS API:

```ts
let operation = await ai.models.generateVideos({ model, prompt, image?, config });
while (!operation.done) {
  await wait(10_000);
  operation = await ai.operations.getVideosOperation({ operation });
}
// Download: GET video.uri with x-goog-api-key.
// ai.files.download({ downloadPath }) is Node-only and must not be used in the browser.
```

`GeminiVideoWorkspace` orchestrates start → poll → download, renders the clip
through `VideoPlayer`, and captures spend/gallery. Catalog narrowing stays in
`gemini-video-catalog.ts`. Rates stay in `lib/spend/rates.ts`.

Must not touch: fal/Kie/Runware request contracts, the Worker synchronous
adapter, or Gemini image `generateContent`.

## Acceptance

- Text-to-video and image-to-video produce an mp4 in the results rail.
- Missing key, failed operations, RAI blocks, and timeouts surface as honest
  errors. Auto-retry applies only to start failures that never accepted a job
  (`RouteError` / `singleAttempt`, same as other BYOK paths).
- The orange stub note is gone.
- Unit tests mock `@google/genai` for start/poll/download. Workspace tests mock
  the helpers and assert Generate invokes them.
