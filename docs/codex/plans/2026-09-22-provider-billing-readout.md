# Provider billing readout plan

## File map

- `lib/billing/provider-readout.ts:1-220`: vendor reads, parsing, stable response type.
- `app/api/provider-billing/route.ts:1-60`: first-party browser-key proxy.
- `lib/account/gateway.ts:9-15`: explicit account route allowlist.
- `cloud/src/provider-billing.ts:1-90`, `cloud/src/index.ts:45-65`: saved-connection route.
- `components/spend/ProviderBilling.tsx:1-230`, `app/spend/page.tsx:1-145`: readout and placement.
- `docs/codex/account-development.md`, `AGENTS.md`: development and routing notes.

Do not modify: generation submission, `lib/spend/capture.ts`, `lib/spend/rates.ts`, or account schema.

## Tasks

- [x] Add normalized read-only Kie, Runware and Atlas billing readers and verify with `pnpm exec vitest run tests/billing/provider-readout.test.ts`.
- [x] Add guest and account routes with key isolation and verify with `pnpm exec vitest run tests/billing/provider-routes.test.ts` and `pnpm --dir cloud exec vitest run tests/provider-billing.test.ts`.
- [x] Show provider data and Kie alert on Spend, then verify with `pnpm exec tsc --noEmit` and the affected page on localhost.
- [x] Update routing/development docs and run focused smoke checks.

## Follow-up decision · 2026-09-22

The local signed-in smoke test returned 404 at the Next account gateway before reaching the Worker. Add `provider-billing` to its explicit allowlist and recheck the account page. This amends the route task above.
