# Provider ranking implementation

Design: `../specs/2026-10-26-provider-ranking.md`.

## File map

- `lib/engines/registry.ts:45-161`: reorder image metadata entries.
- `components/ProviderSelector.tsx:15-27`: reorder video entries.
- `tests/video-workspace.test.tsx:75-346`: adjust existing display, keyboard and fallback expectations.
- `.claude/launch.json`: add isolated 3341 / 8941 review configuration.
- `AGENTS.md` and `CLAUDE.md`: route future ordering changes to the evaluation.

Do not modify: catalogs, rates, adapters, stores, account/cloud runtime, model defaults, CSS.

## Tasks

- [x] Inspect every exposed provider's catalog and current primary-source billing/queue documentation; record gaps and qualitative rationale in the spec.
- [x] Reorder the two display lists without migrating choices.
- [x] Update existing behavioral expectations in video-workspace tests.
- [x] Verify `pnpm exec vitest run tests/video-workspace.test.tsx tests/feature-cards.test.tsx`, `pnpm exec tsc --noEmit` and focused ESLint.
- [x] Smoke-test image order, video order and incompatible-direction fallback in the local browser.
- [x] Present localhost links for review; user approved commit and shipping on October 26, 2026.

## Local setup

In `.claude/worktrees/provider-ranking`: `pnpm install --frozen-lockfile --prefer-offline` and `pnpm --dir cloud install --frozen-lockfile --prefer-offline`. Copy ignored thumbnail JPGs from the main checkout if present. Next generates `next-env.d.ts`; no secrets copied. Start `ACCOUNT_WORKER_PORT=8941 DEV_FAKE_GENERATION=1 npm run dev -- --port 3341`.

## Verification results

14 targeted tests passed; TypeScript and focused ESLint passed; `git diff --check` passed. Browser verified all nine image choices in order, seven video choices in order, saved Gemini/Kie selections retained, and Kie → first/last frames resolving to fal with incompatible providers disabled. Screenshots saved outside the repository in the chat visualization folder. User approved the local review and requested commit and shipping on October 26, 2026.
