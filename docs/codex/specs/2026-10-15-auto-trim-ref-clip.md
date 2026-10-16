# Automatically fit selected video clips
Status: Approved design

## Context and goals
The shared source picker rejects a library clip whose actual container duration is over the selected model's limit, including a nominal ten-second clip with audio padding. Keep the beginning of an overlong selection in a temporary MP4, preserve its audio, and show the actual accepted duration. Leave library originals intact. Apply the same preparation to uploaded reference videos, respecting remaining total duration.

## Non-goals
No manual range editor, audio-only trimming, automatic model-switch edits, provider-limit changes, paid generation, or deployment before local sign-off.

## Scope and implementation boundary
`lib/media/trim-video.ts` owns browser-only conversion and output probing. `VideoSourceInput` and `ReferenceClipTray` call it before accepting selections and re-run existing validation on the resulting file. Invalid dimensions, minimum duration, MIME and byte limits still fail. Keep model/account/unmount guards. Release a staged YouTube input when replaced by trimmed bytes; preserve provenance with its end updated to the selected range. Do not modify provider requests, Worker validators, library assets, billing or timeline rendering.

Conversion reserves 100 ms below the ceiling for video frames and audio packet padding, then probes actual bytes: a file still above the limit is refused. No silent audio-track loss. This uses the installed Mediabunny conversion API and keeps it dynamically loaded.
