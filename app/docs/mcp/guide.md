# Connect an agent to Scene Assembly

Scene Assembly runs an MCP server, so an AI agent such as Claude Code, Claude or Cursor can generate images and video with the provider keys connected to your account. Every result lands in your library, each agent has a spend limit you set, and the agent never sees your keys.

## Before you start

You need a Scene Assembly account with at least one provider key connected. Sign in at {{SITE_URL}}/account and add a key under your provider connections. The agent can use only the providers whose keys are connected there, and it cannot add or read keys itself.

## The MCP URL

```
{{MCP_URL}}
```

The Connected agents panel on your account page ({{SITE_URL}}/account) shows the same URL with a copy button.

## Connect your client

Each client opens a Scene Assembly page in your browser the first time it connects. Sign in if asked, choose a spend limit and two permissions (see [What you approve](#what-you-approve)), and approve. Finish in the browser that opened the page: a link copied to another browser will not complete the connection.

### Claude Code

```
claude mcp add --transport http scene-assembly {{MCP_URL}}
```

Then run `/mcp` inside Claude Code, choose `scene-assembly` and sign in.

### Claude.ai and Claude Desktop

Custom connectors are available in Claude on the web and in Claude Desktop. On a Free, Pro or Max plan (Free allows one custom connector):

1. Open Customize → Connectors (claude.ai/customize/connectors).
2. Click **+**, then **Add custom connector**.
3. Paste the MCP URL and click **Add**. Leave Advanced settings empty: Scene Assembly registers the client itself.
4. Connect it, and Claude opens the Scene Assembly page.

On a Team or Enterprise plan, an Owner adds the connector first: Organization settings → Connectors (claude.ai/admin-settings/connectors), **Add**, hover over **Custom** and choose **Web**, paste the MCP URL and click **Add**. Each member then opens Customize → Connectors, finds the connector and clicks **Connect**.

### Cursor

Add the server to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "scene-assembly": {
      "url": "{{MCP_URL}}"
    }
  }
}
```

Then follow Cursor's prompt to log in to the server, which opens the Scene Assembly page.

### Any other client

The server speaks Streamable HTTP and uses OAuth 2.1 with dynamic client registration and PKCE. A client that supports remote MCP servers with OAuth needs only the URL: an unauthenticated request gets a 401 whose `WWW-Authenticate` header points at the protected-resource metadata, and discovery goes from there.

### Reconnecting

A connection lasts 30 days from the day you approve it and is not extended by use, so expect to reconnect about once a month. When it lapses, the agent's calls fail with HTTP 401; connect again the same way you did the first time. Each approval creates a new entry in the Connected agents panel with its own limit; the lapsed one leaves the panel on its own. Each entry shows when it was connected and last used, which tells a working connection from an old one with the same name.

## What you approve

The consent page shows the name the client gave itself, marked unverified, and the address it returns to. It lists what the agent will be able to do: start image and video jobs with your connected keys; cancel, resume or stop tracking jobs, including ones you started in the browser; copy files from any web link into your account's temporary storage; see your jobs, library and spend; and read your providers' remaining balances. It cannot see or change your provider keys.

You choose three things:

- **Spend limit per 24 hours.** In US dollars, from $0.50 to $500. The default is $5. A job that would go over the limit is refused before it starts.
- **Allow models without a published price.** Off by default. Some models have no price Scene Assembly can know before they run: every model from Kie.ai, Runware, CometAPI, Cloudflare and Pollinations, and some fal.ai and Atlas Cloud models. These runs count toward the limit only once the provider reports what they cost, so the limit cannot stop them in advance. That is why the default is off. The consent page names the connected providers this affects.
- **Allow deleting files from your library.** Off by default. Without it the agent is not offered `delete_asset` at all.

To change these later, open the Connected agents panel on your account page, edit the limit or the switches, and save. The change applies to the agent's next call, though a client may keep showing an old tool list, with or without `delete_asset`, until it reconnects. Disconnect is in the same panel and also takes effect on the agent's next call, which fails with HTTP 401. Jobs the agent already started keep running and stay in your library.

## The usual loop

Each step is one tool call. The arguments are examples.

1. **See what can run.** `list_models` with no arguments returns a compact list of the models your connected providers offer.

   ```json
   {}
   ```

2. **Read one model's settings.** `list_models` with `provider` and `modelId` returns each input mode with its fields, options, bounds and defaults, and how many reference images it takes.

   ```json
   { "provider": "gemini", "modelId": "gemini-3-pro-image-preview" }
   ```

3. **Price it.** `estimate_cost` takes the same fields as `generate` and checks the result against the agent's limit. Settings you leave out take the model's defaults, and the response echoes them in `values`.

   ```json
   { "provider": "gemini", "modelId": "gemini-3-pro-image-preview", "mediaType": "image", "inputMode": "text", "prompt": "A paper kite over a harbour at dawn", "values": { "aspectRatio": "16:9" } }
   ```

4. **Start the job.** `generate` with an `idempotencyKey`. It returns at once with a `job`, the estimate and the agent's remaining budget.

   ```json
   { "provider": "gemini", "modelId": "gemini-3-pro-image-preview", "mediaType": "image", "inputMode": "text", "prompt": "A paper kite over a harbour at dawn", "values": { "aspectRatio": "16:9" }, "idempotencyKey": "harbour-kite-1" }
   ```

5. **Wait for it.** `get_job` with `waitSeconds` (up to 25) holds the call until the job's state changes. Call it again until the state is `saved`, `failed`, `cancelled` or `needs_attention`. A saved job lists its `outputs`, each with an `assetId` and a download link.

   ```json
   { "jobId": "<job.id from generate>", "waitSeconds": 25 }
   ```

6. **Look at the result.** `view_asset` returns an image inline as a WebP no larger than 1024 px, with a download link. A video comes back as the link only.

   ```json
   { "assetId": "<outputs[0].assetId from get_job>" }
   ```

### Idempotency

The `idempotencyKey` is any string you choose, up to 200 characters, and it belongs to this agent only. Reuse the key when you retry the same request, for example after a timeout: you get the same job back and are not charged again. A new key, or no key at all, starts a new job and a new charge. Reusing a key with a different request, or with a job that was removed, is refused with `token_conflict`. If the first call with a key is still starting, a second one is refused with `request_in_progress`; wait a few seconds and retry, or call `list_jobs`. Both refusals are described under [Errors](#idempotency-2).

## References

Some input modes take reference images, and edit mode takes a source video. Stage a file with `add_reference`, then pass the `uploadId` it returns to `generate`.

**From a link.** Scene Assembly downloads the file straight away.

```json
{ "url": "https://example.com/cat.png" }
```

- The URL must be public `https`, with a hostname rather than an IP address and no user name or password in it.
- It cannot point at Scene Assembly itself. Pass `{ "assetId": … }` for a file already in the library.
- Up to 3 redirects are followed, each checked by the same rules. The download times out after 20 seconds.
- The type is read from the file's bytes, not its headers: PNG, JPEG, WebP or AVIF images up to 20 MB, and MP4 or WebM video up to 100 MB. QuickTime and HEIC files are refused.

**From a file you have.** Ask for an upload link with the file's type and its exact size in bytes:

```json
{ "upload": { "mimeType": "image/png", "bytes": 482113 } }
```

The response has a `putUrl`. PUT exactly that many bytes there within 15 minutes, with the same `Content-Type`:

```
curl -T cat.png -H "Content-Type: image/png" "<putUrl>"
```

A different type or byte count is refused by the upload link itself with an HTTP 400, not by a tool; ask for a new link with the right figures.

`mimeType` is one of `image/png`, `image/jpeg`, `image/webp`, `image/avif`, `video/mp4` or `video/webm`, with the same size limits as links.

**Using it.** An `uploadId` lasts 24 hours. It is cleaned up soon after the jobs that used it finish, so stage the file again for a later job. A file already in your library needs no staging: pass its `assetId`. The refusals these steps can return are listed under [Errors](#references-2).

```json
{ "provider": "gemini", "modelId": "gemini-3-pro-image-preview", "mediaType": "image", "inputMode": "image", "prompt": "The same kite, in watercolour", "references": [{ "uploadId": "<from add_reference>" }, { "assetId": "<from list_assets>" }], "idempotencyKey": "harbour-kite-watercolour" }
```

References go in order. `list_models` gives each mode's minimum and maximum count. In edit mode, pass the clip as `sourceVideo` instead of in `references`. An account can hold up to 32 staged references, 256 MB in all, across the browser and every agent.

## Budget

- **The window rolls.** The limit covers the last 24 hours, counted back from each call, not a calendar day.
- **A job is charged when it is accepted**, at its estimate, before the provider starts it. When the job finishes, the charge settles to the cost recorded in your spend ledger.
- **A cancel releases the charge only when the provider never ran the job.** `cancel_job` works only while a job is still queued. A job that fails, or that you stop tracking, keeps its charge, because the provider may have billed for it.
- **Models without a published price** book $0 when they start, and count at their real cost once the provider reports it. They run only if you allowed them.
- **When a job would not fit**, `generate` is refused with `budget_exceeded`, and `roomAt` says when enough earlier charges leave the window. `estimate_cost` answers the same question without starting anything.
- **`get_spend`** returns the account's spend totals (browser runs included), this agent's limit, what it has used and what is left, and optionally the latest ledger entries and live balances from providers that publish them.

## Tools

The server offers 13 tools. `delete_asset` is offered only when you allowed the agent to delete files.

| Tool | What it does | Key inputs |
| --- | --- | --- |
| `list_models` | Models your connected providers can run. Filter by provider or model to get each mode's settings. | `provider`, `modelId`, `mediaType`, `inputMode` (all optional) |
| `estimate_cost` | Prices a request and checks it against the agent's limit, without running it. | The same fields as `generate` |
| `add_reference` | Stages a reference image, or a source video for edit mode, and returns an `uploadId`. | `url`, or `upload` with `mimeType` and `bytes` |
| `generate` | Starts an image or video job and charges its estimate to the agent's limit. Returns at once. | `provider`, `modelId`, `mediaType`, `inputMode`, `prompt`, `values`, `references`, `sourceVideo`, `idempotencyKey` |
| `get_job` | A job's state and, once saved, its outputs with download links. Can wait for a change. | `jobId`, `waitSeconds` (0 to 25) |
| `list_jobs` | The account's recent jobs, newest first, including ones started in the browser. | `state` (`active`, `needs_attention`, `finished` or `all`), `limit` (up to 100) |
| `cancel_job` | Cancels a job that is still queued and releases its charge. | `jobId` |
| `resume_job` | Tries again on a job that needs attention, when its `failureReason` can be fixed by trying again. At most three times. | `jobId` |
| `dismiss_job` | Stops tracking a job that needs attention. The provider may still finish it and charge for it. | `jobId`, `remove` (also takes it off the list) |
| `list_assets` | The library's saved images and videos, newest first, 50 at a time, with the prompt, provider and model that made each one. | `kind`, `temporaryOnly`, `cursor` |
| `view_asset` | One saved file: an image inline as a WebP up to 1024 px plus a download link, or a video's download link. | `assetId` |
| `delete_asset` | Permanently deletes a file from the library. Hidden unless you allowed it. | `assetId` |
| `get_spend` | Account spend totals, this agent's limit and what is left, and optionally ledger entries and provider balances. | `entries` (up to 50), `balances` |

Each agent can make 300 read calls, 60 write calls (`add_reference`, `cancel_job`, `dismiss_job`, `delete_asset`) and 10 submissions (`generate`, `resume_job`) per minute. An account runs at most 10 jobs at a time, shared with the browser.

## Errors

A refusal arrives as a normal tool result with `isError: true`. Its `structuredContent` is `{ code, message, retryable, … }`: `message` is a sentence you can pass on, `retryable` says whether sending the same call again later can succeed, and some codes carry more fields. Read `code`, not the message.

An HTTP 401 from the server is not a refusal. It means the connection was disconnected from the Connected agents panel or has expired, and the person has to reconnect from their client.

### Requests and settings

| Code | Retryable | What it means and what to do |
| --- | --- | --- |
| `invalid_field` | No | An argument is wrong. `field` names it, and `allowed`, `min` or `max` say what it accepts. Fix it, calling `list_models` for the model's settings. |
| `invalid_settings` | No | The provider's own check rejected the settings. Compare them with `list_models` for that model and mode. |
| `invalid_request` | No | The request was malformed, for example a `cursor` that did not come from `list_assets`. |
| `invalid_references` | No | The same reference was passed twice, or a file is in the wrong role: images go in `references`, a video goes in `sourceVideo`. |
| `invalid_token` | No | Scene Assembly built an invalid submission token. This should not happen; report it. |
| `not_found` | No | No job or file with that id on this account. |
| `local_fixture_mode` | No | Only on a local development server with fake generation switched on, which runs image jobs and edits only. |

### Providers

| Code | Retryable | What it means and what to do |
| --- | --- | --- |
| `connection_required` | No | The account has no key for that provider. Ask the person to connect one on their account page; an agent cannot add keys. |
| `provider_unavailable` | No | Background generation is not available for that provider. Pick another one from `list_models`. |

### Budget and limits

| Code | Retryable | What it means and what to do |
| --- | --- | --- |
| `budget_exceeded` | No | The job's estimate does not fit in what is left of the 24-hour limit. Carries `estimateUsd`, `limitUsd`, `usedUsd`, `remainingUsd` and `roomAt`: the time, in milliseconds since the Unix epoch, when enough room frees up, or `null` when this job costs more than the whole limit. Tell the person rather than retrying sooner. |
| `cost_unknown` | No | The model has no published price and the person has not allowed unpriced models. Choose a priced model, or ask the person to allow them in the Connected agents panel. |
| `rate_limited` | Yes | This agent is calling too often. Wait `retryAfterSeconds`, then retry. |
| `active_jobs` | No | The account already has 10 jobs running. Wait for one to finish (`list_jobs` with `state: "active"`), or cancel one. |
| `service_capacity` | Yes | Background generation is busy for everyone. Try again shortly. |
| `capacity` | No | Either the account's storage has no room for this job's output, or the job could not be started for another reason. Read the message: if it says the storage is full, delete files from the library or ask the person to; if it says to try again shortly, wait and retry once. |
| `reserved_capacity` | No | Jobs in progress are holding the rest of the account's storage. Wait for them to finish. |
| `temporary_results` | No | The account has results saved only temporarily because its storage was full. Download and delete them (`list_assets` with `temporaryOnly: true`), or wait for them to expire, before starting another job. |

### Idempotency

| Code | Retryable | What it means and what to do |
| --- | --- | --- |
| `token_conflict` | No | This `idempotencyKey` was already used for a different request, or for a job that was removed. Use a new key. |
| `request_in_progress` | Yes | A call with this `idempotencyKey` is still starting. Retry in a few seconds, or call `list_jobs`. |

### References

| Code | Retryable | What it means and what to do |
| --- | --- | --- |
| `reference_fetch_failed` | No | A reference URL was refused or could not be downloaded: not https, an IP address, a Scene Assembly address, too many redirects, an error status, a type other than PNG, JPEG, WebP, AVIF, MP4 or WebM, or a file over the size limit. The message says which. |
| `invalid_upload` | No | `add_reference` was asked for an upload of an unsupported type or size. |
| `upload_size` | Yes | A library file passed as `{ "assetId": … }` did not copy intact for the job. Retry the same `generate` call, with the same `idempotencyKey`. |
| `result_type` | No | A file could not be stored as a reference because its type is not one Scene Assembly stores. Use a PNG, JPEG, WebP, AVIF, MP4 or WebM file. |
| `result_size` | No | A file was larger than the limit while it was being stored. Use a smaller file. |
| `input_capacity` | No | Too many staged references are still in use: an account holds up to 32, 256 MB in all. Wait for the jobs using them to finish. |
| `reference_unavailable` | No | A staged upload has expired, was never finished, or was already cleaned up, or a library file cannot be used as a reference (too large or the wrong type). Stage it again. |
| `inline_input_size` | No | Gemini and CometAPI take up to 12 MB of reference images per job in all. Use smaller images. |

### Job control

| Code | Retryable | What it means and what to do |
| --- | --- | --- |
| `generation_started` | No | `cancel_job` came too late: the provider already has the job. It stays tracked; follow it with `get_job`. |
| `tracking_state_changed` | No | The job is no longer waiting for a decision. Call `get_job` to see where it is. |
| `unrecoverable` | No | Trying again cannot fix this job. Stop tracking it with `dismiss_job`. |
| `resume_exhausted` | No | The job was already resumed three times. Stop tracking it with `dismiss_job`. |
| `reconciliation_required` | No | Scene Assembly cannot tell yet whether the provider ran this job, so it cannot be resumed. Leave it, or stop tracking it with `dismiss_job`. |
| `internal_error` | Yes | Something failed inside Scene Assembly. Try again shortly. |

## Security and privacy

- **Sign-in is OAuth 2.1.** Your client gets its own access token, valid for an hour and refreshed for up to 30 days. It is tied to your account and to this one connection, and disconnecting stops it on the next call.
- **Keys stay on the server.** Jobs run with the provider keys stored on your account. No tool returns a key, and an agent cannot add, read or change one.
- **Download links are short-lived and open.** A link from `get_job` or `view_asset` expires after ten minutes, and anyone holding it can download the file until then. Do not paste links anywhere public; call the tool again for a fresh one.
- **Upload links are credentials too.** A `putUrl` accepts one file for 15 minutes from whoever holds it.
- **Links you pass are fetched by Scene Assembly's server**, with no cookies or credentials of yours, and never from Scene Assembly's own addresses.
- **An agent sees the whole account's work:** your jobs, prompts, library and spend, including what you made in the browser.
