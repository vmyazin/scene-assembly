# Atlas pricing correction

Status: Approved design

**Follow-up decision, 2026-11-12:** the $0.003 rule below (first reference included) is Seedream 5.0 Pro's only. Seedream 5.5 bills every input image, through `inputImageUsd`. See `docs/claude/specs/2026-11-12-seedream-5-5.md`.

## Context and goals

The requested correction replaces Seedance Mini/Fast starting prices that were
incorrectly applied to every resolution. Both browser and account spend capture
must use the saved size and duration. Seedream editing must include the documented
$0.003 charge for each reference after the first.

## Scope and implementation boundary

Extend `ProviderRate` in `lib/providers/types.ts` and the Atlas entries in
`lib/providers/catalog.ts`. Resolve rates inside `resolveCatalogRate` in
`lib/spend/resolve.ts`; pass saved controls through `lib/spend/capture.ts` and
`lib/spend/account.ts`. Keep prices estimated, and return unknown for missing or
unverified settings. Test the resolver and both capture paths.

## Non-goals

No provider integration, generation payload changes, new size controls, migration
of historical spend, commit, or deployment. Work directly in the current checkout
as requested, without the worktree workflow or superpowers skills.

## Pricing evidence and boundaries

- [Atlas Seedance pricing](https://www.atlascloud.ai/models/explore/seedance-2-lowest-price),
  checked 2026-09-07: Mini 480p $0.0113/s, 720p $0.0242/s, 1080p SR $0.0435/s;
  Fast 480p $0.027/s, 720p $0.0581/s. The page's Fast 1080p figure does not
  explicitly identify the API's `1080p-SR` option, so it remains unknown along
  with unlisted 1440p SR. Endpoint `llms.txt` files quote starting prices only.
- [Atlas Seedream pricing](https://www.atlascloud.ai/models/explore/seedream-5-pro-lowest-price):
  $0.036 for the lower tier and $0.072 for 2K. `atlas.ts` explicitly submits
  lower-tier sizes for every supported aspect ratio; shared `imageSize` preferences
  do not change that request and must not change the estimate.
- [Seedream edit input contract](https://www.atlascloud.ai/docs/more-models/bytedance/seedream-v5.0-pro-edit/generateImage):
  first reference included, subsequent references $0.003 each. Count inputs once
  per request, independently of output count.

Historical ledger entries are immutable snapshots without enough saved settings
to reconstruct these prices reliably; only newly captured entries change.
