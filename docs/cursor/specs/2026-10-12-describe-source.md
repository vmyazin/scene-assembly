# Describe a selected source into the prompt

Status: Approved design

## Context

A Seedance draft is only as good as the prompt that starts it, and a source
image or clip already contains the subject, motion, camera, and light. The
useful step is to read that source with a vision model and drop a detailed
paragraph into the prompt, which the person then edits before Generate or
before a 480p draft is finalized.

## Goals

- A **Describe source** action on the provider video prompt.
- It sends the selected source image, or the selected source video, to a vision
  model and writes the description into the draft prompt.
- The prompt stays editable. Nothing is submitted to a video provider by this
  action.
- Loading and error states are visible on the control.
- Same secret pattern as the other helper tasks: `HF_TOKEN` for the shared
  vision model, then the visitor's Gemini key. No new secret.

## Non-goals

- Not a face swap, a depth mask, or a way around a provider's content checks.
- Not an automatic generation. The person still presses Generate.
- Not a description of a source the workspace does not have selected.
- Not a change to Seedance draft or finalize pricing.

## Scope and implementation boundary

- Lives in `lib/describe-source/`, `app/api/describe-source/route.ts`,
  `components/DescribeSourceButton.tsx`, and the prompt header of
  `components/ProviderVideoWorkspace.tsx`.
- The shared vision call is `runVisionTask` in `lib/micro-ai/server.ts`,
  because that file already owns `HF_TOKEN` and the rule that a provider
  failure collapses to null.
- Frame sampling for a clip that will not fit in the request lives in
  `sampleVideoStills` (`lib/video-frame.ts`), next to the other canvas reads.
- Does not change provider catalogs, draft/finalize payloads, or the cloud
  Worker.
