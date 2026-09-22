# Plan: finished jobs in the job queue, with a destination per row

Spec: `docs/claude/specs/2026-09-21-queue-finished-jobs-design.md`

## File map

| path | target | change |
| --- | --- | --- |
| `lib/account/job-status.ts` | after `needsAttention` (l.13) | add `isSucceededJob` |
| `lib/account/job-location.ts` | new | job → library hash / studio href + store writes |
| `components/account/JobQueueOverlay.tsx` | l.34 filter, l.70-97 rows | keep succeeded while alive; link the rows |
| `components/account/AccountConsole.tsx` | l.77-80 filter init, l.343 grid | read `#asset-<id>`, pass `highlightAssetId` |
| `components/account/CloudAssetGrid.tsx` | props, `<li>` | accent ring + anchor id + scroll into view |
| `tests/account/job-queue-overlay.test.tsx` | append | succeeded rows and their links |
| `tests/account/job-location.test.ts` | new | href + store writes per provider/media |
| `tests/account/library.test.tsx` | append | highlight ring from the hash |

Do not modify: `components/account/CloudJobPanel.tsx`,
`components/account/CloudJobList.tsx`, `isListedJob`,
`components/account/AccountSessionProvider.tsx`, `store/useAccountStore.ts`,
anything under `cloud/`.

## Tasks

- [ ] `lib/account/job-status.ts`: add `isSucceededJob(job)` = `state === 'saved'`,
      with a note that `isListedJob` deliberately still excludes it.
      Verify: `pnpm vitest run tests/account`
- [ ] `lib/account/job-location.ts`: `libraryHashForAsset`, `studioLocationForJob`
      (returns `{href, select}` or `null` for a provider no workspace can show).
      Verify: `pnpm vitest run tests/account/job-location.test.ts`
- [ ] `JobQueueOverlay`: split `alive` from `succeeded`; render succeeded only in
      the expanded card, ordered after unfinished business; wrap each row in the
      link its state earns.
      Verify: `pnpm vitest run tests/account/job-queue-overlay.test.tsx`
- [ ] `AccountConsole` + `CloudAssetGrid`: `#asset-<id>` → `all` filter →
      `highlightAssetId` → ring + scroll.
      Verify: `pnpm vitest run tests/account/library.test.tsx`
- [ ] Typecheck and lint: `npx tsc --noEmit && pnpm lint`
- [ ] Production build: `pnpm build`
- [ ] Smoke test on port 3167 / worker 8867 with `DEV_FAKE_GENERATION=1`, seeded
      through `scripts/seed-account-demo.mjs`, then hand over the localhost link.
