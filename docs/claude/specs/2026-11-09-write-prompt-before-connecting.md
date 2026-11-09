# Write a prompt before connecting a key

Status: Approved design (the owner's comments on the onboarding UX review, 2026-11-09)
Findings: SA-05, SA-08, SA-10. SA-02 is declined: free engines exist to test that the product works, are low quality, and do not become the first path.

## Follow-up decision (2026-11-09): Generate stays short and disabled

The owner's feedback on PR #31 overrides the goal below that has Generate ask for the key. With no key, Generate keeps its normal label and is disabled, and `aria-describedby` points at the callout's heading. The callout's Connect key is the way forward. `ConnectToGenerateButton` is removed. Writing a prompt before connecting still works, and the prompt still carries across providers.

## Follow-up decision (2026-11-09): SA-01

The owner declined the free shortcut SA-01 proposed. Make the key gate clearer instead: `ConnectKeyCallout` says what is needed and why, and gives two steps, a link to the vendor's key page and pasting the key into Connections. `Connect key` already opens that dialog with the provider's field focused, and validation and storage live there, so there is no second paste field. `alternative`, which had no caller, is removed. The provider order does not change.

## Context

A guest with no provider key saw a dimmed, inert workspace, so they could not write a prompt until they had fetched a paid key. The owner's direction is to get the commitment after the prompt is typed, and to let that same prompt run on a provider the person does have a key for. The sign-up page never said what an account adds. Retired models appeared in first-run model lists at twice their successor's price.

## Goals

- Every provider workspace is usable with no key: prompt, controls and model choice.
- Generate asks for the key once there is a prompt to run. Before that, a press asks for the prompt.
- A prompt written before connecting survives connecting and switching provider.
- The sign-up card names three things an account adds, each true today. Sign-in is unchanged.
- A retired model is not listed unless it is the current selection.

## Non-goals

- Elevating free engines, or changing the provider order (SA-02 is declined).
- Adding sign-in methods. Google-only is intentional.
- Removing retired models from the catalog, the agent `list_models` schema, or the Worker. They stay runnable.
- Silently migrating a saved selection.

## Scope and implementation boundary

- `components/ConnectionGate.tsx`: the callout above an unlocked workspace.
- `components/GenerateActions.tsx`: Generate disabled while there is no key. `GeminiVideoWorkspace` has its own button and follows the same rule.
- Each workspace's submit guard asks for the prompt first when there is no key.
- `lib/models/retired.ts`: the one filter, applied where picker rows are built.
- `components/account/AccountAccess.tsx`: the sign-up benefit list.

Do not touch `useDraftStore`: its image/video prompt scopes already carry the text across providers. Do not touch the provider catalogs or anything under `cloud/`.

## Facts the sign-up copy relies on

- 1 GB: `FREE_BYTES` in `cloud/src/jobs.ts`.
- Jobs outlive the tab: accepted jobs run in a Worker Workflow, enabled for every provider in `CLOUD_GENERATION_PROVIDERS`.
- Encrypted keys: account connections are encrypted with `ACCOUNT_ENCRYPTION_KEYS`.
