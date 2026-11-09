# Plan: write a prompt before connecting a key

Spec: `docs/claude/specs/2026-11-09-write-prompt-before-connecting.md`

## File map

- `components/ConnectionGate.tsx`, `components/ConnectKeyCallout.tsx`, `components/PromptPanel.tsx`
- `components/GenerateActions.tsx`
- `components/GenerationInterface.tsx`, `components/ProviderVideoWorkspace.tsx`, `components/FalGenerationWorkspace.tsx`, `components/KieGenerationWorkspace.tsx`, `components/GeminiVideoWorkspace.tsx`
- `components/account/AccountAccess.tsx`
- `lib/models/retired.ts`

Do not modify: `store/useDraftStore.ts`, `lib/providers/catalog.ts`, `lib/engines/gemini-catalog.ts`, `lib/fal/catalog.ts`, `cloud/**`, the provider rail order.

## Tasks

- [x] Remove the dim, `inert` and overlay from `ConnectionGate`, and the `isGated`/`paused` wiring. Verify: `pnpm exec vitest run tests/connection-gate-parity.test.tsx tests/providers/connect-key-callout.test.tsx`
- [x] Ask for the key at Generate once a prompt exists, across all five workspaces. Verify: `pnpm exec vitest run tests/generation-interface.test.tsx tests/fal/workspace.test.tsx tests/providers/workspace.test.tsx`
- [x] Hide retired models from picker rows unless selected. Verify: `pnpm exec vitest run tests/models/retired.test.ts`
- [x] List what an account adds on sign-up. Verify: `pnpm exec vitest run tests/account/account-access-return.test.tsx`
- [x] Follow-up (SA-01): make `ConnectKeyCallout` say what is needed, why, and the two steps, and remove the unused `alternative` prop. Verify: `pnpm exec vitest run tests/providers/connect-key-callout.test.tsx tests/api-key-focus.test.tsx`
- [x] Follow-up (PR #31 feedback): remove `ConnectToGenerateButton`; Generate keeps its label and is disabled with no key. Verify: `pnpm exec vitest run tests/connection-gate-parity.test.tsx tests/providers/connect-key-callout.test.tsx`
- [x] Full suite, typecheck and lint against unmodified main. Verify: `pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm lint`
