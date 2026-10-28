## Agent instruction file: router, not encyclopedia

- Keep this file short. It holds (a) a one-paragraph architecture map — a table of
  packages → domain → role, and where state lives, (b) the session workflow, (c) how
  to run locally. Everything deeper goes in `docs/<topic>.md`.
- Maintain an **auto-load routing** section: task type → which doc/skill to read
  *first*. Example: "UI consistency scan → run the `ui-consistency` skill, and first
  read `docs/ui-consistency-seeds.md`." The agent should not discover context by
  grepping; the route tells it what to load.
- Mirror the file for other tools (`AGENTS.md`), and treat it as living: update it
  when a new component pattern, workflow, or convention is established — not at the
  end of the project.
- Write rules **with their rationale inline**. "Use X" gets ignored under pressure;
  "Use X because Y fails when Z" survives. Same for config: comment *why* the deploy
  order is app → content → mcp, not just that it is.

## Auto-load routing

- **Provider display order or ranking** → first read `docs/codex/specs/2026-10-26-provider-ranking.md`. Rank the exposed image and video catalogs separately, because platform-wide model counts misrepresent the choices here; preserve saved selections and distinguish integration evidence from measured reliability.

- **Atlas Kling 4.0 or fal H3 promotional pricing** → first read
  `docs/codex/specs/2026-10-26-kling4-atlas-h3-pricing.md`. Atlas's live quote
  differs from its headline; preserve the documented pricing evidence and unknown
  edit totals. Keyframes use `middle_images`, and an explicit empty `aspectRatios`
  means the input fixes the shape. fal promotions resolve at call time and saved
  job time, because a running Worker can outlive the sale.

- **A selected source/reference video exceeds model duration** → first read
  `docs/codex/specs/2026-10-15-auto-trim-ref-clip.md`. Use
  `lib/media/trim-video.ts` before accepting the selection and revalidate its output,
  because changing duration metadata leaves oversized bytes for the provider.
  Keep library originals intact and release replaced staged YouTube inputs.

- **UI consistency scan, component extraction, or a Tailwind utility that does
  nothing** → first read `docs/ui-consistency-seeds.md`. Shared classes in
  `app/globals.css` sit in `@layer components` (field defaults in `@layer base`)
  so utilities beside them apply; a new unlayered class rule silently beats every
  utility, which is how about 400 tweaks went dead before October 2026.

- **Dependency or framework updates** → first read `docs/codex/dependency-updates.md`.
  Keep the TS 7 CLI and TS 6 compiler API aliases separate and honor the lint
  plugins' peer ranges, because a newer compiler or ESLint can install successfully
  while breaking lint. Next's version-matched guides live in `node_modules/next/dist/docs/`.

- **Relaxed filter** → `lib/moderation/`. Standard sends today's payload
  (Kie still includes `nsfw_checker: true` and Veo `enableFallback: false`).
  Relaxed writes one documented host key and is text-only: a reference or a
  minor mention forces Standard. `NEXT_PUBLIC_RELAXED_FILTER` defaults to
  `off` until the A/B in the spec; the Worker does not read that Next flag
  and instead downgrades a relaxed job when `relaxed_consent_at` is missing.
  User-facing copy never says uncensored or NSFW.

- **Gemini / Omni video generation** → first read
  `docs/cursor/specs/2026-09-21-gemini-veo-video-generation.md` (the 2026-10-19
  follow-up replaces Veo 3.1 Lite). Start, poll, and download live in
  `lib/engines/gemini.ts` (`POST /v1beta/interactions` with `background: true`
  for `gemini-omni-1.1-flash`, then GET the interaction until it finishes, then
  GET the file until `ACTIVE`, then GET `video.uri` with the API key). A
  synchronous POST hid a dropped connection behind "could not start" and invited
  a second charge. Results carry `kind`, and the poll takes the previous result,
  so the endpoint is never guessed from the id. A retryable poll failure keeps
  polling, a started job lost without a reported failure files an unknown-cost
  spend row, and the interaction is deleted after download because
  `store: true` keeps the prompt and image at Google. Catalog constraints belong to `gemini-video-catalog.ts`;
  rates stay in `lib/spend/rates.ts`. The browser BYOK UI is
  `GeminiVideoWorkspace`. Duration, resolution and aspect ratio render through
  `ModelControls` (the same control fal and Kie use) because stacked native
  selects drifted from the dense duration + resolution row; Omni duration stays
  a discrete select of 3–10s (`"3s"`…`"10s"`) because Google rejects freeform
  lengths, and 1080p does not lock the length. Clip extension and first+last
  frame stay off this workspace: they need a video upload or a second still.
  Do not add Gemini video to `CLOUD_GENERATION_PROVIDERS` until the live check
  in `docs/superpowers/plans/2026-09-05-cloud-provider-enablement.md` — video is a
  long-running operation, not the synchronous image adapter, and
  `ai.files.download({ downloadPath })` is Node-only.

- **Provider balance, billing readout, or low-credit alerts** → first read
  `docs/codex/specs/2026-09-22-provider-billing-readout.md` and
  `docs/codex/account-development.md`. Keep provider reads in
  `lib/billing/provider-readout.ts` and show them separately from the spend
  ledger, because vendor balances and totals include activity outside this app.

- **Results when switching models** → first read `docs/codex/specs/2026-10-01-shared-model-results.md`. Keep the existing shared image feed; scope video results by provider and input mode, never by the selected model or most recent edit submission, because selection configures the next run and must not hide existing outputs. Read result labels and filenames from the producing job.
- **Video direction selection** → first read `docs/codex/specs/2026-10-02-compact-video-directions.md`. Use `VideoDirectionSelector` for the larger bordered direction tiles and delayed image/details preview, and `ProviderSelector` for compact provider choices so direction carries the visual emphasis; keep capabilities and selection in `VideoWorkspace`: all directions remain visible, incompatible engines are disabled, and selecting a direction resolves a compatible engine because engine choice must never silently change the requested direction. Hover must never change a selection.

- **Result ratings (👎 / Good / Great), library rating or model filters, group by prompt** →
  `lib/results/rating.ts` holds the one vocabulary both libraries use. Browser records carry
  `GalleryRecord.rating`; cloud assets carry `account_assets.rating` (migration 0015), set
  through `POST /api/account/assets/:id/rating` and filtered in `listAssets` inside SQL, before
  LIMIT, because filtering a fetched page hides older matches. Good and Great pin a browser
  record; a miss gives up its bytes first in `planEvictions` but keeps its record, since
  "this model missed" is the memory a thumbs-down exists for. "Reuse settings" selects the
  model through `reuseRun` (`lib/results/reuse-run.ts`) before replaying values, because the
  draft's controls are read against the selected model. A finished result rates the same
  record through `ResultRating`: pass a `RatingTarget` (`browserJobTarget(provider, jobId)` for
  jobs `recordFinishedJob` files, the captured record id for images and Gemini clips, the asset
  id for cloud runs) to `ResultStack` items or `FinishedVideoActions`.

- **Placing a clip on the timeline from outside it** (a result card, a library grid) →
  `placeClipOnTimeline` in `lib/timeline/place-clip.ts`, never `addClip` plus a bare toast.
  There is one timeline, so an add always joins the edit already there; the helper says
  which clip number it became, warns when the clip's shape differs from a set frame, and
  offers Undo. A bare "Added to the timeline" let a landscape clip land in a portrait edit
  unnoticed (UX audit H5, 2026-10-15). The timeline workspace's own rail keeps `addClip`,
  since the clip is placed in view there.

- **A card's secondary actions** (download, delete, reuse settings, last-frame tools) →
  `ActionMenu` behind a ⋯ button, one primary action left on the card; the cloud library
  card's is `CloudAssetMenu`. Paid steps (Finalize draft) stay on the card. Inside a modal
  the menu portals into the modal's panel, because `useAccessibleDialog` pulls focus back
  from anything outside it, and it catches Escape before the dialog would close the sheet.
  Last-frame save/copy/continue come from `useLastFrame`, so menu and button row decode alike.

- **A result's reference action in a mode with no reference slot** (text-to-image, search
  grounding) → pass `onEditImage` down `GenerationInterface` → `ResultStack`/`CloudJobPanel`/
  `KieGenerationWorkspace` → `ResultActions`, which then offers "Edit this image" and opens
  AI Image Editing with the result as its one source. "Use as reference" there filled a
  tray nobody could see and toasted success (UX audit H4).

- **No key for the image workspace's engine, or a stale error after switching** →
  `GenerationInterface` wraps its layout in the shared `ConnectionGate` (the engine row
  stays outside it, so switching is always possible) and passes `alternative`: a
  "Use Pollinations instead · free, no key" button, offered only in the browser, since a
  background Pollinations job still needs a saved connection. Every keyed engine is
  checked before the request, Gemini included; without that check a guest's first press
  came back "API key is required" twice with no way forward (UX audit H1). Engine and
  model changes call `clearSubmissionFeedback`, which also resets the mutation and any
  queued auto-retry, because the retry re-runs the request past the key check (H2).

- **A reference image whose shape the model cannot output** → `useAutoAspect` snaps to the
  nearest shape silently, so each workspace that uses it also renders `AspectMismatchNote`
  (text from `describeAspectMismatch` in `lib/draft/aspect-match.ts`) under its model
  controls. Veo offers only 16:9 and 9:16, and a square image was reframed with no word
  (UX audit M5).

- **A retired model** → mark it `deprecated` and set `replacedBy` to its successor's id
  (Gemini and fal image catalogs). The image workspace then shows `ReplaceDeprecatedModel`,
  a one-click switch, while the retired model is selected. Not a silent migration: it stays
  runnable and may have been picked on purpose, but a remembered Nano Banana 2 ran at twice
  2.1's price behind only a badge (UX audit M7).

- **A provider workspace's setup cards, generate button, or result panel** (fal, Kie,
  Runware/Atlas/Comet/PiAPI) → compose the shared pieces listed under "Already
  extracted" in `docs/ui-consistency-seeds.md` (`GenerateActions`, `WorkspaceCard`,
  `ModelControlsCard`, `ResultPanel`, `FinishedVideoActions`, `useModelControlValues`,
  `useEditReferenceDraft`, `prepareSubmissionMedia`). Keep only catalog, upload and
  submit logic in the provider file, because three hand-rolled copies drifted: the
  simulation label and the disabled-button reason reached one provider, and Kie
  uploaded a leftover draft reference on a text run.

- **Generate button placement** → first read `docs/codex/specs/2026-09-11-generate-under-prompt.md`. Use `GenerationWorkspaceLayout`’s `actions` slot for the button, cost, progress, execution notice and submission/retry feedback, because the shared prompt → actions → results order keeps submission next to the text being edited at every screen width. Setup holds only model, media and controls.

- **Describe a selected source into the prompt** → `lib/describe-source/` and
  `POST /api/describe-source`. The button is `DescribeSourceButton` on the
  provider video prompt. It sends the selected image or source video to a
  vision model and writes the paragraph into the draft prompt, which stays
  editable before Generate. Text mode builds an empty source list, the same
  way submit does, because a reference left in the draft from another mode is
  not part of that run. The shared text tier cannot see pixels, so this uses
  `VISION_MODEL` when `HF_TOKEN` is set and otherwise the visitor's Gemini key.
  A short clip is sent whole only when a Gemini key will watch it; otherwise,
  and for any clip that will not fit, `sampleVideoStills` turns it into ordered
  stills, because the shared vision model only reads images and a 100MB source
  cannot be the JSON body. The route rate-limits per address and checks
  `Content-Length` before parsing, because this call can spend `HF_TOKEN` on
  megabytes of vision input.

- **Seedance 2.5 draft, then finalize** → `lib/providers/seedance-draft.ts`.
  `settings.draft` is a 480p preview that returns `outputs.draftId`; finalize sends
  `inputs.draftId` and `resolution: "1080p"` and cannot resend prompt or media.
  That is not P-Video-Edit `draftRate`, which is a cheaper render with nothing
  to finalize. Draft defaults off for people and for agents. The studio
  remembers Seedance's toggle as `draftPreview` and P-Video-Edit's as `draft`,
  because one shared `draft` key turned the other model's cheaper mode on.
  Agents still send `values.draft`. `checkValues` forces 480p when that flag
  is on, so the catalog's 720p edit default can stay. An edit draft is priced
  from the clip's length, read from the file before the reservation;
  `finalize_draft` uses the length saved on that draft, whether the agent passes the jobId or a bare draftId (looked up on the account); a draftId with no saved job is reserved at 30 s and the costliest mode, because Runware's finalize sends only the draftId and an agent's claimed length undercharged the budget. The
  button and the agent budget use the documented 1080p rate and label it
  estimated: Runware does not publish a separate finalize price. A cost on
  the task still wins.

- **Edit an existing video** → first read `docs/codex/specs/2026-09-11-edit-video.md`. For P-Video-Edit, also read `docs/codex/specs/2026-09-11-p-video-edit.md`; edit limits and Draft pricing belong to `videoEdit` capabilities, because P-Video-Edit has fixed output dimensions and must not inherit Seedance resolution controls. Source clips use `sourceVideoId` in account requests and `inputs.video` at Runware, never the image reference array, because their validation, duration and retention differ. Edit rates live on the catalog capability; normal generation rates undercharge edits. The existing clip library picker accepts `onPickVideo` so selection cannot accidentally place a clip on the timeline. Edit is not Runware-only: fal Kling O1/O3 and Comet Aleph 2 use the same `videoEdit` block. fal edits stay on `FalGenerationWorkspace` and `/api/fal/*` (the source file is the last upload, because folding edit into image mode posted the clip to image-to-video). Aleph posts JSON to `/runwayml/v1/video_to_video` and polls `/runwayml/v1/tasks/{id}` via `cometPollRunway`, because `/v1/videos` is a different task. `maxImages: 0` swaps the reference tray for a note that the model takes no character images, and `editPromptShortcuts` writes the character in words; `@Image` in such a prompt is refused in the browser, the Worker and `cometCreateVideo`, because Comet's schema has no image field (only timed `keyframes`) and the edit would be billed against nothing. Source duration, pixels and bytes are refused in the picker and in `assertEditSourceLimits` before a job is reserved. Per-second edits are priced from the container length written onto `sourceDurationSeconds` before reserve, because a client-supplied length undercharges the ledger. Aleph's `rate.minimumUsd` is $0.448. `videoEdit.protocol: 'runway'` selects `cometPollRunway` and skips the production 12 MB inline gate, because that model is fetched by https URL. Its finished clip is served from Runway's CloudFront distribution `dnznrvs05pmza.cloudfront.net`, which capture allows by exact host in `lib/account/result-location.ts`; without it every Aleph job ends `result_location` after the money is spent. Atlas Wan 2.7 Edit likewise returns DashScope's bucket `dashscope-463f.oss-accelerate.aliyuncs.com`, allowed by exact host in the same file. Atlas Seedance 2.0 Fast returns ByteDance's ModelArk bucket `ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com`, also allowed by exact host. The same list gates `/api/download-video`, the browser's fallback for a result its CDN will not serve cross-origin, so a provider host missing there also breaks that fallback download.

- **YouTube clip import (edit source from a YouTube section)** → first read
  `docs/claude/specs/2026-10-13-youtube-clip-source-design.md` (its planning follow-ups
  override the body). `importYouTubeClip` in `cloud/src/youtube/import.ts` is the only
  import path: the browser route (`/api/account/youtube-clips`) and MCP
  `add_reference({ youtube })` both call it, because a refusal an agent reads and one a
  person reads must be the same check. The cut runs in a per-account Durable Object
  container (`YouTubeImporter`) because yt-dlp and ffmpeg need a real process; keep its
  logic in `importer-core.ts`, where it is testable without the Workers runtime. An
  imported clip is a one-use temporary input (`lib/account/staged-sources.ts`), because
  cleanup deletes an input once its jobs finish. Keeping it is opt-in (`saveToLibrary`):
  the clip is written once as a library asset (`cloud/src/youtube/library.ts`, room
  reserved before any byte is written so a full library falls back to temporary-only)
  and the edit source is a `copyAssetToUpload` copy of it, exactly like picking a library
  clip. Its asset metadata keeps the job-request shape (`local-test` / `youtube-clip`)
  and `assetView` lifts `origin` out of it, because every library reader expects
  `metadata` to be a job request. Every
  `new AccountError(` in that path stays on one line with a literal code, or
  `mcp-docs.test.ts` cannot check the guide.

- **Cloud library, imports, or spend** → first read `docs/codex/account-development.md`. Reuse `CloudAssetGrid` / `useAccountLibrary` for cloud files, `prepareReferences` for reference insertion, and `SpendReport` with the canonical spend resolvers for either ledger. Import controls read browser stores only after explicit selection; account requests must retain owner/epoch guards because a session can change during a file transfer. Two rules the cloud grid pays for when they are broken: **size gates go after `prepareReferences`, never before** — a cloud result is a full-resolution provider PNG and the conversion is what decides the payload, so gating on `asset.bytes` rejected every background-mode image the pipeline could have handled; and **it reports outcomes the way `GalleryGrid` does, in a toast**, because both grids sit behind the two tabs of one picker and an inline alert above a scrolled list is invisible at the moment it is written, which reads as a button that does nothing.
- **A job shown in the cloud library while it is still running** → `CloudJobCardGrid`, not
  `CloudJobList`, **on every surface that lists jobs** — the Account page's Active tab, the
  studio's library picker (`AccountLibrary`, browse mode) and the result rail (`CloudJobPanel`,
  one column) — because two of the three kept the text row and a running job read as a log
  line beside finished cards. Each surface splits `isActiveJob` jobs to the card grid and leaves
  the rest to `CloudJobList`. The rail's own spinner frames are dropped while a card is up, since
  they said the same thing twice. The library's two job tabs deliberately have two shapes: work in flight is the
  library's own content arriving, so it takes the same card, grid and meta-line order as
  `CloudAssetGrid` (the breakpoints live in `components/account/library-grid.ts`, shared by both,
  because a running job laid out on its own rhythm reads as a different screen on the same page);
  work waiting on a person is a paragraph of explanation and a decision, which stays a row. The
  card's progress bar is **indeterminate on purpose** — no provider in the catalog reports a
  percentage, so it steps through `JOB_STATE_LABELS` with a travelling highlight and carries
  `aria-valuetext` with no `aria-valuenow`; a fabricated 43% would be the one thing on that card
  that is not true. The thumbnail well is `JobWaveField`: a 16 × 9 field of short strokes swinging out of
  step, so it reads as a frame that is about to exist rather than a spinner. It swings on a
  1.12 s beat (sped up 5× on 2026-10-14 at the owner's request, from 5.6 s); the per-stroke
  delays in `JobWaveField.tsx` scale with that beat, so change both together or the wave
  loses its shape. It is
  SVG + CSS with nothing running per frame; under reduced motion it freezes on its resting
  angles, which is still a picture, and the bar still reports the stage.
- **A completed result blocked by its download address** → first read
  `docs/codex/specs/2026-10-01-provider-result-recovery.md`. Capture's host policy lives
  in `lib/account/result-location.ts`; `canRetryResultLocation` re-evaluates old failures
  against it, because approving a host must also unblock existing jobs. Browser-only
  recovery links are exposed by the owner-authenticated `/jobs/:id/recovery` read,
  never by job lists or a server fetch proxy. `ProviderResultRecovery` guards the
  account epoch, because a late response can otherwise expose another account's file.

- **Failed-job diagnostics** → `components/account/JobFailureDetails.tsx` and
  `docs/codex/specs/2026-10-12-actionable-job-errors.md`. Use `failureSummary` for
  the two short scan lines and `failureNextStep` inside the disclosure; preserve sanitized app-authored capture errors inside the
  failing step, because the outer transition loses their specifics. Never copy
  signed URLs or prompts into the diagnostic report. Older missing details stay
  explicitly unknown rather than being reconstructed.

- **A job stuck in "Needs attention", or copy about why one stopped** → the reason lives in
  `lib/account/job-failure.ts`, not in `error_code`. `error_code` names the arm of the runner that
  gave up, so one `save_failed` covered an expired provider link, an oversized clip and a transient
  blip — which is why the row could only say "needs another attempt" and offered a Resume that
  repeated the same 404 forever. The shared module owns the vocabulary, the sentence per reason and
  the `RECOVERABLE` set; `cloud/src/failure.ts` imports that set rather than copying it, **because
  it is what enforces the copy** — a reason recoverable in one and not the other is a Resume button
  the Worker answers 409 to. Three rules the Worker pays for when they are broken: classify inside
  the failing `step.do`, since past that boundary the `AccountError` prototype is gone and only a
  flattened message survives; write the reason with `recordFailure` and let `setJobState`/`finishJob`
  `COALESCE` it, because the coarse transition always runs last and a plain assignment erases the
  only useful thing on the row; and put provider text through `sanitizeProviderMessage` — it is the
  one string in the pipeline we did not write, and a vendor can echo a request that carries a key.
  Stopping tracking removes the row in the same D1 batch (`dismissAttentionJob(..., remove)`), opt-in
  from the request body so the browser and Worker can deploy in either order. Adding a column here
  needs both `cloud/migrations/` **and** the `LOCAL_SCHEMA` catch-up in `cloud/src/schema.ts`, since
  `CREATE TABLE IF NOT EXISTS` is a no-op on an existing local database.

- **Browser → cloud import, or test data for it** → the picker is
  `components/account/BrowserImportDialog.tsx` over the `use-asset-import` hook; the hook owns the
  transfer loop, the stable per-file client id that makes a retry idempotent, and the owner/epoch
  check between files, so never re-implement the loop in a panel. To get a local library to import,
  paste `scripts/seed-browser-gallery.js` into DevTools on localhost:3097 — it cannot be a Node
  script like `seed-account-demo.mjs`, because IndexedDB is scoped to one origin in one browser
  profile and is unreachable from outside the page.

- **A feature that renders locally but is missing on the deployed site** → suspect the
  Worker before the component. Both halves now deploy on a push to `main` — Vercel
  through its Git integration, the account Worker through
  `.github/workflows/deploy-account-worker.yml` — but they are still two deploys that
  can disagree: the workflow only fires for `cloud/**` and `lib/**`, it stops rather
  than applying a pending D1 migration, and it can simply have failed. Check its run
  before reading the component, because the browser can still run
  a commit whose API is not live yet — and a *missing* response field is not an error:
  the payload still parses and the UI takes its empty branch, which is why the library
  filter pills and the spend total vanished in production on 2026-09-06 while both were
  correct on localhost. Compare `npx wrangler deployments list` in `cloud/` with
  `git log -S<field>` before reading the component. See `docs/deployment.md`.

- **A merged PR adds a file under `cloud/migrations/`, or the "Deploy account Worker" run
  failed at "Check for unapplied D1 migrations"** → the production database needs the
  migration, and a person applies it. The workflow only reports a pending migration and
  never applies one, because a schema change is the one deploy step a redeploy cannot
  undo; until it is applied the Worker stays on its old version while Vercel already
  serves the new browser, so the new feature's requests fail in production (PR #24's
  ratings sat in that state on 2026-10-28). Agents tell the person and ask before running
  step 2. From the repository root:
  1. `pnpm --dir cloud exec wrangler d1 migrations list scene-assembly-accounts --remote` —
     names what is pending. Read each file first: if it drops or rewrites a column, stop
     and plan the order with the person, since only an additive change (a new nullable
     column, a new table) is safe to apply before the Worker that reads it.
  2. `pnpm --dir cloud exec wrangler d1 migrations apply scene-assembly-accounts --remote` —
     confirm the prompt. "Not authenticated" means `pnpm --dir cloud exec wrangler login`;
     "More than one account available" means prefixing
     `CLOUDFLARE_ACCOUNT_ID=7f64edc36bdefec27b66e6ff9b2dcc3d` (Rapid Systems).
  3. Re-run the failed deploy:
     `gh run rerun <run-id> --failed --repo vmyazin/scene-assembly` (find the id with
     `gh run list --workflow deploy-account-worker.yml -L 3`; prefix
     `GH_TOKEN=$(gh auth token --user vmyazin)`, because the active gh account cannot
     write here). Then confirm the run reaches its `/health` check.
  Migration first, Worker second, always: the Worker queries the current schema on its
  first request. The full runbook is "Deploying the account Worker" in
  `docs/deployment.md`.

- **"Background generation is not available for this provider"** → that message is
  configuration, not a missing adapter. `CLOUD_GENERATION_PROVIDERS` in
  `cloud/wrangler.jsonc` is the only gate; `enabledProviders` filters it against
  `CLOUD_PROVIDERS` and the Worker reports the result to the browser, so a
  provider is unavailable until it is named there *and the Worker is redeployed* —
  editing the file alone changes nothing. A provider joins that list only after the
  live check in
  `docs/superpowers/plans/2026-09-05-cloud-provider-enablement.md`, because a paid
  submission is not idempotent and an untested adapter fails after the money is
  spent. Any UI that asks for a provider key must read the account connection when
  `cloudWorkspace.cloud` is true, never the browser key.
- **A cloud asset's download filename** → go through `lib/account/asset-name.ts`, which
  reuses the guest slug request (`requestPromptSlug`) and `downloadFilenameBase`, so
  account downloads read `<slug>-<model code>.<ext>` like guest ones. The slug is warmed
  in `useCloudWorkspace` when the job is accepted and requested lazily on a library
  download; never name a file after an asset id, and never send the browser Gemini key
  from the cloud path.
- **Signed-in generation** → reuse `useCloudWorkspace`, `CloudExecutionNotice`, `CloudJobPanel` and `CloudJobList`; keep account jobs in the memory-only `useAccountStore`, never a guest job store. Pass `storage="account"` to `ConnectionGate` for cloud execution so its key-storage explanation stays accurate. Prompt-library recording for cloud jobs lives in `useCloudWorkspace.submit`, not in the workspace, because every workspace's cloud branch returns early and the four copies of `remember()` below those returns were all skipped.
- **The last prompt after a reload** → `useDraftStore` persists only `prompt`, `promptScope` and `promptByScope` (key `scene-assembly-draft-prompt`), never references or control values, because File handles and object URLs do not serialize. Hydration is deferred and kicked from `StudioHeader`; its storage skips writes until hydrated and `mergeSavedPrompt` keeps whatever a workspace claimed or restored first, because a workspace enters its scope on mount before the header's effect, and an early write would replace the saved prompt with an empty one.
- **A link from a background job to where it is looked at** → `lib/account/job-location.ts`
  is the one answer, because a job has two homes and the wrong one is a dead end. While it
  runs, that is the studio form it was started from — the `CloudJobPanel` matching its
  provider / modelId / mediaType / inputMode — and the URL carries only the workspace and
  mode (`?feature=…`, `?workspace=video&videoMode=…`), so the link's `onClick` must also
  write engine and model into `useAppStore` or the panel filters for a provider nobody
  selected. Once saved, it is the asset, reached as `/account#asset-<id>` and joined
  through `CloudAsset.jobId` — never through matching metadata, which two runs of the same
  prompt share. `AccountConsole` reads that hash (and `#jobs`) in a state initializer *and*
  in a mount effect: an in-app click is a `history.pushState` that fires no `hashchange`
  and lands after the first render, so the initializer alone silently ignored every link
  clicked from inside the app. Spec:
  `docs/claude/specs/2026-09-21-queue-finished-jobs-design.md`.
- **Accounts, sign-in, or cloud persistence** → first read `docs/codex/account-development.md` and `docs/codex/specs/2026-09-04-optional-cloud-accounts-design.md`. Authentication entry pages live at `/sign-in` and `/sign-up`; signed-in management lives at `/account`, composing the existing account panels. Do not add account calls to action to the existing studio layout. The legacy admin gate is separate because enabling it would block guest routes.
- **Agents connecting over MCP, their budgets, or the consent page** → first read
  `docs/claude/specs/2026-09-28-agent-mcp-design.md` (its Follow-up decisions override its
  body) and `docs/claude/plans/2026-09-28-agent-mcp.md`. The server is `cloud/src/mcp/`, and
  every tool calls the functions the `/api/account/*` routes call (`acceptJob`, `resumeJob`,
  `listAssets`, `listSpend`, `readAccountBilling`) — never a copy — because a refusal an agent
  reads and one a person reads must be the same check. Model settings come from
  `lib/account/model-schema.ts` and prices from `lib/spend/estimate.ts`, which *is* the ledger's
  `buildAccountSpendEntry`; `cloud/tests/model-schema.test.ts` sends every advertised model,
  mode and option through `validateRequest`, so when it fails, narrow the descriptor rather
  than loosen a validator. The `account_agents` row, not the OAuth grant in KV, decides
  whether a token still works, which is why disconnecting is immediate. A charge is released
  only when the provider certainly never ran the job. Test tools through a real MCP client
  wired to `serveMcp` (`cloud/tests/mcp-harness.ts`), never hand-written JSON-RPC: the SDK
  serves two protocol eras and a hand-rolled request tests only one. A new tool or refusal code
  also needs a line in the public guide, `app/docs/mcp/guide.md` (served at `/docs/mcp` and
  `/docs/mcp.md`), because agents are told it lists every one; `cloud/tests/mcp-docs.test.ts`
  scans the tool list and the refusal codes and fails on anything the guide leaves out.

- **Video generation workspace layout** → first read
  `docs/codex/specs/2026-08-30-wan3-reference-video-design.md`, then compose setup,
  Prompt, and Result/Jobs through `components/GenerationWorkspaceLayout.tsx` because
  provider-owned column markup previously let Prompt drift between pages.
- **Image/video generation prompt input** → reuse
  `components/AutoExpandingPrompt.tsx` because local textarea sizing made prompt
  height and scroll behavior diverge between providers.
- **Image/video generation prompt section** → wrap the existing prompt header and
  `components/AutoExpandingPrompt.tsx` in `components/PromptPanel.tsx`. The wrapper
  owns the richer surface, decorative perimeter runner, and textarea-focus pause;
  provider pages must not recreate that timer or animation because repeated local
  implementations drift in timing, focus behavior, and reduced-motion handling.
- **A workspace that cannot run without credentials** → wrap the workspace layout
  in `components/ConnectionGate.tsx` and pass `paused={gated}` (from its exported
  `isGated`) to `PromptPanel`. The gate owns the whole not-connected state —
  `ConnectKeyCallout` above the controls, the dim, the `inert`, and the
  click-anywhere target that opens the key dialog — because Kie, fal, and the
  aggregators each used to answer "no key yet" differently and a person switching
  providers had to relearn the page. Never gate a rail that already holds finished
  jobs (`hasFinishedWork`): a key can be cleared after a clip lands, and the
  download has to stay reachable. The header keeps only its connected-state status
  button, named `<provider label> key connected`, so the same ask is not made
  twice. Vendor key pages come from `lib/providers/key-source.ts`, and the dialog
  opens through `onOpenConnections(<engine id>)` so `ApiKeyConfig`'s
  `focusProvider` outlines that card and focuses its field.
- **A `<video>` a viewer can rest a pointer on** → spread `useHoverPlay()` from
  `lib/media/use-hover-play.ts` onto it (`<video {...hoverPlay} />`), never a local
  hover timer. One hook keeps the rule the same everywhere: a second of rest before
  a muted preview starts, so a pointer crossing a grid never lights up eight clips;
  hand-over the moment the viewer unmutes or pauses; nothing on touch or under
  reduced motion. `tests/media/hover-play-adoption.test.ts` lists the files and
  fails on a bare `<video>`; the timeline preview is the one deliberate exception.
- **Anything dropped onto the timeline** → the payload contract is
  `lib/timeline/drag.ts`, and the two drops that do not land on an existing clip
  (an empty timeline, the space past the last clip) are
  `components/TimelineDropZone.tsx`. Two gestures share one `DataTransfer` and
  must never be confused: dragging a **block already on the timeline** is a move
  that reorders (`text/plain` = placement id), while dragging a **clip out of the
  rail** is a copy that inserts (`TIMELINE_RECORD_MIME` = record id). Every drop
  target asks `droppedRecordId` first and falls through to reorder, because a
  record id handed to `moveClip` matches no placement — so a mixed-up drop fails
  silently rather than loudly. **Where it lands** is a seam, not a clip: the wide
  track overlays a drop target on each block boundary (`track-seam-<i>`, offset
  from `TrackBlockLayout.x`) plus a tail zone, because blocks butt together on a
  pixel-exact time scale and "on a clip" cannot say before-or-after. Those seams
  are absolutely positioned and mounted only while `useRecordDragActive()` is
  true — taking real layout space would shift every block and desynchronise the
  ruler and playhead, and a permanent overlay would eat the reorder drags, trim
  handles and remove buttons underneath. Two rules the browser enforces and jsdom does not:
  ask **`types`, never `getData`, during dragover** (the payload is protected
  until the drop, so a value check never highlights), and `preventDefault` only
  for a drag you can actually use, or the zone swallows every file and link
  dropped on it. A drop must route through `TimelineWorkspace`'s `onAdd`, never
  the store directly — the workspace owns acquisition, and a placement added
  behind its back has no media, no duration and no way into an export.
- **The track's time scale, or zooming it** → everything on the track (blocks,
  ruler, playhead, scrubbing, the drag seams) reads pixels-per-second out of
  `buildTrackLayout`, so change the scale there and never in a component.
  `computePps` **fits**: the default view never lays the track out wider than
  its container, and `MAX_PPS` is the only bound left because it can only make
  the track narrower. The old floors (`MIN_PPS`, and one keeping the shortest
  clip's trim handles grabbable) are gone from that path — they made a timeline
  open already scrolled, hiding clips the viewer has no reason to know are
  there, and zoom now answers "too small to work with" while nothing answers
  "you cannot look for what you do not know is missing". `MIN_PPS` survives
  only for a track that cannot be fitted at all (untimed blocks already
  overflowing). Zoom is a *multiplier over that fit* (`MIN_ZOOM` 1 = fit, and
  the floor: at fit everything is already on screen), applied after
  `computePps` so it deliberately escapes `MAX_PPS` — that bound answers "how
  far should this stretch when nobody asked", and a pinch has asked. Untimed blocks keep
  `UNTIMED_BLOCK_WIDTH` at every zoom because they represent no time. The
  gesture lives in `lib/timeline/use-track-zoom.ts`, and its non-obvious half is
  the **anchor**: a zoom that only rescaled would slide the clip you were
  looking at off screen, so the instant under the gesture is recorded and
  restored in a `useLayoutEffect` once the new width exists (a passive effect
  paints one frame at the wrong offset). Anchor on *time*, never on a fraction
  of content width — untimed blocks make width non-uniform and a ratio drifts.
  `wheel`/`touchmove` are attached natively with `passive: false` because both
  must `preventDefault` or the browser zooms the page instead, and the scroller
  needs `touch-pan-x` to keep one-finger panning while claiming the pinch.
- **Audio in a browser export** → `lib/timeline/render/webcodecs.ts` drives its own
  `AudioEncoder` into an `EncodedAudioPacketSource`, and never `AudioBufferSource`,
  because that source encodes and muxes in one step: its packets are in the file
  before the video endpoint is known, and AAC's 1024-sample grid does not land on
  that endpoint — which is how a twelve-second timeline shipped a 12.074667 s
  container around a 12.000000 s video stream. The cut happens at the mux boundary
  (`lib/timeline/render/audio-endpoint.ts`), against `emittedTotal / fps` read after
  the video flush, never against the running total: mid-export that number is a
  lower bound, so only packets it already covers may be muxed early and the rest is
  held. Do not compensate the AAC priming delay and do not shift audio timestamps
  to make a boundary land on a packet — see the priming comment in that file and
  `docs/codex/specs/2026-09-09-export-audio-endpoint.md`.
- **A Gemini image model, its price, or its limits** → `lib/engines/gemini-catalog.ts`
  is the one list, and `lib/spend/rates.ts` holds a rate block per model id. One
  Google AI Studio key runs all three Nano Banana models at a fourfold price
  spread, so the id has to travel with the run: the download name, the job
  label, and the ledger entry each ask the catalog which model produced the
  image, and a Lite run filed at the Pro rate is wrong by 4x. Capabilities are
  per model, not per engine — Lite publishes 1K alone and refuses the
  `googleSearch` tool — and both the browser and
  `cloud/src/provider-adapters/synchronous.ts` narrow a request to what the
  chosen model accepts, because a rejected enum costs a whole paid submission.
  The 512px tier is deliberately absent: Google's own page spells that
  parameter three different ways. Spec:
  `docs/superpowers/specs/2026-09-09-gemini-image-model-choice-design.md`.
- **An image result panel** → render `components/ResultStack.tsx` rather than
  laying out cards inline. It owns the 4-item display cap, the per-card download
  and fullscreen, and the lightbox — a panel that keeps its own `lightboxOpen`
  boolean cannot say *which* of several results is open. Feed it
  `useImageResultFeed()` (`lib/results/image-feed.ts`), never a per-engine or
  per-model slice: the image feed is one session-wide list across every engine,
  because filtering by the engine on screen hid every earlier result the moment
  someone switched provider to compare. New local results go into
  `useImageResultsStore`; Kie's come from its job store. Download cards through
  `downloadImageResult` (`lib/results/download-image.ts`), since any panel can be
  showing any source's URL. The signed-in `CloudJobPanel` does the same for
  images; video stays scoped to the selection because it shows a single clip.
- **Anything that re-encodes image bytes** → read
  `docs/superpowers/specs/2026-08-31-image-format-conversion-design.md`, then go
  through `lib/image/convert.ts`. Never call a canvas encoder directly: it must
  never grow a file, never re-encode what is already in the target format, never
  put a transparent source into JPEG, and never name a file after a format the
  browser silently declined to produce. Conversion is an optimization, so every
  failure path returns the original bytes rather than throwing.
- **A new place image bytes enter or leave the app** → hook the existing
  chokepoints rather than adding a fifth: `prepareReferences`
  (`lib/draft/ingest.ts`) in front of `useDraftStore.addReferences`,
  `convertedForDownload` (`lib/image/download-format.ts`) on the way to an
  anchor, and `useGalleryStore.record`/`keep` for the library. Every provider
  reads `DraftReference.file`, so the ingest hook covers all of them at once.
- **A generation that can fail at submission** → schedule the next attempt with
  `useAutoRetry` (`lib/providers/auto-retry.ts`) and render the countdown through
  `components/SubmissionError.tsx` (or `RetryCountdown` where the workspace owns
  its own error box). Never gate the retry on the message text: throw
  `RouteError` from the browser client so `isRetryableFailure` can read a status,
  because a bad key and a 503 read alike as sentences and only one of them is
  worth sending again. Ten seconds, five attempts, cancellable — the numbers live
  only in that module. Spec:
  `docs/superpowers/specs/2026-09-03-generation-auto-retry-design.md`.
- **Anything that costs money, or a new place a generation finishes** → file it
  through `lib/spend/capture.ts` next to the gallery record, and price it with a
  resolver in `lib/spend/resolve.ts` that labels the figure exact, estimated, or
  unknown. Rates live only in `lib/spend/rates.ts` and the catalog's `rate`
  field, because a number pasted into a component drifts from the vendor page
  it came from and nobody can tell which run it applied to. Capture never
  throws: the generation it describes has already succeeded. Spec:
  `docs/superpowers/specs/2026-09-03-spend-dashboard-design.md`.
- **A PR that changes user-visible UI** → take a screenshot of the worked-on UI
  from the running app and **embed it inline** in the PR description under
  **UI screenshot**, using markdown image syntax
  `![descriptive alt text](https://…actual-image-url…)`. Host the PNG where
  GitHub can fetch it without a Cursor login: commit it on the PR branch
  (e.g. `docs/pr-screenshots/`) and use
  `https://raw.githubusercontent.com/<owner>/<repo>/<branch-or-sha>/…/file.png`,
  or a `user-images.githubusercontent.com` / `github.com/user-attachments`
  URL. Crop to the changed control when that is the whole change. **Do not**
  use Cursor agent artifact page links (`cursor.com/agents/…/artifacts?path=…`)
  as a substitute — GitHub renders those as text links, not images. Reviewers
  should not have to check out the branch to see selected-state color, density,
  or alignment. Skip only when there is nothing to look at (docs, rates,
  Worker-only API). This is not the changelog screenshot gate further down,
  which stays conservative; a UI PR still needs the picture even if the
  changelog would skip it.

## Session workflow (worktree → smoke-test → ship → wipe)

Assume several agent sessions run against this repo in parallel. The main checkout
must stay clean — never accumulate uncommitted work there.

1. **Start every task in a fresh worktree:** `git worktree add .claude/worktrees/<task-slug> <main-branch>`.
   All edits, typechecks, tests, and dev servers happen inside it.
2. **Pick non-default ports** so parallel sessions don't collide. Keep a registry of
   run configurations (`.claude/launch.json` or equivalent) with a named entry per
   scenario, including the worktree ports.
3. **Smoke-test before shipping.** Then **hand the user the localhost link to the
   affected page** and get an explicit go-ahead. A push to `<main-branch>`
   auto-deploys, so treat this as a hard gate: never ship a UI or behavior change you
   only typechecked. Docs-only changes have nothing to run — say so and skip.
4. **Ship after sign-off:** `git fetch && git rebase origin/<main-branch>` (it moves
   often), then push.
5. **Then stop the servers and remove the worktree.** Don't end a session with work
   uncommitted or unpushed.
6. **If `git status` in the main checkout is dirty, that's another session mid-task.**
   Leave those hunks alone.

If a fresh worktree lacks `node_modules` (hoisted deps) or gitignored dev vars,
document the exact symlink/copy commands to wire it up — an agent should not have to
rediscover them. For this repo, from inside the new worktree:

```sh
pnpm install --frozen-lockfile --prefer-offline   # ~4s; pnpm hardlinks from the shared store
pnpm --dir cloud install --frozen-lockfile        # the Worker is a separate pnpm project
cp ../../../.env.local .env.local          # gitignored dev keys
cp ../../../next-env.d.ts .                # gitignored; without it tsc can't type image imports
cp ../../../public/thumbnails/*.jpg public/thumbnails/ 2>/dev/null || true  # gitignored local assets
cp cloud/.dev.vars.example cloud/.dev.vars # then set DEV_FAKE_GENERATION=1 for credential-free jobs
```

If either `pnpm install` fails in sharp's install script with "Please add node-addon-api to
your dependencies", sharp found a global libvips and tried to build from source; rerun the
same install with `SHARP_IGNORE_GLOBAL_LIBVIPS=1` in front.

Turbopack's on-disk cache does not see edits made inside `.claude/worktrees/` after
the dev server has started: a CSS change stayed absent from the served stylesheet
across a server restart and only appeared after `rm -rf .next` in the worktree (found
2026-10-16). Before trusting a smoke test of an edit made while the server ran, stop the
server, delete the worktree's `.next`, and start it again.

Install rather than symlink `node_modules`: `ln -s ../../../node_modules` still
satisfies `tsc` and `vitest`, but Turbopack treats the worktree as its filesystem
root and fails `next build` with "Symlink [project]/node_modules is invalid, it
points out of the filesystem root". An absolute symlink fails the same way, so a
symlinked worktree cannot verify the production build.

## Local development must be full-fidelity and credential-free

- `npm run dev` (one command) must bring up the whole system with local emulation of
  every backing service. No cloud account, no login, no shared staging environment.
- **Zero-seed bootstrap:** schema creation runs on first request, so a wiped local
  state still works. Document how to create the first record via `curl` for anything
  that can't bootstrap itself.
- **Auth bypass, tightly gated:** honor a dev identity var from a gitignored
  `.dev.vars` (checked-in `.dev.vars.example`), gated on a signal that *cannot* be
  present in production. Document the failed alternatives — e.g. a `Host ===
  localhost` check does not work under a dev proxy that serves the production Host, so
  gate on an origin var pointing at localhost instead. Never set the bypass var as a
  production secret.
- **Give production-only routing a local equivalent.** If a dimension lives in the
  hostname in prod (tenant subdomains), accept it as a query param locally, pin it in
  a cookie so subsequent links stay scoped, and gate that on the same localhost
  signal. Make in-page links respect it so nothing bounces the agent to production
  mid-test.
- Document the local *divergences* explicitly: which services aren't shared between
  processes, which auth paths have no bypass, and which features need a real key.

## Spec → plan → execute

For anything beyond a small edit, write two documents under `docs/<agent>/`, named
`YYYY-MM-DD-<slug>`:

- **Spec** (`specs/`): Context, Goals, **Non-goals**, and an explicit *scope and
  implementation boundary* naming which function/file the change lives inside and what
  it must not touch. Mark it `Status: Approved design` and treat it as the acceptance
  source.
- **Plan** (`plans/`): a **File map** with `path:line-range` targets and a literal
  "do not modify" list, then tasks broken into `- [ ]` checkbox steps, each naming the
  files it creates/modifies and the command that verifies it.
- Amend rather than rewrite: when a decision is superseded, add a dated **Follow-up
  decision** note at the top saying which task it overrides. The plan is a record, not
  just a queue.

## Repo-specific overlays for generic skills

When a generic skill or checklist would otherwise re-derive the same conclusions:

- Keep a **seeds file** that states the scan roots, the repo's canonical patterns
  (with the reference implementation's file and symbol), and a **baseline list of
  things already extracted** — with the instruction: *do not propose re-creating
  anything listed here.*
- Prefer executable seeds: put the actual `rg` commands in the doc, each with a
  comment explaining what a hit means. The agent runs the query instead of inventing
  one.

## Gates as decision checklists with a bias to "no"

For any recurring judgment call where an agent's default is to over-produce, encode an
ordered checklist where **one "no" ends it**, plus a hard cap. Example, for whether a
changelog entry gets a screenshot: can you name the URL and the element? does the
picture carry something the sentence can't? is it visible at rest? does the seeded demo
data show it honestly? — plus "at most one or two per batch" and "never ship the same
screen twice."

**Never generate demo artifacts from production data.** Screenshots and samples come
from a checked-in seed script against a local server. If showing a change would require
inventing fake people or orgs beyond the seed, skip it.

## Shipping safety

- Path-filter deploy triggers so doc/marketing pushes don't redeploy, and comment
  which paths are bundled at build time and therefore *must* trigger one.
- Use a non-cancelling concurrency group — let an in-flight deploy finish rather than
  killing it mid-upload.
- Comment any ordering dependency between deploy steps at the step itself.

## Pull requests

- **When a PR changes user-visible UI, include a screenshot of the worked-on UI
  in the PR description as an inline embedded image.** Use markdown
  `![descriptive alt text](https://…actual-image-url…)`, not `[label](url)`
  text links. The URL must be GitHub-visible without Cursor login: a committed
  PNG on the PR branch via
  `https://raw.githubusercontent.com/<owner>/<repo>/<branch-or-sha>/…/file.png`,
  or a GitHub attachment host (`user-images.githubusercontent.com`,
  `github.com/user-attachments`). **Do not** use Cursor agent artifact page
  links (`cursor.com/agents/…/artifacts?path=…`) — GitHub does not render those
  as images. Crop to the changed control when that is the whole change; put the
  embed under a **UI screenshot** heading. Skip only for changes with nothing
  to look at (docs, rates, Worker-only API).

## Commits

- Provide a concise commit message after modifying code; don't commit unless asked.
- For a follow-up request, offer two messages: one covering all changes, one covering
  only the last request.
- No agent attribution or "Generated with …" signature in commit messages.
