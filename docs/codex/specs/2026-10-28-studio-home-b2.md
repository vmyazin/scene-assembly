# Studio home B2

Status: Approved design

## Follow-up decision — 2026-10-28
The final approved implementation uses 16:9 frames for mode tiles and Recent creations, superseding the fixed thumbnail heights below. The headline is “Make images. Create motion.” and the supporting line is “Generate, edit, and combine images and video with the right AI model for the job.”

## Context and goals
The user selected B2 from `design-explorations/studio-home-b-options.html`, explicitly keeping equal image/video emphasis, and approved sourcing the recent row from existing libraries with an empty state. Show six image modes and five video modes as equal-size thumbnail tiles in two equal-width families. Route each tile to its existing workspace, preserving browser history and provider compatibility handling.

## Scope and implementation boundary
`StudioLauncher` replaces only Studio's initial picker. `lib/video/directions.ts` shares existing mode metadata with VideoWorkspace. `RecentCreations` selects browser/account library and exposes four read-only recent previews using existing grids. `RecentCreationGrid` owns their compact presentation and library entry action. StudioHeader has a neutral home state. Reuse theme tokens and existing modal/video behavior.

## Non-goals
No generation, billing, provider, storage-schema, or guest About changes. No deploy, commit or push without authorization. No mock fixture data in production.

## Deliberate adaptations
Keep the real StudioHeader and guest About section. On phones, stack the two families with identical two-column tile grids so neither receives smaller controls. The thumbnail remains 75px high; recent previews remain 58px. Text is 12px with 10px requirements, slightly larger than the compressed comparison canvas. Recent cards open the existing library rather than duplicate its actions. Loading, unavailable preview, error and zero-record states remain explicit. The recent feed is chronological, not artificially balanced by media type.

## Follow-up: family panels
The user requested separate parent containers for the two grids, with faint on-brand background colors. Each family gets equal padding, border, radius and height; image uses a restrained yellow tint and video a restrained violet tint. This intentionally adds grouping surfaces to the B2 reference without changing the shared tile dimensions.

Mode thumbnail follow-up: use responsive 16:9 artwork frames for both Image and Video, replacing the fixed 75px crop.

Recent creations thumbnail follow-up: use the same responsive 16:9 frames for both images and videos, replacing the fixed 58px strip.

## Follow-up decision — dedicated Image destination
The Image navigation opens `/?workspace=image`, a dedicated six-mode image picker using FeatureSelector. The wordmark opens `/`, the balanced home launcher. Leaving an image tool returns to the image picker, including when the tool was opened from a direct link. Header links from the timeline use the same explicit image destination.

## Follow-up decision — hero styling and motion
Restore the prior “Create stunning images with AI power” hero on the dedicated Image picker, including its centered gradient treatment and provider badges. Home keeps the approved “Make images. Create motion.” copy with matching centered typography. Its full headline uses layered brand-color gradients drifting over 24 seconds, reversing smoothly; reduced-motion preferences disable the animation.
