# Atlas Kling 4.0 and fal H3 promotion

Status: Approved design

## Follow-up decision — 2026-10-26
The official Atlas calculator contradicts its $0.11/s headline. Use verified quote-derived estimates of $0.14287/s at 720p and $0.21385/s at 1080p, and disclose the discrepancy in the model note. Do not advertise Atlas as cheaper than Kie. This supersedes the headline rate in the context below.

Offer native 720p/1080p and 3–30s output; no unpriced ESR sizes or audio toggle. Image mode accepts an opening frame, up to eight middle frames and a closing frame, with source-defined shape. First/last mode stays exactly two. Reference mode accepts ten images; the provider's fifteen limit includes mixed media/subjects/voices, which this integration does not expose. Edit is background-only, with a separately chosen output duration and ten optional images. Source MP4/MOV is 3–30s, 700–4553px; retain the app's 200 MB ceiling (vendor 300 MB). Prompt cap 11,000 characters fits Atlas's documented non-English limit and is conservative for English (26,000).

Atlas bills input video duration but does not publish the complete formula. Public quote results suggest a rule involving input and output duration; do not present that inference as verified billing. Edit totals remain unknown. Existing Kling 3.0 entries and all saved/default selections remain unchanged.

fal Turbo generation is the existing H3 generation entry. H3 Max Recast/Relight pages still publish full prices, so the generation sale is not applied to edits. Turbo sale rates are $0.01625/$0.026/$0.052 per second (480P/768P/1080P), returning to $0.025/$0.04/$0.08 at November 1, 00:00 UTC. fal gives no timezone; UTC is the conservative application cutoff. The verified window begins October 26; saved submission times prevent late capture from repricing earlier jobs. Existing ledger snapshots remain unchanged.


## Context and goals
The user requested Kling 4.0 through Atlas as a premium Kling option while retaining existing Kling 3.0 choices/default behavior, plus correction of fal H3 sale prices through October 31, 2026. Verify the published endpoint contracts before exposing inputs. Atlas advertises $0.11/second (30% off $0.157) without an expiry.

## Scope and implementation boundary
Atlas catalog entries live in `lib/providers/catalog.ts`; model-specific wire mapping stays in `lib/providers/atlas.ts`. Reuse the existing video modes, source uploader, reference tray, account job lifecycle and shared price resolver. Add only advertised options supported end to end, with capability-driven UI/validation changes where the new schema requires them. Keep edit limits and edit pricing on `videoEdit`. Cloud validation and MCP descriptors must agree with the catalog. fal pricing lives in `lib/spend/rates.ts`, with one promotion window used by estimates and display and automatic reversion after the sale. Existing stored spend entries remain unchanged.

## Non-goals
No Runware/Kie Kling 4.0 addition, new provider enablement, unrelated model additions, UI redesign, paid generation, commit or deployment before requested review. Do not migrate selections to the premium model. Preserve existing Kling 3.0 entries.

## Acceptance
Kling 4.0 appears under Atlas with verified text, image/frame, reference and edit contracts and honest limits/rates. Endpoint payload tests, price tests and cloud model-schema tests pass. fal Turbo displays and estimates the advertised discount until its cutoff and full price thereafter. Verify the running studio and provide its local review URL.

## Sources
- https://www.atlascloud.ai/models/kling-v4
- https://api.atlascloud.ai/api/v1/models
- https://fal.ai/models/minimax/h3-max-turbo/image-to-video

Exact endpoint contract evidence and any bounded support decisions are recorded below as verification completes.

## Verified evidence
Read October 26, 2026:
- [Text schema](https://static.atlascloud.ai/model/schema/kwaivgi-kling-v4.0-text-to-video.json)
- [Image schema](https://static.atlascloud.ai/model/schema/kwaivgi-kling-v4.0-image-to-video.json)
- [Reference schema](https://static.atlascloud.ai/model/schema/kwaivgi-kling-v4.0-reference-to-video.json)
- [Edit schema](https://static.atlascloud.ai/model/schema/kwaivgi-kling-v4.0-video-edit.json)
- [Public quote endpoint](https://api.atlascloud.ai/api/v1/model/calculate): read-only POST with `{model, duration, resolution}` as called by Atlas's website. Text model at 5s/720p returns `price: "0.71435"`; 10s returns `"1.4287"`. At 5s/1080p returns `"1.06925"`; 10s `"2.1385"`. Image-only reference and keyframe requests agree. No credentials or paid submissions used.
- [Turbo promotion](https://fal.ai/models/minimax/h3-max-turbo/image-to-video): 35% through October 31, output may exceed requested duration by 0.7s; preserve existing overrun allowance.

## Local review
Dedicated managed worktree with dependencies installed using `pnpm install --frozen-lockfile --prefer-offline` and `pnpm --dir cloud install --frozen-lockfile --prefer-offline`. No main checkout changes or copied secrets. Run `ACCOUNT_WORKER_PORT=8931 DEV_FAKE_GENERATION=1 npm run dev -- --port 3331`. Run `node scripts/seed-kling4-preview.mjs` for the two dummy provider connections, then sign in using **Use local test account**. Generation UI/contract tests are credential-free; actual paid generation remains untested.
