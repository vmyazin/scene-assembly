# Provider billing readout

Status: Approved design

## Context

The Spend page records Scene Assembly runs, but users cannot see whether a provider account is about to reject the next run. Kie already has a balance read used for cost estimation. Runware and Atlas publish read-only account billing APIs.

Vendor contracts: [Kie credits](https://docs.kie.ai/common-api/get-account-credits), [Runware account management](https://runware.ai/docs/platform/account-management), [Atlas billing public API](https://www.atlascloud.ai/docs/public-api).

## Goals

- Show current Kie credits and an actionable low-credit alert below 2,000 credits (approximately $10 at the published $0.005/credit rate).
- Show Runware balance and rolling usage; show Atlas available balance, cash/bonus split, and recent provider-reported cost.
- Read browser keys for browser spend and encrypted saved connections for account spend. Refresh on demand; never persist provider balances in the spend ledger.
- Keep provider-specific failures isolated and distinguish unavailable data from a zero balance.

## Non-goals

- Charging a payment method, configuring auto top-up, changing provider credentials, or treating vendor totals as this app's ledger totals.
- Unsupported billing APIs for fal, Comet, PiAPI, Gemini, Cloudflare, or Pollinations.

## Scope and implementation boundary

Provider GET/POST calls and response normalization live in `lib/billing/provider-readout.ts`. The browser proxy is `app/api/provider-billing/route.ts`; saved account secrets are read only inside `cloud/src/provider-billing.ts`. `components/spend/ProviderBilling.tsx` owns the presentation and refresh action. Do not change generation submission, spend capture, provider catalog pricing, or payment flows.
