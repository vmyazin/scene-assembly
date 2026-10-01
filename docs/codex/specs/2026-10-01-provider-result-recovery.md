# Recover a blocked provider result
Status: Approved design
Date: 2026-10-01

## Context
A completed generation can fail cloud capture with `result_location`. The row offers only removal. Even after a deployment approves that host (as happened for Atlas's storage bucket), the immutable failure reason still forbids resume.

## Goals
- Let an existing job retry saving when all stored result addresses pass the current capture policy, without submitting another paid generation.
- Offer an explicit way to retrieve the provider's existing download links when capture remains blocked. Explain that these open outside the app and may expire.
- Retain owner/session isolation, bounded resume attempts, and the strict server fetch allowlist.

## Non-goals
No arbitrary server URL fetching, new provider domains, regeneration, migration, storage quota changes, or automatic navigation to external links. No production data used for fixtures.

## Scope and implementation boundary
URL policy lives in `lib/account/result-location.ts`; typed capture errors remain in `cloud/src/assets.ts`. `cloud/src/result-recovery.ts` derives retry eligibility and owner-requested recovery metadata from existing stored results. `jobView` and `resumeJob` use the same eligibility check. The authenticated `/jobs/:id/recovery` read exposes only bounded HTTPS browser links and a task reference; ordinary job lists never expose signed URLs. `CloudJobList` composes `ProviderResultRecovery` across all existing surfaces, with account epoch guards. Provider submission, generation-runner, spend, and asset ingestion remain untouched.

## Acceptance
A previously blocked, now-approved host offers Retry saving and saves the same job without provider submit/poll. A still-unsupported public HTTPS host offers a manual provider download without server fetch. Invalid/local/IP URLs are not links. Wrong-owner and removed jobs are inaccessible. Resume caps still hold and expired-link reasons retain their existing behavior.
