# UI terminology cleanup

Status: Approved design

## Context and goals
Engine and provider currently name the same user choice. Standardize visible
generation copy on Provider, Model, Mode, and Connection; share provider names.

## Non-goals
No changes to generation behavior, provider ordering, prices, model IDs, API
fields, storage or analytics contracts. Timeline render engines retain their name.

## Scope and implementation boundary
Presentation strings in components/, lib/brand.ts, lib/seo/json-ld.ts,
lib/moderation/classify.ts, and the Gemini catalog note. Canonical display names
live in lib/engines/registry.ts and feed selectors, connections and docs.
Update existing tests that locate renamed controls, and document vocabulary in
docs/ui-terminology.md with AGENTS.md and CLAUDE.md routes.
