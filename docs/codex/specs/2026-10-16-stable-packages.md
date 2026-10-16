# Current stable dependencies

Status: Approved design

## Follow-up decision — 2026-10-16
Use the latest compatible ESLint 9 patch until Next's React/import/accessibility plugins support ESLint 10. Use Microsoft's documented TS 7 CLI / TS 6 API aliases at the root so current stable typechecking and lint can coexist. Disable Next's automatic AGENTS.md rewrites in `next.config.ts`, retaining the repo's own routing and a dependency-maintenance guide.

## Context and goals
Update the web app and isolated account Worker to the npm registry's current stable releases on 2026-10-16. Keep paired runtime/type packages and the package manager used in CI aligned. Regenerate both lockfiles and verify installation, types, tests, lint, production compilation, and the local account flow.

## Non-goals
No product redesign, provider changes, production data access, or deployment. No prerelease packages. No unrelated cleanup of pre-existing failures.

## Scope and implementation boundary
Dependency declarations live in `package.json` and `cloud/package.json`; resolution lives in their `pnpm-lock.yaml` files. Package-manager build policy lives in both `pnpm-workspace.yaml` files; CI pins live in `.github/workflows/deploy-account-worker.yml`. Only make source/config/test changes required for compatibility with these updates. Register the local review ports in `.claude/launch.json`.

Do not modify provider catalogs, rates, database migrations, authentication policy, or secrets. Shipping awaits localhost review per AGENTS.md.
