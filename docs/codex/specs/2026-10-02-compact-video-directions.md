# Compact video directions

Status: Approved design

## Follow-up refinement — 2026-10-12
Direction tiles use equal-width grid columns (two on small screens, three from `sm`, five from `lg`), with wrapping labels and fixed-size icons so longer names do not widen their tile. Provider choices now sit under the eyebrow “Generation engine” with 48px minimum height, 18px icons, 14px labels and subtle persistent card borders. They remain smaller than the 76px direction tiles, so both groups are readable while direction stays primary.

## Follow-up decision — 2026-10-12
The direction choices now use the larger bordered provider-tile treatment (22px icons, semibold labels, 76px minimum height), while provider choices use the former compact direction treatment (16px icons and 12px labels). This supersedes the compact direction dimensions and the provider-layout non-goal below. Both groups wrap; delayed direction previews, keyboard navigation, and selection remain unchanged. The styling lives in `VideoDirectionSelector.tsx` and `ProviderSelector.tsx`, because the visual hierarchy should prioritize what to make over which provider runs it.

## Context
The user selected exploration A, amended to reveal its image and details only after a one-second hover and remove the permanent detail line. Large direction cards currently displace the generation controls.

## Goals
Render compact icon/name buttons with the selected violet treatment. Show a 304px, 16:9 illustration preview with title, description, requirement and conditional provider caveat after 1,000 ms of hover or keyboard focus. Cancel pending previews on exit; keep the card reachable by pointer; dismiss with Escape/outside press; let touch selection reveal it. Fit the card within the viewport without moving page content.

## Non-goals
Provider/model changes, submission or billing changes, persistence, hero/provider layout changes, new assets, new UI dependencies, or deployment before review.

## Scope and implementation boundary
`components/VideoDirectionSelector.tsx` owns compact buttons, preview timer, positioning and lifecycle. `components/VideoWorkspace.tsx` keeps MODES, provider filtering, selection callbacks and workspace routing, replacing only the media-card selector with the new component. Key the selector by provider to clear transient previews on provider changes. Use the source's five existing illustrations and copy. Never modify provider catalogs, stores, request code, generation workspaces or MediaCard used by the landing page.

## Acceptance
One compact row at desktop and wrapping choices on mobile; no permanent help row. Hover/focus preview appears after one second, cannot open from a cancelled/unmounted timer, and never changes the selected mode by itself. Selection and provider fallbacks remain functional. Match the approved reference proportions and review five-mode/two-mode states locally.
