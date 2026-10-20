# Gemini Veo 3.1 Lite video generation

Status: Approved design
Date: 2026-09-21

## Follow-up decision — 2026-10-20 (second review)

Each result carries `kind: 'interaction' | 'file'`, and
`geminiPollVideoOperation` takes the previous result, so the poll picks its
endpoint from the kind rather than the shape of the id. It also carries the
interaction id and any inline bytes forward across file polls. A retryable
poll failure (`isRetryableFailure`) waits for the next poll, up to
`GEMINI_VIDEO_POLL_FAILURE_LIMIT` in a row, because the job is already paid
for. Giving up, or any other poll failure except a safety block, points to
AI Studio. A started job that ends without a clip and without a failure
reported by Google (timeout, lost polls, the tab moved on) files an
unknown-cost spend row, because it may still be billed. The first file poll after the interaction hands over its file
skips the wait. A create timeout says the job may have started; a bare fetch
`TypeError` leads with the connection, because offline sends and CORS
rejections throw the same error and never reach Google. After a successful
download the workspace deletes the interaction (`DELETE
/v1beta/interactions/{id}`, best effort), because `store: true` keeps the
prompt and any reference image on Google's side.

## Follow-up decision — 2026-10-19 (review)

Generation uses `background: true` and polls `GET /v1beta/interactions/{id}`
until the status is terminal. `in_progress` and `queued` stay open. Only
`completed` with no video is "finished without a video". A safety `error.code`
(`safety`, `jailbreak`, `prohibited_content`, `blocklist`, `content_blocked`)
keeps the blocked-clip message. The create POST times out on its own; a
network failure there says the job may have started. Resolutions are listed
lowest first, with `defaultResolution: '720p'` and `defaultDuration: 8`.
Unpriced resolutions show "price unknown" and the 720p figure as a labelled
lower bound. They are not filed as a charge.

## Follow-up decision — 2026-10-19

Veo 3.1 Lite (`veo-3.1-lite-generate-preview`) shuts down on 2026-10-22.
`gemini-omni-1.1-flash` is the catalog default and the fallback for a stored
or unknown id. Generation is `POST /v1beta/interactions` with the documented
`response_format` (`type: video`, `aspect_ratio`, `resolution`, `duration`
as `"3s"`–`"10s"`, `delivery: uri`), then GET the file until `ACTIVE`. This
overrides the `generateVideos` / `getVideosOperation` boundary below.

720p is priced from the pricing page: 5,792 output tokens per second × $17.50
per million = $0.10136/s. 360p, 1080p, and 4k stay selectable and unpriced.
Clip extension and first+last frame stay out of `GeminiVideoWorkspace`: they
need a video upload or a second still. fal and Runware Veo Lite models are
unchanged.

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
