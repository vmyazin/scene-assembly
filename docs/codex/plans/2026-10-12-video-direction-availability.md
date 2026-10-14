# Direction-first engine availability

File map: `components/VideoWorkspace.tsx` capability checks and routing; `components/ProviderSelector.tsx` availability and keyboard traversal; `tests/video-direction-availability.test.tsx` regression coverage.

Do not modify: provider catalogs, stores, generation forms, submission, or billing.

- [x] Keep every direction visible and resolve a compatible engine before mounting its workspace.
- [x] Disable unsupported engines and skip them in keyboard navigation.
- [x] Verify with `pnpm exec vitest run tests/video-direction-availability.test.tsx tests/video-direction-selector.test.tsx` and scoped ESLint.
- [x] Verify disabled engine cards and their tooltip in the running browser preview. All directions and engines remain visible in reference mode; disabled Kie displays the explanation without changing the selected Runware engine. Ten regression tests and scoped ESLint pass; TypeScript passed for availability routing. Direction transitions and deep links are covered by regression tests.
