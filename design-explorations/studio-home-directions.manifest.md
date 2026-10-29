# Studio home directions: data manifest

Scope: first-screen mockups only. No production UI edits. Same catalog and three seed records across A–D. Empty-library toggle applies to all four. No account data was read.

| Element | Field path / source | Class | Count in sampled source |
| --- | --- | --- | --- |
| Image mode labels (shortened for mockup) | types/index.ts FEATURES[].name, id | ✅ Real | 6/6 entries |
| Image preview assets | FEATURES[].thumbnail | ✅ Real | 6/6 local files present |
| Input requirements | FEATURES[].requiresImage / maxImages | ✅ Real | 6/6 booleans; maxImages populated 3/6 |
| Video entry thumbnail | public/thumbnails/edit-video.jpg | ✅ Real | 1/1 existing asset; used as tool illustration, not a generated result |
| Recent image names | scripts/seed-browser-gallery.js IMAGES; record().prompt | ✅ Real fixture | first 3 of 10 image fixtures |
| Recent provider labels | IMAGES[][1] → record().provider | ✅ Real fixture | 3/3 sampled |
| Recent preview art | seed paint(): source colors, gradient and circle | ✅ Real fixture | 3/3 color pairs, CSS approximation of seed canvas |
| Recent feed on home | Proposed composition of existing library data | ❌ Aspirational integration | 0 home feeds today; shown in 4/4 variants |
| Prompt before workspace | Proposed draft-to-mode handoff | ❌ Aspirational integration | 0 home composers today; shown in D only |
| Empty library | No records selected | ✅ Real supported data shape | 0 records; toggle available in 4/4 variants |

The seed model IDs are fixture values, so no model names, prices, dates, or generation durations are fabricated in the previews. Seed availability is not production completeness. Recent cards do not imply the user owns these results. All controls act within the mockup and do not submit jobs.
## Follow-up: equal image and video emphasis

This revision supersedes the three-image recent fixture sample above. All four variants now use two image fixtures (`espresso-cup-walnut`, `headphones-teal-sweep`) and both video fixtures (`arcade-dolly-4s`, `skylight-rain-push`) from the same checked-in seed script. Video previews here are static seed-art representations, not playable clips. In the seed script video availability depends on MediaRecorder support (2/2 definitions; runtime availability not measured).

| Element | Field path / source | Class | Count |
| --- | --- | --- | --- |
| Video mode labels and requirements | components/VideoWorkspace.tsx MODES[].label / requires | ✅ Real | 5/5 modes in all 4 variants |
| Video illustrations | MODES[].thumbnail, local public/thumbnails files | ✅ Real | 5/5 assets present |
| Recent fixture title / provider / kind | scripts/seed-browser-gallery.js IMAGES and VIDEOS → record() | ✅ Real fixture | 4 sampled: 2 of 10 images, 2 of 2 video definitions |
| Equal-size home entry controls and mode lists | New home layout proposal | ❌ Aspirational integration | 4/4 mockups; no production changes |
