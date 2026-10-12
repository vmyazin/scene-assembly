# Describe source

## File map

- `lib/describe-source/contract.ts` — request limits and parsing
- `lib/describe-source/prompt.ts` — system prompt and validator
- `lib/describe-source/prepare.ts` — browser files to parts
- `lib/describe-source/gemini.ts` — Gemini vision fallback
- `lib/describe-source/browser.ts` — `requestSourceDescription`
- `lib/micro-ai/server.ts` — `runVisionTask`
- `app/api/describe-source/route.ts` — shared vision, then Gemini
- `components/DescribeSourceButton.tsx` — the action
- `components/ProviderVideoWorkspace.tsx` — prompt header
- `lib/video-frame.ts` — `descriptionSampleTimes`, `sampleVideoStills`

Do not modify: provider catalogs, Seedance draft/finalize payloads, `cloud/`.

## Tasks

- [x] Parse and validate a describe request, and reject anything that is not an image or video or that exceeds the body cap.
- [x] Call the shared vision model when `HF_TOKEN` is set, and fall through to the visitor's Gemini key.
- [x] Sample a long clip into ordered stills before upload.
- [x] Put Describe source on the provider video prompt, with a busy label and an error under the header. The returned paragraph replaces the prompt and stays editable.
- [x] Tests: validator, parser, route, button, workspace.

Verify: `pnpm exec vitest run tests/describe-source tests/providers/workspace.test.tsx tests/providers/video-edit-workspace.test.tsx tests/micro-ai`
