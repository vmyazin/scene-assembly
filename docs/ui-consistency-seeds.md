# UI consistency seeds

Read this before running the `ui-consistency` skill or any duplication / component
extraction pass. Scan roots: `components/`, `app/`. Never scan `.claude/` — it holds
worktree copies of the whole repo and doubles every count.

## The cascade rule (why a utility might do nothing)

Shared component classes in `app/globals.css` live in `@layer components`, and the
element defaults for `input`, `textarea` and `select` in `@layer base`. A Tailwind
utility on the same element therefore wins, as it does everywhere else in Tailwind.

Until October 2026 they were unlayered, and an unlayered rule beats every layered one
regardless of specificity: `btn-secondary text-xs` rendered at `--text-ui`, and about
400 utilities silently did nothing. Those dead utilities were removed when the classes
moved, so rendering did not change.

Deliberately unlayered, because they must keep winning:

- `.display` — its tight leading and tracking are the heading role, so they beat the
  line-height a `text-*` size brings along. `leading-*` / `tracking-*` on a `display`
  heading still do nothing.
- The phone-only block (`@media (max-width: 639px)`: `dialog-mobile-sheet`,
  `dialog-safe-footer`, `dialog-touch-targets`, `image-lightbox-*`) — it overrides the
  wider-screen padding and sizing a dialog sets.

```bash
# Top-level (unlayered) class rules. Anything here that is not .display or a
# deliberate override belongs inside @layer components.
rg -n '^\.[a-z]' app/globals.css
```

## Already extracted — do not re-create

| Helper | Use it for |
|---|---|
| `lib/format-bytes.ts` `formatBytes` | binary file sizes (account storage uses `formatAccountBytes`, which counts in 1000s) |
| `lib/save-file.ts` `saveBlobAs`, `clickDownload` | saving a blob or URL through a temporary link |
| `lib/file-data-url.ts` `fileAsDataUrl` | reading a picked or dropped file into a `data:` URL |
| `components/ConfirmDialog.tsx` | portals itself; render it with `open={…}`, never inside `createPortal` or a conditional mount (the exit animation needs it mounted) |
| `components/ModalShell.tsx` `ModalShell`, `ModalHeader`, `ModalBody`, `SHEET_PANEL_CLASS` | any modal: portal, backdrop, motion, focus trap. Keep it mounted and drive it with `open` |
| `components/StatusPill.tsx` `StatusPill`, `JobStatusPill`, `STATUS_TONE_CLASSES` | state chips ("Connected", "Done · 0:42") and any success / warning / danger / neutral tint |
| `lib/media/use-object-url.ts` `useObjectUrl`, `useObjectUrls` | object URLs for previews; never create one in a `useMemo` (StrictMode leaves it revoked) |
| `lib/jobs/use-queued-job-polling.ts`, `store/createJobStore.ts` | a provider whose jobs are polled until terminal |

Not yet on `ModalShell`: `YouTubeClipDialog` (a `glass-card` panel with no motion) and
`RelaxedConsentDialog` (`z-[80]`, no blur, not a phone sheet). Moving them changes how
they look, so it is a deliberate alignment, not a refactor.

Two downloads still free their object URL after a 10 s delay instead of at once
(`GeminiVideoWorkspace` `downloadBlob`, `lib/account/download.ts`). No reason is recorded;
settle that before moving them onto `saveBlobAs`.

## Intents that never rendered

These were written but never showed, because an unlayered class overrode them. They
were removed to keep the shipped look. Each is a deliberate one-line change if wanted:

| Where | What it asked for |
|---|---|
| `FalGenerationWorkspace`, `KieGenerationWorkspace`, `ProviderVideoWorkspace`, `TimelineTrack`, `ConnectKeyCallout`, `account/AccountPageShell` | accent colour on an `eyebrow` (cyan, purple, brand accent) |
| `GenerationInterface` error card, `app/spend/page.tsx`, `spend/SpendReport` | red / pink border on a `glass-card` error state |
| `spend/SpendDailyChart` | hover-colour border on a `glass-card` |
| `TimelineList`, `TimelineTrack` empty drop zones | dashed border on the `glass-card`, and a cyan border + tint while dragging over it (`activeClassName`) |
| `MediaCard` selected state | cyan / purple glow (the `--glow-cyan` / `--glow-purple` shadow tokens) |
| `account/ConnectedAgentsPanel`, `account/CloudAssetGrid` | red text on destructive `btn-secondary` buttons |
| `account/ConnectionStorageControl` | cyan text and border on the "Save to account" button |
| `ApiKeyConfig` key field | `pr-11` so typed text clears the show/hide button |
| `TimelineOutputFormat` width / height / fps fields | `px-1.5 py-0.5 text-[0.8125rem]`; without it a four-digit width clips in the 4.5rem field |
| `YouTubeClipDialog`, `ModelControls` | muted / subtle text colour on an input |
| phone dialogs (`.dialog-touch-targets`) | 48px text fields; buttons, selects, textareas and toggles already get it |
| compact `btn-*` call sites (`px-2 py-1 text-xs` and similar, ~90 sites) | smaller buttons than the default control |

Two consequences of the move are visible only in computed styles, not on screen:
a `btn-*` that had a `text-xs`/`text-sm` lost that size's line-height (20px → 21px
inside a fixed-height button), and `[cmdk-input]`'s own `min-height: 0` now applies
(its padding already made it taller than 36px).
