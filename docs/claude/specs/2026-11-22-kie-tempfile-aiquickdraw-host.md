# Kie results on tempfile.aiquickdraw.com

Status: Implemented

## Context

A Kie video job finished, was charged, and stopped at "Needs attention" with no
file: "Generated · saving blocked". Kie had put the result on
`tempfile.aiquickdraw.com`. Capture only fetches hosts named in
`lib/account/result-location.ts`, and that list held Kie's older hosts
(`kie.ai`, `tempfile.ai`, `kieai.redpandaai.co`, `tempfile.redpandaai.co`,
`redpandaai.co`) but nothing under `aiquickdraw.com`. `safeResultUrl` in
`cloud/src/assets.ts` threw `result_location`, with the detail "Automatic
saving does not support the download host tempfile.aiquickdraw.com."

The same list gates `/api/download-video`, so the browser's fallback download
for a Kie clip its CDN would not serve cross-origin answered 403 as well.

## What changed

`result-location.ts` gains `RESULT_HOSTS`, matched by exact hostname.
`RESULT_DOMAINS` entries also accept their subdomains; the two new hosts do
not, because `aiquickdraw.com` is not a name this app can vouch for as a
whole. HTTPS, default port and no credentials are required as before, and each
redirect is checked against the same policy.

The list is still one file. The Worker imports it (`cloud/src/assets.ts`,
`cloud/src/result-recovery.ts`), as does `app/api/download-video/route.ts`.

## Hosts added

| Host | Evidence (Kie docs read 2026-11-22) |
| --- | --- |
| `tempfile.aiquickdraw.com` | `resultUrls` examples on about 80 pages, including `docs.kie.ai/market/wan/3-0-video`, `/market/kling/v4-reference-to-video`, `/market/pixverse/v6-max-text-to-video`, `/runway-api/generate-ai-video`, and `resultUrl` on `/veo3-api/get-veo-3-1080-p-video`; the request example on `/common-api/download-url`; the owner's blocked job. |
| `file.aiquickdraw.com` | "Generated 4K video URLs" on `docs.kie.ai/veo3-api/get-veo-3-4k-video`; the `resultUrls` example on `/market/z-image/z-image`, a model in this catalog. |

## Hosts considered and left out

- `aiquickdraw.com` as a suffix. It would trust every present and future host
  under a domain whose other uses are unknown.
- `static.aiquickdraw.com`. One `resultUrls` example, on
  `/market/omnihuman-2-0`, under `/tools/example/` beside that page's sample
  inputs. It reads as a sample asset, and the model is not in this catalog.
- `tempfileb.aiquickdraw.com`. Appears only as example input URLs on
  `/market/kling/v4-flash-reference-to-video`, never as a result.
- The host of the download-url endpoint's returned link. The docs redact it
  (`https://tempfile.1f6cxxxx…`), and this app does not call that endpoint.
- `tempfile.redpandaai.co`, `kieai.redpandaai.co`. Upload hosts, already
  accepted.

A host left out is not lost money: the job stops at `result_location`, the row
offers the provider's own link, and adding the host later re-opens the job.

## How long Kie keeps a result

Kie's docs say generated files are kept for 14 days ("Result URLs expire after
about 14 days", on Market model pages; "Generated files will be retained for 14
days"). The 20-minute figure belongs to `POST /api/v1/common/download-url`,
which turns a Kie result URL into a short-lived download link; the result URL
itself is the 14-day one. The docs do not say that asking for task details
again returns a new address.

## Saving on success

- **Signed-in (Worker).** The poll that reads `success` writes the URLs to
  `result_json`, and the next step, `save-assets`, streams each file into R2
  and inserts the asset row before the job becomes `saved`. Images and video
  take the same path. Nothing in the library links to Kie.
- **Guest (browser key).** `recordFinishedJob` files metadata and the provider
  URL only; bytes are fetched when the person presses Keep or Download. That
  is deliberate (`lib/gallery/record-job.ts`) and unchanged here, so a guest's
  Kie result that is never kept stops opening after Kie's 14 days.

## Jobs already stopped on this host

`canRetryResultLocation` re-reads the stored URLs against the current list, so
once this is deployed those rows show "Saving is now supported. Retry without
generating again." Resume does not submit or poll: it fetches the stored URL
and saves it. That works while Kie still has the file, about 14 days from
completion. After that the fetch answers 403/404/410, the row becomes
`result_link_expired`, and nothing this app can call brings the file back.

Re-polling Kie on resume was considered and not added. The stored address is
the one Kie keeps for the file's whole life, the docs promise no fresh one, and
once the file is deleted a new link would point at nothing.

The Worker deploys on a push to `main` that touches `lib/**`; until that run
finishes, the rows stay as they are.

## Not verified

- No live Kie job was run and no authenticated Kie request was made. The
  hosts come from Kie's public docs and the owner's report.
- Whether `tempfile.aiquickdraw.com` redirects to another host when fetched
  from a Worker. If it does, capture stops at `result_location` naming that
  host.
- Whether the owner's blocked job is still inside Kie's 14 days.
