# Dependency updates

The root app and `cloud/` are separate pnpm projects. Update and verify both lockfiles. `package.json` pins pnpm 12.14.0; `.github/workflows/deploy-account-worker.yml` must use the same version. Use `npx --yes pnpm@12.14.0` if the host's pnpm does not honor the pin. pnpm 12 stores package-manager resolution in a separate YAML document at the start of the root lockfile; preserve it.

## Tooling compatibility (2026-10-16)

- TypeScript 7.0.2 provides the `tsc` command through the root `@typescript/native` alias. The root `typescript` dependency aliases `@typescript/typescript6` 6.0.2, because typescript-eslint needs its JavaScript API. The Worker uses TS 7 directly. Follow [Microsoft's side-by-side guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0); do not replace the API alias blindly with the latest `typescript` tag.
- ESLint stays on the latest compatible 9.x patch (9.39.5). Current `eslint-plugin-react`, `eslint-plugin-import`, and `eslint-plugin-jsx-a11y` peer ranges exclude ESLint 10. Recheck those ranges before upgrading; do not suppress peer validation.
- Next 16.4 uses the project CLI for production typechecking by default. Its `agentRules: false` setting prevents `next dev` from rewriting this repo's maintained AGENTS.md. Read the installed framework guides in `node_modules/next/dist/docs/` when changing Next configuration.
- The obsolete Worker `managePackageManagerVersions` setting is removed; pnpm 12 no longer recognizes it.

## Verify

```sh
npx --yes pnpm@12.14.0 install --frozen-lockfile
npx --yes pnpm@12.14.0 --dir cloud install --frozen-lockfile
npx --yes pnpm@12.14.0 peers check
npx --yes pnpm@12.14.0 --dir cloud peers check
npx --yes pnpm@12.14.0 exec next typegen
npx --yes pnpm@12.14.0 exec tsc --noEmit
npx --yes pnpm@12.14.0 --dir cloud typecheck
npx --yes pnpm@12.14.0 test
npx --yes pnpm@12.14.0 --dir cloud test
npx --yes pnpm@12.14.0 lint
npx --yes pnpm@12.14.0 build
```

`next typegen` creates the gitignored `next-env.d.ts` if neither the worktree nor the main checkout has it. Without it, direct typechecking cannot resolve Next's image imports.

The named **Current stable packages smoke test** launch configuration uses web 3267 and Worker 8967. Start it inside the worktree:

```sh
ACCOUNT_WORKER_PORT=8967 DEV_FAKE_GENERATION=1 npm run dev -- --port 3267
ACCOUNT_DEMO_ORIGIN=http://localhost:3267 node scripts/seed-account-demo.mjs
```

Local generation exercises D1, Workflows, R2, downloads and imports without paid provider requests. Review the studio, video selection, sign-in and account pages in a browser before shipping.
