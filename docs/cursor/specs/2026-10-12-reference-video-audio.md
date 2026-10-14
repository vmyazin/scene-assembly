# Reference video and audio

Status: Approved design

## Context

Seedance 2.5 on Runware, and the Atlas Seedance reference-to-video models, accept reference video and reference audio in addition to images. A draft may include those clips. Finalize sends only the draft id and 1080p, and must not resend them.

## Goals

- Attach reference video and/or reference audio in the video workspace.
- Send them only to models whose catalog entry lists `referenceClips` for the current mode.
- Hide the controls otherwise. Disable them for Atlas in the browser, which has no hosted file.
- Validate type, size, duration, and the vendor's dimension bounds before submit.
- Keep edit mode and the source-video picker unchanged.

## Non-goals

- Describe source, depth masks, vocal isolation, or any other workflow from the Higgsfield video.
- LTX audio-to-video endpoints, Kling reference images, and MiniMax image refers.
- Raising the app video cap above 100 MB to match Runware's 200 MB page.

## Boundary

Capability and messages live in `lib/providers/reference-clips.ts`. The tray is `components/ReferenceClipTray.tsx`. Cloud ids are `referenceVideoIds` and `referenceAudioIds` on `CloudJobRequest`, ordered after images and before the edit source inside `jobInputIds`.
