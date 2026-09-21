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

- **Gemini / Veo video generation** → first read
  `docs/cursor/specs/2026-09-21-gemini-veo-video-generation.md`. Start, poll, and
  download live in `lib/engines/gemini.ts` (`generateVideos`,
  `getVideosOperation`, then GET `video.uri` with the API key). Catalog
  constraints belong to `gemini-video-catalog.ts`; rates stay in
  `lib/spend/rates.ts`. The browser BYOK UI is `GeminiVideoWorkspace`. Duration,
  resolution and aspect ratio render through `ModelControls` (the same control
  fal and Kie use) because stacked native selects drifted from the dense
  duration + 720p/1080p row; Veo duration stays a discrete select because
  Google rejects freeform lengths, and 1080p still locks to 8s. Do not add
  Veo to `CLOUD_GENERATION_PROVIDERS` until the live check in
  `docs/superpowers/plans/2026-09-05-cloud-provider-enablement.md` — video is a
  long-running operation, not the synchronous image adapter, and
  `ai.files.download({ downloadPath })` is Node-only.

- **Generate button placement** → first read `docs/codex/specs/2026-09-11-generate-under-prompt.md`. Use `GenerationWorkspaceLayout`’s `actions` slot for the button, cost, progress, execution notice and submission/retry feedback, because the shared prompt → actions → results order keeps submission next to the text being edited at every screen width. Setup holds only model, media and controls.

- **Edit an existing video** → first read `docs/codex/specs/2026-09-11-edit-video.md`. For P-Video-Edit, also read `docs/codex/specs/2026-09-11-p-video-edit.md`; edit limits and Draft pricing belong to `videoEdit` capabilities, because P-Video-Edit has fixed output dimensions and must not inherit Seedance resolution controls. Source clips use `sourceVideoId` in account requests and `inputs.video` at Runware, never the image reference array, because their validation, duration and retention differ. Edit rates live on the catalog capability; normal generation rates undercharge edits. The existing clip library picker accepts `onPickVideo` so selection cannot accidentally place a clip on the timeline.

- **Cloud library, imports, or spend** → first read `docs/codex/account-development.md`. Reuse `CloudAssetGrid` / `useAccountLibrary` for cloud files, `prepareReferences` for reference insertion, and `SpendReport` with the canonical spend resolvers for either ledger. Import controls read browser stores only after explicit selection; account requests must retain owner/epoch guards because a session can change during a file transfer. Two rules the cloud grid pays for when they are broken: **size gates go after `prepareReferences`, never before** — a cloud result is a full-resolution provider PNG and the conversion is what decides the payload, so gating on `asset.bytes` rejected every background-mode image the pipeline could have handled; and **it reports outcomes the way `GalleryGrid` does, in a toast**, because both grids sit behind the two tabs of one picker and an inline alert above a scrolled list is invisible at the moment it is written, which reads as a button that does nothing.
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
- **Accounts, sign-in, or cloud persistence** → first read `docs/codex/account-development.md` and `docs/codex/specs/2026-09-04-optional-cloud-accounts-design.md`. Authentication entry pages live at `/sign-in` and `/sign-up`; signed-in management lives at `/account`, composing the existing account panels. Do not add account calls to action to the existing studio layout. The legacy admin gate is separate because enabling it would block guest routes.

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
  boolean cannot say *which* of several results is open.
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
  from the running app and put it in the PR description under **UI screenshot**.
  Crop to the changed control when that is the whole change. Reviewers should
  not have to check out the branch to see selected-state color, density, or
  alignment — a class-name diff cannot show those. Skip only when there is
  nothing to look at (docs, rates, Worker-only API). This is not the changelog
  screenshot gate further down, which stays conservative; a UI PR still needs
  the picture even if the changelog would skip it.

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
  in the PR description.** Crop to the changed control when that is the whole
  change; embed it under a **UI screenshot** heading so reviewers see the screen
  without digging through commits. A layout or selected-state change that only
  exists in class names cannot be reviewed from the diff. Skip only for changes
  with nothing to look at (docs, rates, Worker-only API).

## Commits

- Provide a concise commit message after modifying code; don't commit unless asked.
- For a follow-up request, offer two messages: one covering all changes, one covering
  only the last request.
- No agent attribution or "Generated with …" signature in commit messages.
