# Shared results across models
Status: Approved design

## Follow-up decision — 2026-10-02
Rebasing for shipment encountered newer shared image-feed and job-card changes on main. Preserve that image feed across providers and input modes, uploaded-reference exclusion, and the updated job cards. This overrides the earlier image scope boundary and isolation assertion; video results still share models within provider/input mode. Re-run targeted tests and browser smoke after resolving the overlap.


## Context and goals
Selecting another model currently hides previous jobs and outputs. Model selection should affect the next submission, while results stay shared across models in the same provider, media type and input mode. Existing image display caps and video presentation remain in place. Result labels and downloads must identify the model that actually ran.

## Non-goals
No merging guest and account storage, provider workspaces, input modes or media types. No new history UI, changes to generation payloads, pricing, retention or deployment before local review.

## Scope and implementation boundary
Remove model and edit-submission filtering from `CloudJobPanel`, and model filtering from the browser result selectors in `ProviderVideoWorkspace` and `KieGenerationWorkspace`. Call sites specify workspace scope without a model. fal browser jobs and the general browser image stack already share results and retain their behavior. Preserve account owner/epoch guards and all submission validation.

## Acceptance
A P-Video-Edit result remains visible after selecting Seedance 2.5 and back. Pending jobs from either model remain visible. New edits keep the previous saved result visible while running. Kie browser images from different models share the existing stack. Other providers, input modes and media types stay outside the panel. Account changes clear the shared results through the existing store.
