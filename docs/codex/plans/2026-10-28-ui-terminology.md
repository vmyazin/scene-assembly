# UI terminology cleanup plan

## File map
- components/ImageRail.tsx:16-145, ProviderSelector.tsx:15-110, VideoDirectionSelector.tsx:111-112: selector text and accessible names.
- components/ApiKeyConfig.tsx:48-80,566-755; CommandPalette.tsx:365-375: connection text and provider labels.
- lib/engines/registry.ts:1-160 and docs.ts:1-80: canonical provider labels.
- components/VideoWorkspace.tsx:12-160 and GeminiVideoWorkspace.tsx:396-548: shared names.
- components/marketing/LandingIntro.tsx:81-146, SiteFooter.tsx:60, lib/brand.ts:10-43, lib/seo/json-ld.ts:30: public copy.
- lib/moderation/classify.ts:66-72, components/RelaxedConsentDialog.tsx:37, components/spend/ConfidenceBadge.tsx:12: feedback copy.
- docs/ui-terminology.md, AGENTS.md, CLAUDE.md: vocabulary and routing.

Do not modify: API request shapes, persisted keys, internal IDs, provider order,
generation logic, timeline rendering, migrations or prices.

- [x] Update copy and shared names; verify with git diff --check.
- [x] Update existing accessible-name assertions; run targeted vitest tests.
- [x] Run TypeScript and lint checks.
- [x] Smoke-test image/video selectors and Connections on localhost:3193.
- [x] Present preview for approval before shipping. User approved: “Looks good, ship it.”

Validation: 13 targeted test files passed (323 tests), TypeScript and changed-file ESLint passed. Browser smoke checked image provider switching, fixed-model labels, video Mode/Provider labels, and the Connections dialog. No generation submitted.

Setup: ran pnpm install --frozen-lockfile --prefer-offline and pnpm --dir cloud install --frozen-lockfile; copied ../../../next-env.d.ts when available and ../../../public/thumbnails/*.jpg into public/thumbnails/. Local cloud/.dev.vars comes from the example with DEV_FAKE_GENERATION=1; no production credentials copied. Next generated next-env.d.ts on startup.
