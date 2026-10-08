# Compact video directions

Status: Approved design

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
