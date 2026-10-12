# Seedance 2.5 draft, then finalize

## File map

- `lib/providers/seedance-draft.ts` — sizes, finalize checks, error sentence, catalog estimate.
- `lib/providers/runware.ts` — draft task, finalize task, poll `outputs.draftId`, expired id.
- `app/api/providers/video/route.ts` — `operation: 'finalize'` before the prompt check.
- `cloud/src/provider-adapters/aggregators.ts` — validate and submit both shapes.
- `lib/account/model-schema.ts` — `draft` default false; Seedance edit size default `480p` for agents only.
- `lib/spend/account.ts`, `lib/spend/capture.ts` — catalog fallback only for draft and finalize.
- `components/FinalizeDraftButton.tsx` — price, then Approve.
- `cloud/src/mcp/tools/jobs.ts` — `finalize_draft`.
- `app/docs/mcp/guide.md` — the tool and `draft_unavailable`.

Do not modify P-Video-Edit request shapes, fal/Kie workspaces, or the timeline.

## Tasks

- [x] Provider request shapes and 1080p edit tier.
- [x] Persist `draftId` on guest jobs, gallery records, cloud jobs, and assets.
- [x] Price drafts at the documented 480p rate and finalizes at the documented 1080p rate, labeled estimated.
- [x] Draft control and two-step finalize on the result, the gallery, and the cloud library.
- [x] MCP `finalize_draft`, separate from `generate`, budget-checked, strict about prompt and media.
- [x] Tests with mocked Runware. No live paid call.
