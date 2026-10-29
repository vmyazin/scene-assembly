# B2 implementation

## File map
- `components/Studio.tsx`: picker branch and existing URL setters.
- `components/StudioLauncher.tsx`: new home-only tile composition.
- `lib/video/directions.ts`, `components/VideoWorkspace.tsx`: shared existing metadata.
- `components/StudioHeader.tsx`: home neutral active state.
- `components/RecentCreations.tsx`, `components/RecentCreationGrid.tsx`: source choice and compact preview.
- `components/GalleryGrid.tsx`, `components/account/CloudAssetGrid.tsx`: additive read-only recent mode; existing actions unchanged.

Do not modify: provider adapters/catalogs, account APIs, billing, database schemas, LandingIntro, generation forms.

- [x] Extract B2 reference and record the user's library decision.
- [x] Implement the launcher and source recent results from existing grids.
- [x] Verify all eleven actions and account/browser separation with targeted tests.
- [x] Run `pnpm exec tsc --noEmit` and targeted ESLint.
- [x] Run full local services on web 3347 / Worker 8947; compare empty and seeded screenshots with reference, test mobile and navigation.
- [x] Deliver local preview and screenshots, keeping deployment gated on user review.
