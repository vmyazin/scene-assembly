# YouTube clip as an edit source

Status: Approved design (pending written-spec review)
Date: 2026-10-13

## Context

Edit video (`docs/codex/specs/2026-09-11-edit-video.md`) restyles a source clip with
Seedance 2.5 video-to-video: same motion, timing and framing, new look or characters.
Today the source comes only from the device or the library. Creators often want to
restyle a few seconds of a video they found on YouTube, which means downloading it,
trimming it in another tool and uploading it, all outside the app.

This feature takes a YouTube link plus From/To markers, cuts that section on the
server and stages it as the edit's source. Nothing downstream of the source changes:
the job, estimate, spend ledger and input cleanup are the existing edit pipeline.

Downloading from YouTube is outside YouTube's Terms of Service. The feature is
therefore limited to signed-in accounts, keeps the footage only as a temporary input
(never in the library), and always labels the source with its origin and range.

Neither Vercel nor the account Worker can run `yt-dlp` and `ffmpeg`, so the cut runs
in a Cloudflare Container bound to the account Worker. YouTube routinely refuses
datacenter IPs with a bot check, so the container egresses through a residential
proxy whose URL is a Worker secret.

## Goals

- A **From YouTube** source option in Edit video for signed-in (cloud) workspaces,
  with YouTube's own embedded player for choosing markers.
- A server import that downloads only the selected section, at 720p or above, and
  stages it as an ordinary `account_uploads` row usable as `sourceVideoId`.
- The same import for agents, as a third option on the MCP `add_reference` tool.
- One import function behind both the browser route and the MCP tool, because a
  refusal an agent reads and one a person reads must be the same check (the rule in
  `docs/claude/specs/2026-09-28-agent-mcp-design.md`).

## Non-goals

- Guest (browser-only) mode. There is no Worker to import through.
- Saving imported clips to the cloud library, or re-using one beyond its 24-hour input
  lifetime.
- Reference-video / motion-transfer generation (a new input mode), or using a YouTube
  clip as anything other than an edit source.
- Vimeo, TikTok or any other site.
- Changes to the edit job pipeline, the edit adapters, the catalog's edit capabilities
  or pricing.
- Server-side source-duration validation in `acceptJob` for non-YouTube sources (a
  real gap, noted under Follow-ups, but separate work).

## Architecture

```
Browser: Edit video › Source › From YouTube (YouTubeClipDialog)
  │ POST /api/account/imports/youtube {url, startSeconds, endSeconds, provider, modelId}
  ▼                                       MCP: add_reference({youtube: {...}})
Account Worker  ── both call ──▶ importYouTubeClip(env, owner, input)   cloud/src/imports/youtube.ts
  1. parse url → 11-char video id; reject everything else
  2. range check against the catalog edit capability (or the catalog-wide bound)
  3. per-owner import gate: one import at a time, 10 per rolling hour
  4. call the container with {videoId, startSeconds, endSeconds}
  ▼
YouTubeImporter container                                            cloud/containers/youtube/
  yt-dlp metadata  → refuse private / members-only / age-restricted / live / premiere,
                     or a range past the video's end
  yt-dlp --download-sections "*start-end" --force-keyframes-at-cuts
         -f "bv*[height>=720][height<=1080]+ba/b[height>=720]"   (via proxy)
  ffmpeg → H.264 + AAC MP4, +faststart
  stream bytes back; X-Width / X-Height / X-Duration headers from ffprobe
  ▼
Worker: storeStreamedUpload(owner, body, 'video/mp4', MAX_EDIT_VIDEO_BYTES)
        validateEditSource on the probed dimensions; tombstone the row on mismatch
  → {uploadId, mimeType, bytes, durationSeconds, width, height, expiresAt, mediaUrl,
     source: {videoId, startSeconds, endSeconds}}
```

### Import function (`cloud/src/imports/youtube.ts`)

`importYouTubeClip(env, owner, {url, startSeconds, endSeconds, edit?: {provider, modelId}}, signal)`
owns the whole import. `cloud/src/imports/routes.ts` (wired in `cloud/src/index.ts`
next to `uploadRoutes`) and the MCP tool are thin callers.

- **URL parsing** accepts `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`
  and `m.youtube.com` forms, and reads `?t=` / `&t=` for the browser's pre-fill. Only
  the extracted `[A-Za-z0-9_-]{11}` id reaches the container, never the raw string,
  because the container's command line is built from it.
- **Range check.** `startSeconds` ≥ 0, `endSeconds` > `startSeconds`, both finite, at
  most one decimal place. With `edit`, the length must fit that model's
  `videoEdit.minSeconds..maxSeconds`, resolved from the catalog (an unknown model or one
  without `videoEdit` is `invalid_field`). Without `edit`, it must fit the widest bound
  across every edit-capable catalog model (4–30 s today). The browser always sends
  `edit`; agents may not have chosen a model yet.
- **Import gate.** The container's Durable Object instance is keyed by owner
  (`getContainer(env.YOUTUBE_IMPORTER, owner)`), so one owner has at most one import in
  flight. The same object keeps the owner's import timestamps in its storage and refuses
  the 11th within a rolling hour with `retryAfterSeconds`. A Workers `ratelimits`
  binding cannot do this because its periods are 10 or 60 seconds. The gate is per
  account, shared by the browser and every agent, so connecting more agents does not
  raise proxy spend. `max_instances: 3` caps global concurrency; a fourth concurrent
  owner gets `source_refused` with a short `retryAfterSeconds`.
- **Abort.** A cancelled browser request or a 120 s ceiling aborts the container call,
  and the container kills its `yt-dlp`/`ffmpeg` process group on disconnect.
- **Storage.** `storeStreamedUpload` already reserves at the type cap, writes through to
  R2 as bytes arrive and narrows `expected_bytes`. After it returns, the probed
  dimensions and duration go through `validateEditSource` (with the model's capability,
  or the catalog-wide bound). A failure tombstones the row and deletes the object, as
  `storeUpload` does on a failed write.
- **Media URL.** The browser response includes a short-lived `mediaAccess` URL for the
  staged object so the browser can fetch the clip once for preview. The MCP response
  omits it: an agent needs only the `uploadId`, and the MCP instructions already tell
  agents not to share download links.

### Container (`cloud/containers/youtube/`)

A `Dockerfile` (Debian slim, pinned `yt-dlp` release and static `ffmpeg`) and a small
HTTP server with one endpoint, `POST /clip {videoId, startSeconds, endSeconds}`. The
only secret it receives is `YOUTUBE_PROXY_URL`, passed as an environment variable by
the Container class. It writes to a per-request temp directory and deletes it after
streaming.

Errors come back as JSON `{code, detail}` with a non-2xx status. `detail` is yt-dlp's
own text and goes through `sanitizeProviderMessage` before it is logged or shown,
because it is third-party text and can echo the proxy URL with its credentials.

### Configuration and deploy

- `cloud/wrangler.jsonc` gains the `containers` entry (image `./containers/youtube`,
  `max_instances: 3`), the `YOUTUBE_IMPORTER` Durable Object binding and a migration
  tag for the new class. The proxy URL is set with `wrangler secret put
  YOUTUBE_PROXY_URL`.
- `.github/workflows/deploy-account-worker.yml` needs Docker available, because
  `wrangler deploy` builds and pushes the image. Add `cloud/containers/**` to its path
  filter.
- Containers require the Workers Paid plan.
- No D1 migration: an import produces an ordinary `account_uploads` row.

## Browser UI

### Entry point

`components/VideoSourceInput.tsx` gains a third button, **From YouTube**, beside
Upload and Library. It renders only when the workspace runs in the cloud
(`cloudWorkspace.cloud`). It opens `components/YouTubeClipDialog.tsx`, which owns the
trimming; `VideoSourceInput` receives the finished `SourceVideo`.

### Dialog, top to bottom

1. **Link field.** Parsed as the person types (shared parser in
   `lib/imports/youtube-url.ts`, also imported by the Worker). `?t=` pre-fills From. An
   unrecognised link shows "Paste a YouTube video or Shorts link."
2. **Player.** YouTube's embed from `youtube-nocookie.com`, driven by the IFrame Player
   API. Nothing downloads at this stage. The current CSP sets only `frame-ancestors`,
   so the embed needs no header change.
3. **Markers row.** **Set start** and **Set end** copy the player's current time.
   Beside them are editable `mm:ss.s` fields for From and To.
4. **Range bar.** A thin track under the player shows the selected section, with
   **Preview range** looping From→To in the embed.
5. **Length readout.** For example `12.4 s · Seedance 2.5 edit takes 4–30 s`, switching
   to the error colour when out of range. **Import clip** stays disabled until the range
   is valid.
6. **Import clip.** The only server call. It shows a spinner with "Fetching section…"
   then "Preparing clip…", and a Cancel button that aborts the request. The dialog
   closes on success and stays open, keeping the range, on any error.

### After import

- The browser fetches `mediaUrl` once into a `File`, so `SourceVideoPreview`, the
  dimension probe and `validateEditSource` work unchanged.
- `SourceVideo` gains optional `staged: {uploadId, owner, expiresAt}` and
  `origin: {videoId, startSeconds, endSeconds}`.
- `useCloudWorkspace.perform` skips uploading a source whose `staged.owner` is the
  current owner and whose `expiresAt` is more than five minutes away, passing
  `staged.uploadId` as `sourceVideoId`. Otherwise it uploads the `File`, which is
  today's path.
- The import response is discarded if the account epoch changed while it was in flight
  (the `ProviderResultRecovery` pattern), so a clip imported by one account can never
  attach to another.
- Under the preview, a muted line reads `From YouTube · 1:02.0–1:14.4`, linking to the
  original at that timestamp.

### Mobile

The dialog is full-height, the player keeps 16:9, the markers row wraps, and every
button is at least 44 px tall.

## MCP

`add_reference` (`cloud/src/mcp/tools/references.ts`) accepts exactly one of `url`,
`upload` or the new `youtube`:

```jsonc
add_reference({ "youtube": { "url": "https://youtu.be/…", "startSeconds": 62, "endSeconds": 74.4,
                             "provider": "runware", "modelId": "bytedance:seedance@2.5" } })
→ { "uploadId": "…", "mimeType": "video/mp4", "bytes": 8123456, "durationSeconds": 12.4,
    "width": 1280, "height": 720, "expiresAt": 1792000000000,
    "source": { "videoId": "…", "startSeconds": 62, "endSeconds": 74.4 } }
```

- `provider` and `modelId` are optional together (both or neither), with the range
  rules above.
- The response always carries the probed `durationSeconds`, `width` and `height`,
  because `acceptJob` does not re-check source length. An agent compares them with the
  model's limits from `list_models`.
- A YouTube link passed as `url` is refused with `invalid_field` naming the `youtube`
  option. Without this the agent gets a misleading "not a media file" after the fetch
  downloads HTML.
- The tool stays `kind: 'write'`, so an import counts against the agent's 60 write
  calls per minute as well as the account's 10 imports per hour. The tool description
  and the server instructions gain one sentence each about the `youtube` option.

### New refusal codes

Each needs a row in the Errors table of `app/docs/mcp/guide.md` (enforced by
`cloud/tests/mcp-docs.test.ts`). The browser shows the same messages.

| Code | Retryable | Meaning |
|---|---|---|
| `invalid_range` | No | The section is outside the model's source length, or past the end of the video. |
| `source_unavailable` | No | The video is private, members-only, age-restricted, live or a premiere, or has no version at 720p or above. The message says which. |
| `source_refused` | Yes | YouTube refused the download (bot check or proxy failure), or the importer is busy. Wait `retryAfterSeconds`. |
| `import_rate_limited` | Yes | The account has made 10 imports in the last hour. Wait `retryAfterSeconds`. |

The guide's References section gains a YouTube → edit example: `add_reference` with
`youtube`, then `generate` in `inputMode: "edit"` with `sourceVideo: {uploadId}`. The
Tools table row for `add_reference` names the new option.

## Errors

The dialog keeps the link and range on every error, so a retry is one click.

| Case | Detected | Shown |
|---|---|---|
| Not a YouTube link | Browser, then Worker | "Paste a YouTube video or Shorts link." |
| Range out of bounds or past the end | Browser readout; Worker (catalog); container (metadata) | Readout in error colour; `invalid_range` message |
| Private, members-only, age-restricted, live, premiere | Container metadata, before download | `source_unavailable` message naming the reason |
| No 720p or above | Container format selection | "This video has no 720p version, which Seedance needs." |
| Bot check, proxy failure, importer busy | Container stderr mapped to a code; Worker instance cap | `source_refused`: "YouTube refused the download. Try again in a few minutes." |
| 10 imports in the last hour | Import gate | `import_rate_limited`: "Import limit reached. Try again after HH:MM." |
| Temporary input storage full | Existing `reserveUpload` `input_capacity` | Existing message |
| Stored size or probed dimensions wrong | Worker after `storeStreamedUpload` | Row tombstoned; "The imported clip could not be read. Try again." |
| Signed out or account switched mid-import | Worker owner check; browser epoch guard | Result discarded, never attached |
| Cancel or 120 s timeout | Abort signal | "Import cancelled." / "The import took too long. Try a shorter section." |

## Testing

Per the user's testing policy, tests are not written first. They go where they catch
real bugs.

- **Worker** (`cloud/tests/youtube-import.test.ts`, container stubbed):
  URL → id parsing including hostile strings; range checks with and without `edit`;
  owner refusal; the import gate's single-flight and hourly window; the streamed write
  into `account_uploads`; tombstoning on a dimension mismatch; each container error
  code → refusal code and message; sanitising a proxy URL out of `detail`.
- **MCP** (through `cloud/tests/mcp-harness.ts`, never hand-written JSON-RPC):
  `add_reference` with `youtube`, then `generate` with that `sourceVideo`; the YouTube
  link passed as `url`; each new refusal code. `mcp-docs.test.ts` covers the guide.
- **Browser:** `YouTubeClipDialog` time parsing, the length readout and Import's
  disabled states (IFrame API mocked); `useCloudWorkspace` skipping the re-upload for a
  staged source and falling back when the owner changed or the clip is near expiry.
- **Container smoke** (`cloud/containers/youtube/smoke.sh`): build and run the image
  under local Docker against a Creative Commons test video (Big Buck Bunny on YouTube);
  assert H.264 output, duration within 0.1 s of the range and a frame of at least 720p.
- **Live check before calling it done:** `wrangler dev` with the container and a real
  proxy; import a real section in the browser; submit one Seedance 2.5 Draft edit at
  480p (the cheapest paid run, confirmed with the user before spending) and inspect the
  result. Repeat the import once through a real MCP client.

## Documentation

- `AGENTS.md` gains a routing entry: "YouTube clip import → first read this spec", with
  the one-function-two-callers rule and the reason the importer is a container.
- `app/docs/mcp/guide.md` as described under MCP.

## Follow-ups (not in this work)

- `acceptJob` does not validate source duration server-side for any source; agents
  staging a device clip of the wrong length learn it only from the provider.
- If the proxy cost or YouTube's blocking makes this unreliable, the container
  interface (`videoId` + range in, MP4 out) allows swapping the extraction backend
  without touching the Worker or UI.

## Verify during planning

- The exact Cloudflare Containers API (`@cloudflare/containers` `Container` class,
  `getContainer`, env passing, `max_instances` behaviour when full, Durable Object
  storage alongside the container) against current docs.
- Whether `wrangler dev` runs containers on this machine (needs local Docker).
- The current Seedance 2.5 edit source bounds in `lib/providers/catalog.ts` at
  implementation time.
