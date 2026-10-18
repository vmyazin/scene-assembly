# image-workspace-layout — data manifest

What each variant draws, and whether the product has that data today. Fixtures come from
real runs on 2026-10-15/16: the Nano Banana 2.1 reading-nook image and its snowy edit
(prod, signed in), and a keyless Pollinations lighthouse (local).

| Element | Source | Class | Notes |
|---|---|---|---|
| Result image | `ResultStackItem.src` | ✅ Real | Every result |
| Pixel size (1024×1024) | `ResultMeta` width/height, read from the loaded image | ✅ Real | Known once the image loads |
| Provider · model | `ResultStackItem.provider`, `.modelId` | ✅ Real | Every result in all three image panels |
| Took 20s | `startedAt` / `finishedAt` | ⚠️ Sometimes | Cloud results only while their job row exists; dismissing the job drops it (see `CloudJobPanel`) |
| Cost | `ResultStackItem.cost` | ⚠️ Sometimes | Browser runs with a published rate; cloud cards do not carry it |
| Prompt text per result | `ResultStackItem.prompt` | ✅ Real | Carried per item for download names |
| Engine list, model table, prices | engine registry + catalogs + `lib/spend/rates.ts` | ✅ Real | What the current setup column already shows |
| Chip summary (B), fold rows (C), drawer label (D) | derived from the same store values as the setup column | ✅ Real | Derived text, no new data |
| Model rail with per-image prices (E) | same catalogs and `lib/spend/rates.ts` as today's model list | ✅ Real | The rail drops the Up to / Search columns; prices stay |
| Engine menu label "9 engines · 2 free" (F) | engine registry | ✅ Real | Count of engines available to the feature, and which need no key |
| Model capability tags: 4K, 1K only, Search (F) | `GeminiImageModel.sizes`, `.supportsGoogleSearch` | ✅ Real | Gemini catalog today; other catalogs publish sizes too |
| Model tags "Text in images", "Fastest" (F) | prose in each model's `note` | ⚠️ Sometimes | Editorial, not a field: would need a short `strengths` list per model |
| "Retired · use 2.1" (F) | `deprecated` + `replacedBy` (shipped with M7) | ✅ Real | Gemini and fal image catalogs |
| 2-up equal results with Newest / Earlier labels (G) | `useImageResultFeed` order | ✅ Real | Same feed as E; the label is the only marker of the newest |
| Newest result featured, older runs as a strip (F) | `useImageResultFeed` order | ✅ Real | No selection state needed: the newest is always first |
| Results grid of 3 (B), filmstrip of 4 (C) | `useImageResultFeed` / cloud assets | ✅ Real | The stack already keeps the last 4 on screen |
| **Selected result on the stage (C)** | — | ❌ Aspirational | New UI state: which feed item is on the stage. Today the newest is always on top |
| **Prompt diff between two runs (D)** | — | ❌ Aspirational | Needs comparing two items' prompts (data exists per item; the diff UI does not) |
| **"Keep this one" (D)** | — | ❌ Aspirational | No keep/compare concept in the result feed today; the library's Pin is the nearest |
| **"Restore these settings" from a result (D)** | — | ⚠️ Sometimes | The library has Restore settings; result cards do not, and cloud items keep values in `metadata.values` only |

Implementation note: the "Unify Kie/Fal provider components" session (worktree
`nifty-mestorf-0a623d`) is reshaping these workspaces. Any variant that changes
`GenerationWorkspaceLayout` should land after it, or be coordinated with it.
