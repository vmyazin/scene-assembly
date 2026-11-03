# Atlas models verified 2026-11-03

Spec: `docs/codex/specs/2026-11-03-atlas-models.md`

## File map

- `lib/providers/catalog.ts` — rates, frames cap, new image and edit entries
- `lib/providers/atlas.ts` — image and edit bodies
- `lib/providers/output-size.ts` — Flash and MAI pixel tables
- `lib/providers/types.ts` — background, strength, restyle and reframe flags
- `lib/account/model-schema.ts` — frames range, background, required reframe ratio
- `lib/spend/account.ts`, `lib/spend/capture.ts` — resolution tier and generated edit length
- `cloud/src/provider-adapters/aggregators.ts` — frames count, background, strength
- `components/ProviderVideoWorkspace.tsx` — extra keyframes and reframe ratio
- `components/GenerationInterface.tsx` — background chip and tiered image estimate
- `app/api/generate/route.ts`, `app/api/providers/video/route.ts`, `types/index.ts`

Do not modify default model ids, fal’s first-and-last cap, or existing Luma Ray 3.2 text/image generation rates.

## Tasks

- [x] Record calculator rates and drop models Atlas does not sell under the requested names.
- [x] Extend Kling 4 frames and price the ESR sizes. Leave the edit total unknown.
- [x] Add FLUX 3 edit-video, Luma restyle, and Luma reframe on `videoEdit`.
- [x] Add Seedream 5.0 Flash and MAI-Image-2.6. Correct Nano Banana 2 and 2.1 tiers. Add GPT transparency at 1K.
- [x] Tests for rates and request bodies: `tests/spend/catalog-rates.test.ts`, `tests/providers/atlas-models.test.ts`, `cloud/tests/atlas-kling4.test.ts`.
