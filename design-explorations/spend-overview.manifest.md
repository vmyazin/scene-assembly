# Spend overview — data manifest

These values come from the signed-in account in the 2026-10-15 screenshot. They are not invented.

| Element | Field path | Class | Notes |
| --- | --- | --- | --- |
| Range total `$13.11` | `SpendTotals.costUsd` (range) | ✅ Real | `useAccountSpendTotals(ownerId, rangeStart)` |
| Runs `81` | `SpendTotals.runs` | ✅ Real | |
| Exact `10%` | `exactUsd / costUsd` | ✅ Real | Already derived in `SpendSummary` |
| Exact `$1.35` (B, D) | `SpendTotals.exactUsd` | ✅ Real | The field exists but isn't displayed today |
| Estimated `$11.76` | `SpendTotals.estimatedUsd` | ✅ Real | |
| Unpriced `13 runs` | `SpendTotals.unknownRuns` | ✅ Real | |
| All time `$30.29` · `17 unpriced` | All-time `SpendTotals` (no range start) | ⚠️ Sometimes | Shown in the screenshot, but the "All-time spend" card isn't on `main`. Only `SiteFooterControls` reads an all-time total there |
| Atlas `$18.85` | `ProviderBillingSnapshot.balance` (unit usd) | ✅ Real | |
| Atlas `$4.17 / 30d` | `snapshot.spentLast30Days` | ⚠️ Sometimes | Atlas only; Kie and Runware don't report it |
| Kie `575.8 cr` · `≈ $2.88` | `snapshot.balance` (unit credits) × `KIE_USD_PER_CREDIT` | ✅ Real | |
| Low state | `balance < KIE_LOW_CREDITS (2000)` | ✅ Real | Kie only |
| Runware unavailable | `result.error` | ✅ Real | Currently returns "Provider billing is unavailable." |
| Checked time | `snapshot.fetchedAt` | ✅ Real | One per provider; the variants show a single shared time |
| Bonus | `snapshot.bonus` | ⚠️ Sometimes | No variant draws it. A and D have no slot for it, and B and C would add it as a sub-line or column |
| Status `OK` pill (C) | — | ❌ Aspirational | Derived in the view only: snapshot present and not low |

## Variant D implementation decisions (2026-10-15)

Reference: `spend-overview-D.reference.html`. The user asked for two changes from the mock: Kie shows dollars first with credits underneath, and the range options are This month, Last 7 days and Last 30 days, with All time removed.

| Gap | Decision |
| --- | --- |
| Atlas `$4.17 / 30d` (the mock dropped it) | **Kept** in the column's hint line, because the billing spec lists recent provider-reported cost as a goal |
| Bonus | **Kept** as `incl. $x bonus` in the hint line, shown only when there is a bonus |
| Unpriced legend item | **Moved** into the total's hint (`10% exact · 13 runs unpriced`). An unpriced run has no dollar width, so it can't be drawn as a bar segment |
| Low-credit banner | **Replaced** by the Low pill, amber value and "Add credits" link, plus a screen-reader-only `role="alert"` |
| All-time range | **Removed** from `SpendRange` (an old `?range=all` link falls back to This month). The All time tile reads `useAccountSpendTotals(ownerId)` |
| No records yet | The balances tile is shown alone and the range control stays hidden. The empty-state preview ghost now has the bento shape |
| Separate-from-ledger explainer | **Moved** to the heading's tooltip, because the tile has no room for a sentence |
