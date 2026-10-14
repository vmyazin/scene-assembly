# Actionable failed-job details
Status: Approved design

## Follow-up decision — 2026-10-12
User review found the first implementation too verbose. At rest, show a short cause and one next step, with actions sharing a wrapping row. Move the full explanation, provider quote and retry history into Issue details. Keep the diagnostic capture and recovery behavior unchanged. This overrides the initial always-visible explanation.

## Follow-up decision — 2026-10-12, redundant state label
Remove the generic Needs attention label from individual rows: the specific cause already identifies the problem. Keep the library filter and queue count, which still help navigation. Other job state labels remain.

## Context and goals
Failed jobs repeat a broad sentence and hide which run failed and what evidence is available. Make the failure understandable at rest, offer a concrete next step, and expose copyable diagnostics on demand on every CloudJobList surface. Retain specific sanitized capture errors for future jobs; explicitly acknowledge missing detail on older jobs.

## Non-goals
No paid retries, provider policy changes, new result hosts, database migration, new endpoints, or changes to resume eligibility, billing, retention, and account isolation.

## Scope and implementation boundary
`lib/account/job-failure.ts` owns next-step guidance. `components/account/JobFailureDetails.tsx` owns the disclosure and diagnostic copy. `CloudJobList` adds run identity and composes these for attention and failed rows. `cloud/src/failure.ts` permits only sanitized, app-authored AccountError capture messages; `generation-runner.ts` records those inside the failing step. `assets.ts` includes HTTP status and safe host context without paths or query strings. Existing provider download recovery stays explicit and owner-scoped.

## Acceptance
Location failures explain that automatic saving was blocked, give a download-first next step, and distinguish an eligible save retry from a blocked or exhausted one. Details include the full prompt, provider/model, job reference, reason/code, timestamps, attempts, and recorded error or an honest missing-detail fallback. Copy reports exclude prompt/media URLs and credentials. Terminal rows never instruct the user to resume. Mobile layout wraps without horizontal overflow. Tests cover persisted capture evidence, redaction, legacy rows, retry limits, copy success/failure, and provider attribution.
