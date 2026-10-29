# Direction B: data and interaction manifest

B0 is the current B layout, included as the baseline. B1–B3 are new comparisons. All variants use identical catalog entries and recent fixture records. No production or personal data was read.

| Element | Source | Class | Count |
| --- | --- | --- | --- |
| Image labels, input requirements, thumbnails | types/index.ts FEATURES | ✅ Real | 6/6 entries, 6/6 local assets |
| Video labels, input requirements, thumbnails | components/VideoWorkspace.tsx MODES | ✅ Real | 5/5 entries, 5/5 local assets |
| Recent image titles/providers | scripts/seed-browser-gallery.js IMAGES | ✅ Real fixture | first 2 of 10 definitions |
| Recent video titles/providers | scripts/seed-browser-gallery.js VIDEOS | ✅ Real fixture | 2 of 2 definitions; runtime recording support not measured |
| Recent artwork | same seed colors and gradient/circle treatment | ✅ Real fixture approximation | 4/4 static illustrations; videos do not play |
| Recent home feed | Proposed composition of existing library data | ❌ Aspirational integration | 0 existing home feeds; shown 4/4 |
| B3 search | Label + requirement + media family from existing catalog | ❌ Aspirational interaction | 11/11 mockup entries searchable; production wiring needed |
| B3 shared detail panel | Existing mode label, thumbnail, requirement | ❌ Aspirational interaction, real fields | 11/11 selectable; production wiring needed |
| Empty state | No records | ✅ Real supported shape | Toggle affects all 4 variants |

Short labels are proposed presentation copy mapped to the existing mode IDs. No model prices, dates, generated results, or user ownership claims are invented. Primary actions only show local explanatory feedback. Browser checks must cover search, no matches, detail selection, focus comparison, and empty-library state.
