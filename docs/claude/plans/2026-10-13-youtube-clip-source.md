# YouTube Clip Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in person (or their MCP agent) paste a YouTube link, choose From/To markers, and use that section as the source clip for Edit video.

**Architecture:** One Worker function, `importYouTubeClip`, backs both a browser route and the MCP `add_reference` tool. It validates the link and range against the catalog, then asks a per-account Durable Object, `YouTubeImporter`, to cut the section. That object runs yt-dlp + ffmpeg inside a Cloudflare Container through `ctx.container.exec()`, then streams the MP4 back. The Worker stores it as an ordinary 24-hour `account_uploads` row whose id becomes `sourceVideoId` in the existing edit job. The browser picks markers in YouTube's embedded player, fetches the finished clip once for preview, and skips re-uploading it on submit.

**Tech Stack:** Cloudflare Workers + Durable Object Container API (`ctx.container`), Docker image (Python 3.13, yt-dlp, Deno, static ffmpeg), D1/R2 (existing), MCP server (`@modelcontextprotocol/server`, zod), Next.js 16.2 / React 19.2 client, YouTube IFrame Player API, Vitest (root: jsdom; `cloud/`: node).

**Spec:** `docs/claude/specs/2026-10-13-youtube-clip-source-design.md`. Its "Follow-up decisions (while planning)" section overrides the body. Read both.

## Global Constraints

- Signed-in only: the browser entry point renders only when `cloudWorkspace.cloud` is true; the Worker route requires `currentAccount`.
- Only the parsed 11-character video id (`/^[A-Za-z0-9_-]{11}$/`) ever reaches the container, never the pasted string.
- Range: From ≥ 0, To > From, both to one decimal place. With a model, length within its `videoEdit.minSeconds..maxSeconds` (Seedance 2.5: 4–30 s). Without one, 1–30 s (catalog-wide, 1 s floor).
- Formats: short edge ≥ 720 px, preferring ≤ 1080p. Output H.264 + AAC MP4 with `+faststart`, at most `MAX_EDIT_VIDEO_BYTES` (100 MB).
- Limits: 10 imports per account per rolling hour, shared by browser and agents; one import per account at a time; `max_instances: 3`; 120 s per import (`YOUTUBE_IMPORT_TIMEOUT_MS`); the gateway allows `youtube-clips` 130 s.
- New refusal codes, exactly: `invalid_range` (No), `source_unavailable` (No), `source_refused` (Yes), `import_rate_limited` (Yes). Retryable ones carry `retryAfterSeconds`.
- Copy, exactly: "Paste a YouTube video or Shorts link." · "YouTube refused the download. Try again in a few minutes." · "This video has no 720p version, which video editing needs." · "Another import is still running for this account." · "Import cancelled." · "The import took too long. Try a shorter section." · "YouTube import is not available right now."
- yt-dlp/ffmpeg stderr is third-party text: it goes through `sanitizeProviderMessage` before any log line or response.
- Imported clips are temporary inputs (24 h, one submission), never library assets.
- No D1 migration. Any change to a `cloud/src` file must keep `pnpm --dir cloud test` and `pnpm --dir cloud typecheck` green.
- Testing policy (user's CLAUDE.md): **no test-first.** Each task implements, then adds the tests listed, runs them, commits.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A 30.0 s section at a 30 s maximum.** Container padding makes ffprobe report 30.02–30.05 s. The person expects it to import. → `-t` in `clip.py` (Task 2), plus the 0.25 s slack test in Task 4 ("accepts a probed length a few hundredths over").
2. **A second edit with the same imported clip** after the first job finished. Cleanup has already deleted the staged upload, so reusing its id would fail at intake. The person expects a normal submit. → one-use staging test in Task 7 ("uploads the browser copy on the second submission").
3. **Switching accounts while an import is in flight.** The clip must never attach to the new account. → dialog epoch test in Task 8.
4. **Cancel mid-import.** The download must stop and the slot be released, not run until the timeout. → gateway abort-forwarding test (Task 6) and the core `cancelled` test (Task 3).
5. **Real-world share links:** `youtu.be/ID?si=…`, `m.youtube.com`, `/shorts/ID`, leading/trailing spaces, `&t=1m2s`. These are accepted. Look-alike hosts (`youtube.com.evil.example`) and `javascript:` are refused. → URL table in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/youtube/clip.ts` (new) | Shared by browser and Worker: URL → id, timestamp/clock parsing, `importBounds`, `rangeProblem`, limits. |
| `cloud/containers/youtube/Dockerfile`, `clip.py`, `smoke.sh` (new) | The importer image, the one script that cuts a section, and a local Docker smoke test. |
| `cloud/src/youtube/importer-core.ts` (new) | Runtime-free importer logic: request parsing, hourly gate, single flight, exec sequence, Response protocol. |
| `cloud/src/youtube/importer.ts` (new) | Thin `YouTubeImporter` Durable Object binding `ctx.container` to the core. |
| `cloud/src/youtube/import.ts` (new) | `importYouTubeClip`: the one function the route and the MCP tool both call. |
| `cloud/src/youtube/routes.ts` (new) | `POST /api/account/youtube-clips`, which adds a preview link. |
| `cloud/src/media.ts`, `cloud/src/jobs.ts`, `cloud/src/index.ts`, `cloud/src/entry.ts`, `cloud/src/security.ts` | `preview` media purpose; `AccountError.retryAfterSeconds`; route wiring; DO export; `Env` bindings. |
| `cloud/src/mcp/tools/references.ts`, `cloud/src/mcp/errors.ts`, `cloud/src/mcp/server.ts`, `app/docs/mcp/guide.md` | MCP `youtube` option, `retryAfterSeconds` passthrough, instructions, public guide. |
| `cloud/wrangler.jsonc`, `cloud/package.json`, `.github/workflows/deploy-account-worker.yml` | Container, DO binding, `exports`, compatibility flag, dev toggle, deploy token note. |
| `lib/account/gateway.ts`, `app/api/account/[...path]/route.ts` | Allow `youtube-clips`, 130 s, forward abort. |
| `lib/account/staged-sources.ts`, `lib/account/youtube-clips.ts` (new), `lib/account/useCloudWorkspace.ts` | Browser import call, one-use staging, skipping re-upload. |
| `lib/youtube/iframe-api.ts`, `components/YouTubeClipDialog.tsx` (new), `components/VideoSourceInput.tsx`, `components/ProviderVideoWorkspace.tsx` | Player loader, the dialog, the From YouTube button and origin label, wiring. |
| `AGENTS.md`, `docs/deployment.md` | Routing entry, proxy secret and image maintenance. |

---

### Task 1: Shared YouTube helpers

**Files:**
- Create: `lib/youtube/clip.ts`
- Test: `tests/youtube/clip.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_MODELS`, `findModel` from `lib/providers/catalog.ts`; `ProviderId`, `ProviderModel` from `lib/providers/types.ts`.
- Produces:
  - `YOUTUBE_IMPORTS_PER_HOUR = 10`, `YOUTUBE_IMPORT_TIMEOUT_MS = 120_000`
  - `interface YouTubeLink { videoId: string; startSeconds?: number }`
  - `interface ClipSource { videoId: string; startSeconds: number; endSeconds: number }`
  - `parseYouTubeUrl(input: string): YouTubeLink | null`
  - `parseTimestamp(value: string): number | undefined`
  - `watchUrl(source: { videoId: string; startSeconds?: number }): string`
  - `roundTenth(value: number): number`, `formatClock(seconds: number): string`, `parseClock(text: string): number | undefined`
  - `interface ImportBounds { minSeconds: number; maxSeconds: number; capability?: NonNullable<ProviderModel['videoEdit']> }`
  - `importBounds(edit?: { provider: string; modelId: string }): ImportBounds | null`
  - `rangeProblem(startSeconds: number, endSeconds: number, bounds: ImportBounds): string | null`

The Worker imports this file by relative path (`../../../lib/youtube/clip`), so it must use relative imports, never `@/`.

- [ ] **Step 1: Write `lib/youtube/clip.ts`**

```ts
import { PROVIDER_MODELS, findModel } from '../providers/catalog';
import type { ProviderId, ProviderModel } from '../providers/types';

/** Imports per account per rolling hour, shared by the browser and every agent, so
 *  connecting more agents does not raise the proxy bill. */
export const YOUTUBE_IMPORTS_PER_HOUR = 10;
/** The importer's ceiling for one section, end to end. */
export const YOUTUBE_IMPORT_TIMEOUT_MS = 120_000;
/** Below this a section is a frame, not a clip; P-Video-Edit states no minimum. */
const MIN_SECTION_SECONDS = 1;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

export interface YouTubeLink { videoId: string; startSeconds?: number }
export interface ClipSource { videoId: string; startSeconds: number; endSeconds: number }

/** Only the 11-character id leaves this function, never the pasted text, because the
 *  importer builds a command line from it. */
export function parseYouTubeUrl(input: string): YouTubeLink | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  else if (WATCH_HOSTS.has(host)) id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  if (!id || !VIDEO_ID.test(id)) return null;
  const t = url.searchParams.get('t');
  const startSeconds = t === null ? undefined : parseTimestamp(t);
  return startSeconds === undefined ? { videoId: id } : { videoId: id, startSeconds };
}

/** YouTube's `t` parameter: `75`, `75s` or `1h2m3s`. */
export function parseTimestamp(value: string): number | undefined {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  if (!value || !match) return undefined;
  const [, h = '0', m = '0', s = '0'] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export function watchUrl(source: { videoId: string; startSeconds?: number }): string {
  return `https://www.youtube.com/watch?v=${source.videoId}${source.startSeconds ? `&t=${Math.floor(source.startSeconds)}s` : ''}`;
}

export const roundTenth = (value: number) => Math.round(value * 10) / 10;

/** `m:ss.s`, or `h:mm:ss.s` from an hour, always with one decimal. */
export function formatClock(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const h = Math.floor(tenths / 36000), m = Math.floor((tenths % 36000) / 600);
  const ss = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Accepts `75`, `75.5`, `1:15`, `1:15.5` and `1:01:15.5`; anything else is undefined. */
export function parseClock(text: string): number | undefined {
  const parts = text.trim().split(':');
  if (parts.length > 3 || !/^\d+(?:\.\d)?$/.test(parts.at(-1)!) || parts.slice(0, -1).some(part => !/^\d+$/.test(part))) return undefined;
  const values = parts.map(Number);
  if (values.slice(1).some(value => value >= 60)) return undefined;
  return roundTenth(values.reduce((total, value) => total * 60 + value, 0));
}

export interface ImportBounds { minSeconds: number; maxSeconds: number; capability?: NonNullable<ProviderModel['videoEdit']> }

/** The section length a model accepts as an edit source or, with no model, the widest
 *  any edit model in the catalog accepts. Null for a model that cannot edit. */
export function importBounds(edit?: { provider: string; modelId: string }): ImportBounds | null {
  if (edit) {
    const capability = Object.hasOwn(PROVIDER_MODELS, edit.provider) ? findModel(edit.provider as ProviderId, edit.modelId)?.videoEdit : undefined;
    return capability ? { minSeconds: Math.max(MIN_SECTION_SECONDS, capability.minSeconds ?? 0), maxSeconds: capability.maxSeconds, capability } : null;
  }
  const all = Object.values(PROVIDER_MODELS).flat().flatMap(model => model.videoEdit ? [model.videoEdit] : []);
  return { minSeconds: Math.max(MIN_SECTION_SECONDS, Math.min(...all.map(c => c.minSeconds ?? 0))), maxSeconds: Math.max(...all.map(c => c.maxSeconds)) };
}

/** Why a section cannot be imported, in words a person can act on; null when it can. */
export function rangeProblem(startSeconds: number, endSeconds: number, bounds: ImportBounds): string | null {
  const tenth = (value: number) => Number.isFinite(value) && Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;
  if (!tenth(startSeconds) || !tenth(endSeconds) || startSeconds < 0) return 'Set From and To as times in the video, to a tenth of a second.';
  if (endSeconds <= startSeconds) return 'To must come after From.';
  const length = roundTenth(endSeconds - startSeconds);
  if (length < bounds.minSeconds || length > bounds.maxSeconds) return `Choose a section between ${bounds.minSeconds} and ${bounds.maxSeconds} seconds long.`;
  return null;
}
```

- [ ] **Step 2: Write `tests/youtube/clip.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { formatClock, importBounds, parseClock, parseTimestamp, parseYouTubeUrl, rangeProblem, watchUrl } from '@/lib/youtube/clip';

const ID = 'aqz-KE-bpKQ';
describe('parseYouTubeUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, { videoId: ID }],
    [`  https://youtube.com/watch?v=${ID}&list=PL1  `, { videoId: ID }],
    [`https://m.youtube.com/watch?v=${ID}&t=1m2s`, { videoId: ID, startSeconds: 62 }],
    [`https://youtu.be/${ID}?si=AbCdEf&t=75`, { videoId: ID, startSeconds: 75 }],
    [`https://www.youtube.com/shorts/${ID}`, { videoId: ID }],
    [`http://www.youtube.com/watch?v=${ID}&t=bogus`, { videoId: ID }],
  ])('accepts %s', (input, expected) => expect(parseYouTubeUrl(input)).toEqual(expected));
  it.each([
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID.slice(0, 10)}`,
    `https://www.youtube.com/watch?v=${ID};rm`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com:8443/watch?v=${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `javascript:alert(1)//youtu.be/${ID}`,
    'not a link',
  ])('refuses %s', input => expect(parseYouTubeUrl(input)).toBeNull());
});

describe('times', () => {
  it('reads YouTube t values', () => {
    expect(parseTimestamp('75')).toBe(75); expect(parseTimestamp('75s')).toBe(75);
    expect(parseTimestamp('1h2m3s')).toBe(3723); expect(parseTimestamp('')).toBeUndefined(); expect(parseTimestamp('s')).toBeUndefined();
  });
  it('round-trips clock text', () => {
    expect(formatClock(62.5)).toBe('1:02.5'); expect(formatClock(3725)).toBe('1:02:05.0'); expect(formatClock(0)).toBe('0:00.0');
    expect(parseClock('1:02.5')).toBe(62.5); expect(parseClock('75')).toBe(75); expect(parseClock('1:01:15.5')).toBe(3675.5);
    expect(parseClock('1:75')).toBeUndefined(); expect(parseClock('1:02.55')).toBeUndefined(); expect(parseClock('')).toBeUndefined();
  });
  it('links back to the original at the start', () => expect(watchUrl({ videoId: ID, startSeconds: 62.4 })).toBe(`https://www.youtube.com/watch?v=${ID}&t=62s`));
});

describe('bounds', () => {
  it('uses the model edit capability', () => {
    expect(importBounds({ provider: 'runware', modelId: 'bytedance:seedance@2.5' })).toMatchObject({ minSeconds: 4, maxSeconds: 30 });
    expect(importBounds({ provider: 'runware', modelId: 'prunaai:p-video@edit' })).toMatchObject({ minSeconds: 1, maxSeconds: 15 });
  });
  it('refuses a model without edit, an unknown provider, and prototype keys', () => {
    expect(importBounds({ provider: 'runware', modelId: 'runware:z-image@turbo' })).toBeNull();
    expect(importBounds({ provider: 'nope', modelId: 'x' })).toBeNull();
    expect(importBounds({ provider: 'toString', modelId: 'x' })).toBeNull();
  });
  it('falls back to the widest catalog range', () => expect(importBounds()).toEqual({ minSeconds: 1, maxSeconds: 30 }));
  it('explains every out-of-range section', () => {
    const bounds = importBounds({ provider: 'runware', modelId: 'bytedance:seedance@2.5' })!;
    expect(rangeProblem(62, 74.4, bounds)).toBeNull();
    expect(rangeProblem(0, 30, bounds)).toBeNull();
    expect(rangeProblem(62, 64, bounds)).toMatch(/between 4 and 30/);
    expect(rangeProblem(0, 30.1, bounds)).toMatch(/between 4 and 30/);
    expect(rangeProblem(10, 5, bounds)).toBe('To must come after From.');
    expect(rangeProblem(1.25, 9, bounds)).toMatch(/tenth of a second/);
    expect(rangeProblem(-1, 9, bounds)).toMatch(/tenth of a second/);
    expect(rangeProblem(Number.NaN, 9, bounds)).toMatch(/tenth of a second/);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run tests/youtube/clip.test.ts`
Expected: PASS. If the P-Video-Edit or Seedance expectations fail, read the current `videoEdit` values in `lib/providers/catalog.ts` and update the expectations rather than the code; the catalog is the source of truth.

- [ ] **Step 4: Commit**

```bash
git add lib/youtube/clip.ts tests/youtube/clip.test.ts
git commit -m "Add shared YouTube link, time and section-bound helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Importer container image

**Files:**
- Create: `cloud/containers/youtube/Dockerfile`
- Create: `cloud/containers/youtube/clip.py`
- Create: `cloud/containers/youtube/smoke.sh`

**Interfaces:**
- Produces the exec contract Task 3 relies on. `python3 /app/clip.py <videoId> <start> <end> <workDir>`, where `start`/`end` are decimals with exactly one place (`62.0`) and `workDir` starts with `/tmp/clips/`. It prints one JSON line on stdout and always exits 0:
  - `{"ok": true, "path": "<workDir>/clip.mp4", "bytes": int, "width": int, "height": int, "duration": float}`
  - `{"ok": false, "code": "invalid"|"range"|"unavailable"|"no_720p"|"refused"|"failed", "reason"?: "private"|"members"|"age"|"live"|"removed", "detail": str}`
- Reads the proxy from env `YOUTUBE_PROXY_URL` (may be empty).

- [ ] **Step 1: Write `cloud/containers/youtube/Dockerfile`**

```dockerfile
# The YouTube clip importer, run by Cloudflare Containers (linux/amd64). The Durable
# Object in cloud/src/youtube/importer.ts execs clip.py inside a running instance,
# so the entrypoint only has to keep the instance alive.
#
# yt-dlp breaks whenever YouTube changes its player. Rebuild with a current
# YTDLP_VERSION when imports start failing with `failed`/`no_720p` on public videos;
# see docs/deployment.md.
ARG FFMPEG_TAG=7.1
ARG DENO_TAG=bin-2.1.4
FROM mwader/static-ffmpeg:${FFMPEG_TAG} AS ffmpeg
# yt-dlp needs a JavaScript runtime to solve YouTube's player challenges; without one
# most formats disappear and every import reads as "no 720p version".
FROM denoland/deno:${DENO_TAG} AS deno

FROM python:3.13-slim-bookworm
ARG YTDLP_VERSION=2025.12.08
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
COPY --from=deno /deno /usr/local/bin/deno
RUN pip install --no-cache-dir "yt-dlp[default]==${YTDLP_VERSION}"
COPY clip.py /app/clip.py
CMD ["sleep", "infinity"]
```

- [ ] **Step 2: Pin current versions**

Run each command and replace the matching `ARG` default with the newest stable value it shows:

```bash
pip index versions yt-dlp 2>/dev/null | head -1
```
```bash
curl -s "https://hub.docker.com/v2/repositories/denoland/deno/tags?page_size=50&name=bin-" | python3 -c "import json,sys; print(sorted(t['name'] for t in json.load(sys.stdin)['results'])[-5:])"
```
```bash
curl -s "https://hub.docker.com/v2/repositories/mwader/static-ffmpeg/tags?page_size=50" | python3 -c "import json,sys; print([t['name'] for t in json.load(sys.stdin)['results']][:10])"
```
Expected: yt-dlp shows a version like `yt-dlp (2026.x.y)`. Pin that version.

- [ ] **Step 3: Write `cloud/containers/youtube/clip.py`**

```python
"""Cut one section of a YouTube video to an H.264 MP4.

Usage: clip.py <video_id> <start> <end> <work_dir>

Prints exactly one JSON line on stdout and exits 0 either way; the Worker reads the
JSON, never the exit status. The Worker has already validated every argument, and
they are validated again here because this file builds command lines from them.
"""
import json
import os
import re
import signal
import subprocess
import sys

VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
SECONDS = re.compile(r'^\d{1,6}\.\d$')


def done(**fields):
    print(json.dumps(fields), flush=True)
    sys.exit(0)


def fail(code, detail='', reason=None):
    done(ok=False, code=code, detail=str(detail)[-500:], **({'reason': reason} if reason else {}))


def classify(message):
    """yt-dlp reports refusals as text; map the ones a person can act on."""
    text = message.lower()
    if 'not a bot' in text or 'http error 429' in text or 'proxy' in text or 'unable to connect' in text:
        return 'refused', None
    if 'private video' in text:
        return 'unavailable', 'private'
    if 'members' in text or 'join this channel' in text:
        return 'unavailable', 'members'
    if 'confirm your age' in text or 'age-restricted' in text or 'inappropriate for some users' in text:
        return 'unavailable', 'age'
    if 'live event' in text or 'premiere' in text or 'is live' in text:
        return 'unavailable', 'live'
    if 'video unavailable' in text or 'has been removed' in text or 'not available' in text and 'format' not in text:
        return 'unavailable', 'removed'
    if 'requested format is not available' in text:
        return 'no_720p', None
    return 'failed', None


def stop(signum, frame):
    # exec().kill() reaches only this process; take yt-dlp and ffmpeg down with it.
    os.killpg(0, signal.SIGKILL)


def main():
    os.setpgrp()
    signal.signal(signal.SIGTERM, stop)
    if len(sys.argv) != 5:
        fail('invalid', 'expected 4 arguments')
    video_id, start, end, work = sys.argv[1:5]
    if not VIDEO_ID.match(video_id) or not SECONDS.match(start) or not SECONDS.match(end) or not re.match(r'^/tmp/clips/[A-Za-z0-9-]+$', work):
        fail('invalid', 'malformed arguments')
    start_s, end_s = float(start), float(end)
    os.makedirs(work, exist_ok=True)

    import yt_dlp
    from yt_dlp.utils import DownloadError, download_range_func

    base = {'quiet': True, 'no_warnings': True, 'noprogress': True, 'socket_timeout': 20,
            'proxy': os.environ.get('YOUTUBE_PROXY_URL') or None}
    try:
        with yt_dlp.YoutubeDL(base) as ydl:
            info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
    except DownloadError as error:
        code, reason = classify(str(error))
        fail(code, error, reason)
    if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
        fail('unavailable', 'live', 'live')
    if (info.get('age_limit') or 0) >= 18:
        fail('unavailable', 'age-restricted', 'age')
    duration = info.get('duration') or 0
    if end_s > duration + 0.05:
        fail('range', f'video is {duration} seconds')

    options = {**base,
               # Short edge >= 720 px (Seedance needs >= 407,696 source pixels), closest to 1080p.
               'format': 'bv*[height>=720][width>=720]+ba/b[height>=720][width>=720]',
               'format_sort': ['res:1080'],
               'download_ranges': download_range_func(None, [(start_s, end_s)]),
               'force_keyframes_at_cuts': True,
               'outtmpl': os.path.join(work, 'source.%(ext)s'),
               'merge_output_format': 'mkv'}
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.process_ie_result(info, download=True)
    except DownloadError as error:
        code, reason = classify(str(error))
        fail(code, error, reason)
    sources = [name for name in os.listdir(work) if name.startswith('source.')]
    if not sources:
        fail('failed', 'no section was downloaded')

    out = os.path.join(work, 'clip.mp4')
    # -t makes the length exact: a 30.0 s section must not come out 30.04 s against a 30 s limit.
    encode = subprocess.run(
        ['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', os.path.join(work, sources[0]),
         '-t', f'{end_s - start_s:.1f}', '-map', '0:v:0', '-map', '0:a:0?',
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', '8M', '-bufsize', '16M',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out],
        capture_output=True, text=True)
    if encode.returncode != 0:
        fail('failed', encode.stderr)
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', out],
        capture_output=True, text=True)
    try:
        data = json.loads(probe.stdout)
        stream = data['streams'][0]
        done(ok=True, path=out, bytes=os.path.getsize(out), width=int(stream['width']),
             height=int(stream['height']), duration=round(float(data['format']['duration']), 2))
    except (KeyError, IndexError, ValueError) as error:
        fail('failed', f'unreadable output: {error}')


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Write `cloud/containers/youtube/smoke.sh`** and make it executable (`chmod +x`)

```bash
#!/usr/bin/env bash
# Builds the importer image and cuts a real section outside Cloudflare.
# Needs Docker running. If this machine's IP gets the bot check, export
# YOUTUBE_PROXY_URL first (the same value as the Worker secret).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
docker build --platform linux/amd64 -t scene-assembly-youtube "$here"
out="$(mktemp -d)"
# Big Buck Bunny, Blender Foundation, CC BY 3.0.
docker run --rm --platform linux/amd64 -e YOUTUBE_PROXY_URL="${YOUTUBE_PROXY_URL:-}" -v "$out:/tmp/clips" \
  scene-assembly-youtube python3 /app/clip.py aqz-KE-bpKQ 62.0 74.4 /tmp/clips/smoke | tee "$out/result.json"
python3 - "$out/result.json" "$out/smoke/clip.mp4" <<'PY'
import json, subprocess, sys
result = json.loads(open(sys.argv[1]).read().strip().splitlines()[-1])
assert result["ok"], result
probe = json.loads(subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
     "stream=codec_name,width,height:format=duration", "-of", "json", sys.argv[2]],
    capture_output=True, text=True, check=True).stdout)
stream, duration = probe["streams"][0], float(probe["format"]["duration"])
assert stream["codec_name"] == "h264", stream
assert min(stream["width"], stream["height"]) >= 720, stream
assert abs(duration - 12.4) <= 0.1, duration
print(f"smoke ok: {stream['width']}x{stream['height']}, {duration:.2f} s")
PY
```

- [ ] **Step 5: Run the smoke test**

Run `docker info >/dev/null && echo up` first. If Docker isn't running, start Docker Desktop (`open -a Docker`) and wait until that prints `up`.
Run: `cloud/containers/youtube/smoke.sh`
Expected: the last line is `smoke ok: 1920x1080, 12.4x s`, or the matching values for 1280x720.
- If it prints `{"ok": false, "code": "refused", …}`, this IP was bot-checked. Export `YOUTUBE_PROXY_URL` and rerun.
- If it shows `no_720p` for Big Buck Bunny, the yt-dlp pin is stale or Deno is missing. Recheck Step 2.

- [ ] **Step 6: Commit**

```bash
git add cloud/containers/youtube
git commit -m "Add the YouTube clip importer container image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Importer Durable Object

**Files:**
- Create: `cloud/src/youtube/importer-core.ts`
- Create: `cloud/src/youtube/importer.ts`
- Modify: `cloud/src/entry.ts` (export the class), `cloud/src/security.ts` (`Env`), `cloud/wrangler.jsonc`, `cloud/package.json`
- Test: `cloud/tests/youtube-importer.test.ts`, `cloud/tests/deploy-config.test.ts`

**Interfaces:**
- Consumes: Task 1 `ClipSource`, `YOUTUBE_IMPORTS_PER_HOUR`, `YOUTUBE_IMPORT_TIMEOUT_MS`; Task 2 exec contract.
- Produces (from `importer-core.ts`):
  - `type ClipRequest = ClipSource`
  - `type ClipFailureCode = 'invalid'|'range'|'unavailable'|'no_720p'|'refused'|'failed'|'busy'|'rate_limited'|'timeout'|'cancelled'`
  - `type UnavailableReason = 'private'|'members'|'age'|'live'|'removed'`
  - `interface ClipFailure { ok: false; code: ClipFailureCode; detail: string; reason?: UnavailableReason; retryAfterSeconds?: number }`
  - `interface ClipSuccess { ok: true; body: ReadableStream<Uint8Array>; bytes: number; width: number; height: number; durationSeconds: number }`
  - `type ClipResult = ClipSuccess | ClipFailure`
  - `interface ClipContainer`, `interface ClipProcess`, `interface GateStorage`, `interface ImporterDeps`
  - `parseClipRequest(body: unknown): ClipRequest | null`
  - `admit(storage: GateStorage, now: number): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }>`
  - `runClip(container, request, options: { proxyUrl?: string; signal: AbortSignal; workId: string; sleep(ms: number): Promise<void> }): Promise<ClipResult>`
  - `handleImport(deps: ImporterDeps, body: unknown, signal: AbortSignal): Promise<ClipResult>`
  - `toResponse(result: ClipResult): Response`, `fromResponse(response: Response): Promise<ClipResult>`
- `Env` gains `YOUTUBE_IMPORTER?: DurableObjectNamespace` and `YOUTUBE_PROXY_URL?: string`.

- [ ] **Step 1: Write `cloud/src/youtube/importer-core.ts`**

```ts
import { YOUTUBE_IMPORTS_PER_HOUR, type ClipSource } from '../../../lib/youtube/clip';

/** The slice of `ctx.container` the importer uses, so tests can hand it a fake. */
export interface ClipProcess {
  stdout: ReadableStream<Uint8Array> | null;
  exitCode: Promise<number>;
  output(): Promise<{ stdout: ArrayBuffer; stderr: ArrayBuffer; exitCode: number }>;
}
export interface ClipContainer {
  readonly running: boolean;
  start(options: { enableInternet: boolean }): void;
  exec(cmd: string[], options?: { env?: Record<string, string>; signal?: AbortSignal; stdout?: 'pipe' | 'ignore'; stderr?: 'pipe' | 'ignore' }): Promise<ClipProcess>;
  setInactivityTimeout(durationMs: number): Promise<void>;
}
export interface GateStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
export type ClipRequest = ClipSource;
export type ClipFailureCode = 'invalid' | 'range' | 'unavailable' | 'no_720p' | 'refused' | 'failed' | 'busy' | 'rate_limited' | 'timeout' | 'cancelled';
export type UnavailableReason = 'private' | 'members' | 'age' | 'live' | 'removed';
export interface ClipFailure { ok: false; code: ClipFailureCode; detail: string; reason?: UnavailableReason; retryAfterSeconds?: number }
export interface ClipSuccess { ok: true; body: ReadableStream<Uint8Array>; bytes: number; width: number; height: number; durationSeconds: number }
export type ClipResult = ClipSuccess | ClipFailure;
export interface ImporterDeps {
  container: ClipContainer | undefined;
  storage: GateStorage;
  /** Instance memory: one import per account at a time. */
  state: { busy: boolean };
  proxyUrl?: string;
  now(): number;
  sleep(ms: number): Promise<void>;
  workId(): string;
}

const WINDOW_MS = 3_600_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SCRIPT_CODES = new Set<ClipFailureCode>(['invalid', 'range', 'unavailable', 'no_720p', 'refused', 'failed']);
const REASONS = new Set<UnavailableReason>(['private', 'members', 'age', 'live', 'removed']);

/** Re-checked here because a Durable Object is reachable by name, not only through
 *  importYouTubeClip. */
export function parseClipRequest(body: unknown): ClipRequest | null {
  if (!body || typeof body !== 'object') return null;
  const { videoId, startSeconds, endSeconds } = body as Record<string, unknown>;
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId) || typeof startSeconds !== 'number' || typeof endSeconds !== 'number') return null;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) return null;
  return { videoId, startSeconds, endSeconds };
}

/** One account's rolling hour. Counted when the container is asked, not when it
 *  succeeds: a refused download spends the same proxy bandwidth. */
export async function admit(storage: GateStorage, now: number): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const recent = ((await storage.get<number[]>('imports')) ?? []).filter(at => now - at < WINDOW_MS);
  if (recent.length >= YOUTUBE_IMPORTS_PER_HOUR) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  await storage.put('imports', [...recent, now]);
  return { ok: true };
}

/** start() returns before the instance accepts work, so probe until it does. */
async function ready(container: ClipContainer, sleep: (ms: number) => Promise<void>) {
  if (!container.running) container.start({ enableInternet: true });
  let last: unknown;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if (await (await container.exec(['true'], { stdout: 'ignore', stderr: 'ignore' })).exitCode === 0) return;
    } catch (error) { last = error; }
    await sleep(1000);
  }
  throw last instanceof Error ? last : new Error('The importer did not start.');
}

const aborted = (signal: AbortSignal): ClipFailure =>
  ({ ok: false, code: (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError' ? 'timeout' : 'cancelled', detail: '' });

export async function runClip(container: ClipContainer, request: ClipRequest, options: { proxyUrl?: string; signal: AbortSignal; workId: string; sleep(ms: number): Promise<void> }): Promise<ClipResult> {
  await ready(container, options.sleep);
  const work = `/tmp/clips/${options.workId}`;
  const cleanup = () => container.exec(['rm', '-rf', work], { stdout: 'ignore', stderr: 'ignore' }).then(() => {}, () => {});
  let line = '';
  try {
    const clip = await container.exec(
      ['python3', '/app/clip.py', request.videoId, request.startSeconds.toFixed(1), request.endSeconds.toFixed(1), work],
      { env: options.proxyUrl ? { YOUTUBE_PROXY_URL: options.proxyUrl } : {}, signal: options.signal, stdout: 'pipe', stderr: 'ignore' },
    );
    line = new TextDecoder().decode((await clip.output()).stdout).trim().split('\n').at(-1) ?? '';
  } catch (error) {
    if (!options.signal.aborted) throw error;
  }
  if (options.signal.aborted) { void cleanup(); return aborted(options.signal); }
  let result: Record<string, unknown>;
  try { result = JSON.parse(line) as Record<string, unknown>; } catch { void cleanup(); return { ok: false, code: 'failed', detail: 'The importer returned no result.' }; }
  if (result.ok !== true) {
    void cleanup();
    const code = SCRIPT_CODES.has(result.code as ClipFailureCode) ? result.code as ClipFailureCode : 'failed';
    const reason = REASONS.has(result.reason as UnavailableReason) ? result.reason as UnavailableReason : undefined;
    return { ok: false, code, detail: String(result.detail ?? ''), ...(reason ? { reason } : {}) };
  }
  const { path, bytes, width, height, duration } = result;
  if (path !== `${work}/clip.mp4` || ![bytes, width, height, duration].every(value => typeof value === 'number' && Number.isFinite(value))) {
    void cleanup();
    return { ok: false, code: 'failed', detail: 'The importer returned an unreadable result.' };
  }
  const file = await container.exec(['cat', path], { signal: options.signal, stdout: 'pipe', stderr: 'ignore' });
  if (!file.stdout) { void cleanup(); return { ok: false, code: 'failed', detail: 'The clip could not be read back.' }; }
  void file.exitCode.then(cleanup, cleanup);
  return { ok: true, body: file.stdout, bytes: bytes as number, width: width as number, height: height as number, durationSeconds: duration as number };
}

export async function handleImport(deps: ImporterDeps, body: unknown, signal: AbortSignal): Promise<ClipResult> {
  const request = parseClipRequest(body);
  if (!request) return { ok: false, code: 'invalid', detail: 'Malformed clip request.' };
  if (!deps.container) return { ok: false, code: 'refused', detail: 'No container is configured.', retryAfterSeconds: 300 };
  if (deps.state.busy) return { ok: false, code: 'busy', detail: '', retryAfterSeconds: 30 };
  deps.state.busy = true;
  try {
    const admitted = await admit(deps.storage, deps.now());
    if (!admitted.ok) return { ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: admitted.retryAfterSeconds };
    return await runClip(deps.container, request, { proxyUrl: deps.proxyUrl, signal, workId: deps.workId(), sleep: deps.sleep });
  } catch (error) {
    // start() past max_instances, an instance that never came up, or a lost exec.
    return { ok: false, code: 'refused', detail: error instanceof Error ? error.message : 'Importer unavailable.', retryAfterSeconds: 60 };
  } finally {
    deps.state.busy = false;
    await deps.container.setInactivityTimeout(60_000).catch(() => {});
  }
}

export function toResponse(result: ClipResult): Response {
  if (!result.ok) return Response.json(result, { status: 422 });
  return new Response(result.body, { status: 200, headers: {
    'content-type': 'video/mp4', 'x-clip-bytes': String(result.bytes), 'x-clip-width': String(result.width),
    'x-clip-height': String(result.height), 'x-clip-duration': String(result.durationSeconds),
  } });
}

export async function fromResponse(response: Response): Promise<ClipResult> {
  if (response.status === 200 && response.body) {
    const read = (name: string) => Number(response.headers.get(`x-clip-${name}`));
    return { ok: true, body: response.body, bytes: read('bytes'), width: read('width'), height: read('height'), durationSeconds: read('duration') };
  }
  const failure = await response.json().catch(() => null) as Partial<ClipFailure> | null;
  return {
    ok: false,
    code: typeof failure?.code === 'string' ? failure.code : 'failed',
    detail: String(failure?.detail ?? `Importer answered ${response.status}.`),
    ...(failure?.reason ? { reason: failure.reason } : {}),
    ...(typeof failure?.retryAfterSeconds === 'number' ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
  };
}
```

- [ ] **Step 2: Write `cloud/src/youtube/importer.ts`**

```ts
import { DurableObject } from 'cloudflare:workers';
import { YOUTUBE_IMPORT_TIMEOUT_MS } from '../../../lib/youtube/clip';
import type { Env } from '../security';
import { handleImport, toResponse, type ClipContainer } from './importer-core';

/** One instance per account: importYouTubeClip addresses it by owner id, which is what
 *  makes "one import at a time" and the hourly count per account. The logic lives in
 *  importer-core so it is testable without the Workers runtime. */
export class YouTubeImporter extends DurableObject<Env> {
  private readonly state = { busy: false };

  async fetch(request: Request): Promise<Response> {
    // request.signal needs the enable_request_signal flag; without it a closed tab
    // would leave yt-dlp running until the timeout.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(YOUTUBE_IMPORT_TIMEOUT_MS)]);
    const body = await request.json().catch(() => null);
    return toResponse(await handleImport({
      container: this.ctx.container as unknown as ClipContainer | undefined,
      storage: this.ctx.storage,
      state: this.state,
      proxyUrl: this.env.YOUTUBE_PROXY_URL,
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      workId: () => crypto.randomUUID(),
    }, body, signal));
  }
}
```

- [ ] **Step 3: Wire the class and bindings**

In `cloud/src/entry.ts`, under the existing `export { GenerationWorkflow } from './workflow';`:

```ts
export { YouTubeImporter } from './youtube/importer';
```

In `cloud/src/security.ts`, add to `interface Env` after `IMAGES?: ImagesBinding;`:

```ts
  /** Per-account YouTube clip importer (a Durable Object with a container). */
  YOUTUBE_IMPORTER?: DurableObjectNamespace;
  /** Residential proxy for the importer; YouTube refuses most datacenter IPs. A secret. */
  YOUTUBE_PROXY_URL?: string;
```

In `cloud/wrangler.jsonc`, add after the `"workflows"` line:

```jsonc
  // YouTube clip import (docs/claude/specs/2026-10-13-youtube-clip-source-design.md).
  // A container because yt-dlp and ffmpeg need a real process; one Durable Object per
  // account, so max_instances is also the global concurrency cap. standard-2 keeps a
  // 30 s 1080p re-encode inside the 120 s ceiling.
  "containers": [{ "class_name": "YouTubeImporter", "image": "./containers/youtube/Dockerfile", "max_instances": 3, "instance_type": "standard-2" }],
  "durable_objects": { "bindings": [{ "name": "YOUTUBE_IMPORTER", "class_name": "YouTubeImporter" }] },
  "exports": { "YouTubeImporter": { "type": "durable-object", "storage": "sqlite" } },
  // A disconnecting browser must abort the import's exec(), which reads request.signal.
  "compatibility_flags": ["enable_request_signal"],
  // `pnpm dev` must keep working without Docker; `pnpm dev:containers` turns them on.
  "dev": { "enable_containers": false },
```

In `cloud/package.json` `scripts`, add after `"dev"`:

```json
    "dev:containers": "wrangler dev --local --port 8797 --define __LOCAL_DEV__:true --enable-containers",
```

Run `pnpm --dir cloud exec wrangler dev --help | grep -i container` to confirm the flag's spelling for Wrangler 4.113. If it differs, use the spelling it prints.

- [ ] **Step 4: Write `cloud/tests/youtube-importer.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { admit, fromResponse, handleImport, toResponse, type ClipContainer, type ClipProcess, type GateStorage, type ImporterDeps } from '../src/youtube/importer-core';

const ID = 'aqz-KE-bpKQ';
const encode = (text: string) => new TextEncoder().encode(text);
const process = (stdout: Uint8Array, exit = 0): ClipProcess => ({
  stdout: new Blob([stdout]).stream(), exitCode: Promise.resolve(exit),
  output: async () => ({ stdout: stdout.slice().buffer, stderr: new ArrayBuffer(0), exitCode: exit }),
});
function fakeContainer(script: (cmd: string[], options?: { signal?: AbortSignal; env?: Record<string, string> }) => ClipProcess | Promise<ClipProcess>) {
  const calls: { cmd: string[]; env?: Record<string, string> }[] = [];
  let running = false;
  const container: ClipContainer = {
    get running() { return running; },
    start: () => { running = true; },
    setInactivityTimeout: async () => {},
    exec: async (cmd, options) => { calls.push({ cmd, env: options?.env }); return script(cmd, options); },
  };
  return { container, calls };
}
const success = (work: string) => JSON.stringify({ ok: true, path: `${work}/clip.mp4`, bytes: 4, width: 1280, height: 720, duration: 12.4 });
function memory(): GateStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async <T>(key: string) => data.get(key) as T | undefined, put: async (key, value) => { data.set(key, value); } };
}
const deps = (container: ClipContainer | undefined, patch: Partial<ImporterDeps> = {}): ImporterDeps => ({
  container, storage: memory(), state: { busy: false }, proxyUrl: 'http://user:pw@proxy.example:8000', now: () => 1_000_000, sleep: async () => {}, workId: () => 'work-1', ...patch,
});
const body = { videoId: ID, startSeconds: 62, endSeconds: 74.4 };
const signal = () => new AbortController().signal;

describe('runClip through handleImport', () => {
  it('cuts with exact arguments and the proxy, streams the file, then removes the work dir', async () => {
    const { container, calls } = fakeContainer(cmd => cmd[0] === 'python3' ? process(encode(`noise\n${success('/tmp/clips/work-1')}\n`)) : process(encode(cmd[0] === 'cat' ? 'MP4!' : '')));
    const result = await handleImport(deps(container), body, signal());
    expect(result).toMatchObject({ ok: true, bytes: 4, width: 1280, height: 720, durationSeconds: 12.4 });
    expect(await new Response((result as { body: ReadableStream }).body).text()).toBe('MP4!');
    expect(calls.map(c => c.cmd)).toEqual([
      ['true'],
      ['python3', '/app/clip.py', ID, '62.0', '74.4', '/tmp/clips/work-1'],
      ['cat', '/tmp/clips/work-1/clip.mp4'],
      ['rm', '-rf', '/tmp/clips/work-1'],
    ]);
    expect(calls[1].env).toEqual({ YOUTUBE_PROXY_URL: 'http://user:pw@proxy.example:8000' });
  });
  it('passes script refusals through, keeps known reasons and drops unknown codes', async () => {
    const reply = (json: string) => fakeContainer(cmd => process(encode(cmd[0] === 'python3' ? json : ''))).container;
    expect(await handleImport(deps(reply('{"ok":false,"code":"unavailable","reason":"private","detail":"Private video"}')), body, signal()))
      .toEqual({ ok: false, code: 'unavailable', reason: 'private', detail: 'Private video' });
    expect(await handleImport(deps(reply('{"ok":false,"code":"rm -rf","reason":"x"}')), body, signal())).toMatchObject({ ok: false, code: 'failed' });
    expect(await handleImport(deps(reply('Traceback (most recent call last)')), body, signal())).toMatchObject({ ok: false, code: 'failed' });
    expect(await handleImport(deps(reply('{"ok":true,"path":"/etc/passwd","bytes":1,"width":1,"height":1,"duration":1}')), body, signal())).toMatchObject({ ok: false, code: 'failed' });
  });
  it('reports cancelled and timeout separately, and releases the slot', async () => {
    const hang = fakeContainer((cmd, options) => cmd[0] === 'python3'
      ? { stdout: null, exitCode: new Promise<number>(() => {}), output: () => options!.signal!.aborted ? Promise.reject(options!.signal!.reason) : new Promise((_, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason))) }
      : process(new Uint8Array())).container;
    const cancel = new AbortController();
    const state = { busy: false };
    const pending = handleImport(deps(hang, { state }), body, cancel.signal);
    cancel.abort();
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' });
    expect(state.busy).toBe(false);
    expect(await handleImport(deps(hang), body, AbortSignal.timeout(5))).toMatchObject({ ok: false, code: 'timeout' });
  });
  it('refuses a second import while one runs, and a container that never starts', async () => {
    expect(await handleImport(deps(fakeContainer(() => process(new Uint8Array())).container, { state: { busy: true } }), body, signal()))
      .toEqual({ ok: false, code: 'busy', detail: '', retryAfterSeconds: 30 });
    const dead = fakeContainer(() => { throw new Error('max_instances reached'); }).container;
    expect(await handleImport(deps(dead), body, signal())).toMatchObject({ ok: false, code: 'refused', retryAfterSeconds: 60 });
    expect(await handleImport(deps(undefined), body, signal())).toMatchObject({ ok: false, code: 'refused' });
  });
  it('rejects malformed requests before touching the container', async () => {
    const { container, calls } = fakeContainer(() => process(new Uint8Array()));
    for (const bad of [null, { ...body, videoId: `${ID};x` }, { ...body, endSeconds: 10 }, { ...body, startSeconds: '62' }]) {
      expect(await handleImport(deps(container), bad, signal())).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(calls).toHaveLength(0);
  });
});

describe('admit', () => {
  it('allows ten per rolling hour and says when the next frees up', async () => {
    const storage = memory();
    for (let i = 0; i < 10; i++) expect(await admit(storage, 1_000 + i)).toEqual({ ok: true });
    expect(await admit(storage, 2_000)).toEqual({ ok: false, retryAfterSeconds: 3599 });
    expect(await admit(storage, 1_000 + 3_600_000)).toEqual({ ok: true });
  });
});

describe('response protocol', () => {
  it('round-trips success and failure', async () => {
    const ok = await fromResponse(toResponse({ ok: true, body: new Blob(['MP4!']).stream(), bytes: 4, width: 720, height: 1280, durationSeconds: 9.5 }));
    expect(ok).toMatchObject({ ok: true, bytes: 4, width: 720, height: 1280, durationSeconds: 9.5 });
    expect(await fromResponse(toResponse({ ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: 42 }))).toEqual({ ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: 42 });
    expect(await fromResponse(new Response('boom', { status: 500 }))).toMatchObject({ ok: false, code: 'failed' });
  });
});
```

- [ ] **Step 5: Extend `cloud/tests/deploy-config.test.ts`**

Add inside its existing `describe`. The file already defines `config(name)`; reuse it.

```ts
  it('runs the YouTube importer as a capped container on a request-signal Worker, without forcing Docker on pnpm dev', () => {
    const production = config('wrangler.jsonc');
    expect(production.containers).toEqual([expect.objectContaining({ class_name: 'YouTubeImporter', max_instances: 3, image: './containers/youtube/Dockerfile' })]);
    expect(production.durable_objects.bindings).toContainEqual({ name: 'YOUTUBE_IMPORTER', class_name: 'YouTubeImporter' });
    expect(production.exports.YouTubeImporter).toEqual({ type: 'durable-object', storage: 'sqlite' });
    expect(production.compatibility_flags).toContain('enable_request_signal');
    expect(production.dev.enable_containers).toBe(false);
    expect(config('wrangler.preview.jsonc').containers).toBeUndefined();
  });
```

- [ ] **Step 6: Run tests, typecheck, and a dry build**

Run: `pnpm --dir cloud test -- youtube-importer deploy-config && pnpm --dir cloud typecheck`
Expected: PASS, no type errors. If `ctx.container` or `getByName` types are missing, bump `@cloudflare/workers-types` in `cloud/package.json` to the newest `^5.x` and reinstall.
Run (Docker must be running, because Wrangler builds the image): `pnpm --dir cloud exec wrangler deploy --dry-run --outdir "$TMPDIR/wrangler-dry"`
Expected: completes. Wrangler accepts `containers`, `exports` and `dev` together. If it rejects `exports` together with the absent `migrations`, follow the error text exactly and note the change in the spec's follow-up section.

- [ ] **Step 7: Commit**

```bash
git add cloud/src/youtube/importer-core.ts cloud/src/youtube/importer.ts cloud/src/entry.ts cloud/src/security.ts cloud/wrangler.jsonc cloud/package.json cloud/tests/youtube-importer.test.ts cloud/tests/deploy-config.test.ts
git commit -m "Run YouTube clip imports in a per-account container Durable Object

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Import function, browser route and preview link

**Files:**
- Create: `cloud/src/youtube/import.ts`, `cloud/src/youtube/routes.ts`, `cloud/tests/youtube-fixtures.ts`
- Modify: `cloud/src/jobs.ts:64` (`AccountError`), `cloud/src/media.ts` (`preview` purpose), `cloud/src/index.ts` (route wiring)
- Test: `cloud/tests/youtube-import.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseYouTubeUrl`, `importBounds`, `rangeProblem`, `roundTenth`, `ClipSource`; Task 3 `fromResponse`, `ClipFailure`, `toResponse`, `ClipResult`; `storeUpload`, `discardUploads` (`cloud/src/uploads.ts`); `validateEditSource`, `MAX_EDIT_VIDEO_BYTES` (`lib/providers/video-edit.ts`); `sanitizeProviderMessage` (`cloud/src/failure.ts`); `mediaAccess` (`cloud/src/media.ts`).
- Produces:
  - `AccountError` gains a mutable `retryAfterSeconds?: number`
  - `interface YouTubeImportInput { url: string; startSeconds: number; endSeconds: number; edit?: { provider: string; modelId: string } }`
  - `interface YouTubeImportResult { uploadId: string; mimeType: 'video/mp4'; bytes: number; durationSeconds: number; width: number; height: number; expiresAt: number; source: ClipSource }`
  - `importYouTubeClip(env: Env, owner: string, input: YouTubeImportInput, signal?: AbortSignal): Promise<YouTubeImportResult>`
  - `youtubeRoutes(request: Request, env: Env): Promise<Response | null>` for `POST /api/account/youtube-clips`. It answers 201 with `YouTubeImportResult & { previewUrl: string }`, or `{ error, code, retryAfterSeconds? }`.
  - `mediaAccess(..., 'preview')`: a 10-minute GET link to a ready upload of that owner.
  - Test fixture `fakeImporter(respond)` and `clipOk(patch?)` from `cloud/tests/youtube-fixtures.ts` (Task 5 reuses them).

- [ ] **Step 1: Give `AccountError` a retry hint** (`cloud/src/jobs.ts:64`)

```ts
export class AccountError extends Error { retryAfterSeconds?: number; constructor(message: string, public status: number, public code: string) { super(message); } }
```

- [ ] **Step 2: Add the `preview` media purpose** (`cloud/src/media.ts`)

Change the `mediaAccess` purpose union to `'upload'|'agent-upload'|'input'|'download'|'preview'`. The existing expiry expression already gives anything other than `input`/`agent-upload` 600 000 ms. Change the regex in `mediaToken` to `/^\/media\/(upload|agent-upload|input|download|preview)\/([A-Za-z0-9_-]{43})$/`. In `readMedia`, before the final `return json({error:'File not found.'},404);`, add:

```ts
  // An imported clip shown to the person who imported it, before any job holds it.
  if(token.purpose==='preview'){
    const upload=await env.DB.prepare("SELECT object_key,mime_type,expected_bytes FROM account_uploads WHERE id=? AND user_id=? AND state='ready'").bind(token.resource_id,token.user_id).first<{object_key:string;mime_type:string;expected_bytes:number}>();
    if(upload)return serveObject(request,env,upload.object_key,upload.mime_type,upload.expected_bytes);
  }
```

`publicMedia` already sends every non-upload purpose to `readMedia` for GET/HEAD.

- [ ] **Step 3: Write `cloud/src/youtube/import.ts`**

Every `new AccountError(` stays on one line and ends with its code as a string literal. `cloud/tests/mcp-docs.test.ts` reads codes that way to check the public guide. Never name a local function `refusal`: the same scanner treats any `refusal(` call as an MCP refusal and fails on a non-literal argument.

```ts
import { importBounds, parseYouTubeUrl, rangeProblem, roundTenth, type ClipSource } from '../../../lib/youtube/clip';
import { MAX_EDIT_VIDEO_BYTES, validateEditSource } from '../../../lib/providers/video-edit';
import { sanitizeProviderMessage } from '../failure';
import { AccountError } from '../jobs';
import type { Env } from '../security';
import { discardUploads, storeUpload } from '../uploads';
import { fromResponse, type ClipFailure } from './importer-core';

export interface YouTubeImportInput { url: string; startSeconds: number; endSeconds: number; edit?: { provider: string; modelId: string } }
export interface YouTubeImportResult { uploadId: string; mimeType: 'video/mp4'; bytes: number; durationSeconds: number; width: number; height: number; expiresAt: number; source: ClipSource }

/** Container padding (AAC priming, a last frame) lands within this of the requested
 *  length; further off is a cut that went wrong. */
const LENGTH_SLACK_SECONDS = 0.25;
const UNAVAILABLE: Record<NonNullable<ClipFailure['reason']>, string> = {
  private: 'it is private', members: 'it is for channel members only', age: 'it is age-restricted',
  live: 'it is a live stream or premiere', removed: 'it is unavailable',
};

function withRetry(error: AccountError, seconds: number): AccountError {
  error.retryAfterSeconds = seconds;
  return error;
}

function toAccountError(failure: ClipFailure): AccountError {
  // yt-dlp's text is the one string here we did not write, and it can echo the proxy URL.
  const detail = sanitizeProviderMessage(failure.detail);
  if (detail) console.warn('youtube import refused', failure.code, detail);
  const wait = failure.retryAfterSeconds ?? 60;
  switch (failure.code) {
    case 'range': return new AccountError('That section runs past the end of the video.', 400, 'invalid_range');
    case 'unavailable': return new AccountError(`This video can't be imported: ${UNAVAILABLE[failure.reason ?? 'removed']}.`, 422, 'source_unavailable');
    case 'no_720p': return new AccountError('This video has no 720p version, which video editing needs.', 422, 'source_unavailable');
    case 'rate_limited': return withRetry(new AccountError(`Import limit reached. Try again in ${Math.ceil(wait / 60)} minutes.`, 429, 'import_rate_limited'), wait);
    case 'busy': return withRetry(new AccountError('Another import is still running for this account.', 429, 'import_rate_limited'), wait);
    case 'timeout': return withRetry(new AccountError('The import took too long. Try a shorter section.', 503, 'source_refused'), wait);
    case 'cancelled': return new AccountError('Import cancelled.', 503, 'source_refused');
    default: return withRetry(new AccountError('YouTube refused the download. Try again in a few minutes.', 503, 'source_refused'), wait);
  }
}

/** The one import path: the browser route and the MCP add_reference tool both call
 *  this, so a refusal an agent reads and one a person reads are the same check. */
export async function importYouTubeClip(env: Env, owner: string, input: YouTubeImportInput, signal?: AbortSignal): Promise<YouTubeImportResult> {
  const link = parseYouTubeUrl(input.url);
  if (!link) throw new AccountError('Paste a YouTube video or Shorts link.', 400, 'invalid_field');
  const bounds = importBounds(input.edit);
  if (!bounds) throw new AccountError('That model cannot edit a source video.', 400, 'invalid_field');
  const problem = rangeProblem(input.startSeconds, input.endSeconds, bounds);
  if (problem) throw new AccountError(problem, 400, 'invalid_range');
  if (!env.YOUTUBE_IMPORTER) throw withRetry(new AccountError('YouTube import is not available right now.', 503, 'source_refused'), 300);
  const source: ClipSource = { videoId: link.videoId, startSeconds: input.startSeconds, endSeconds: input.endSeconds };
  const clip = await fromResponse(await env.YOUTUBE_IMPORTER.getByName(owner).fetch('https://youtube-importer/clip', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(source), signal,
  }));
  if (!clip.ok) throw toAccountError(clip);
  if (!Number.isSafeInteger(clip.bytes) || clip.bytes <= 0 || clip.bytes > MAX_EDIT_VIDEO_BYTES) {
    await clip.body.cancel().catch(() => {});
    throw new AccountError('The clip came out larger than 100 MB. Choose a shorter section.', 413, 'invalid_range');
  }
  const requested = roundTenth(input.endSeconds - input.startSeconds);
  const stored = await storeUpload(env, owner, clip.body, clip.bytes, 'video/mp4');
  const discard = async (error: AccountError) => { await discardUploads(env, owner, [stored.id]); return error; };
  if (!(Math.abs(clip.durationSeconds - requested) <= LENGTH_SLACK_SECONDS)) throw await discard(withRetry(new AccountError('The section could not be cut cleanly. Try again.', 503, 'source_refused'), 10));
  const probed = { durationSeconds: requested, width: clip.width, height: clip.height };
  if (bounds.capability) {
    try { validateEditSource(probed, bounds.capability); }
    catch (error) { throw await discard(new AccountError(error instanceof Error ? error.message : 'This clip cannot be used as an edit source.', 422, 'source_unavailable')); }
  }
  return { uploadId: stored.id, mimeType: 'video/mp4', bytes: clip.bytes, ...probed, expiresAt: stored.expiresAt, source };
}
```

- [ ] **Step 4: Write `cloud/src/youtube/routes.ts`**

```ts
import { mediaAccess } from '../media';
import { AccountError } from '../jobs';
import { json, type Env } from '../security';
import { currentAccount } from '../sessions';
import { importYouTubeClip, type YouTubeImportInput } from './import';

function parseBody(value: unknown): YouTubeImportInput | null {
  if (!value || typeof value !== 'object') return null;
  const { url, startSeconds, endSeconds, edit } = value as Record<string, unknown>;
  if (typeof url !== 'string' || url.length > 2048 || typeof startSeconds !== 'number' || typeof endSeconds !== 'number') return null;
  if (edit === undefined) return { url, startSeconds, endSeconds };
  const { provider, modelId } = (edit ?? {}) as Record<string, unknown>;
  if (typeof provider !== 'string' || typeof modelId !== 'string' || provider.length > 100 || modelId.length > 200) return null;
  return { url, startSeconds, endSeconds, edit: { provider, modelId } };
}

/** POST /api/account/youtube-clips. Not under /imports: that path and its gateway
 *  pattern belong to the browser → cloud library import. */
export async function youtubeRoutes(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/account/youtube-clips') return null;
  if (request.method !== 'POST') return json({ error: 'Not found.' }, 404);
  const account = await currentAccount(request, env);
  if (!account) return json({ error: 'Sign in to import a clip.' }, 401);
  const text = await request.text();
  if (text.length > 4096) return json({ error: 'Request is too large.' }, 413);
  let input: YouTubeImportInput | null;
  try { input = parseBody(JSON.parse(text)); } catch { input = null; }
  if (!input) return json({ error: 'Invalid request.', code: 'invalid_field' }, 400);
  try {
    const clip = await importYouTubeClip(env, account.id, input, request.signal);
    // Vercel cannot relay a clip this size, so the browser fetches it from the Worker origin.
    const preview = await mediaAccess(env, account.id, clip.uploadId, 'preview');
    return json({ ...clip, previewUrl: preview.url }, 201);
  } catch (error) {
    if (!(error instanceof AccountError)) throw error;
    return json({ error: error.message, code: error.code, ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }, error.status);
  }
}
```

In `cloud/src/index.ts`, import `youtubeRoutes` from `'./youtube/routes'`. Insert it immediately **before** `const importResponse = await importRoutes(request,env);`:

```ts
    const youtubeResponse = await youtubeRoutes(request,env);
    if(youtubeResponse)return youtubeResponse;
```

- [ ] **Step 5: Write `cloud/tests/youtube-fixtures.ts`**

```ts
import { toResponse, type ClipRequest, type ClipResult } from '../src/youtube/importer-core';

export const CLIP_BYTES = new Uint8Array(2048).fill(7);
export const clipOk = (patch: Partial<Extract<ClipResult, { ok: true }>> = {}): ClipResult =>
  ({ ok: true, body: new Blob([CLIP_BYTES]).stream(), bytes: CLIP_BYTES.length, width: 1280, height: 720, durationSeconds: 12.4, ...patch });

/** Stands in for the YOUTUBE_IMPORTER namespace; records which owner each call addressed. */
export function fakeImporter(respond: (request: ClipRequest) => ClipResult | Promise<ClipResult>) {
  const calls: { owner: string; request: ClipRequest; signal?: AbortSignal | null }[] = [];
  const namespace = {
    getByName: (owner: string) => ({
      fetch: async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as ClipRequest;
        calls.push({ owner, request, signal: init.signal });
        return toResponse(await respond(request));
      },
    }),
  };
  return { namespace: namespace as unknown as DurableObjectNamespace, calls };
}
```

- [ ] **Step 6: Write `cloud/tests/youtube-import.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/index';
import { importYouTubeClip } from '../src/youtube/import';
import { accountCall, agentEnv, OWNER, signIn } from './agent-fixtures';
import { CLIP_BYTES, clipOk, fakeImporter } from './youtube-fixtures';

const URL_ = 'https://youtu.be/aqz-KE-bpKQ?si=x';
const SEEDANCE = { provider: 'runware', modelId: 'bytedance:seedance@2.5' };
afterEach(() => vi.restoreAllMocks());

describe('importYouTubeClip', () => {
  it('stages the section as a ready upload for its owner', async () => {
    const importer = fakeImporter(() => clipOk());
    const { env, db } = agentEnv({ YOUTUBE_IMPORTER: importer.namespace });
    const clip = await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4, edit: SEEDANCE });
    expect(clip).toMatchObject({ mimeType: 'video/mp4', bytes: CLIP_BYTES.length, durationSeconds: 12.4, width: 1280, height: 720, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } });
    expect(importer.calls).toEqual([{ owner: OWNER, request: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 }, signal: undefined }]);
    expect(db.prepare('SELECT state, user_id, expected_bytes FROM account_uploads WHERE id=?').get(clip.uploadId)).toEqual({ state: 'ready', user_id: OWNER, expected_bytes: CLIP_BYTES.length });
  });
  it('accepts a probed length a few hundredths over and reports the requested length', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk({ durationSeconds: 30.04 })).namespace });
    expect((await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 30, edit: SEEDANCE })).durationSeconds).toBe(30);
  });
  it('refuses bad links and ranges before calling the importer', async () => {
    const importer = fakeImporter(() => clipOk());
    const { env } = agentEnv({ YOUTUBE_IMPORTER: importer.namespace });
    await expect(importYouTubeClip(env, OWNER, { url: 'https://vimeo.com/1', startSeconds: 0, endSeconds: 10 })).rejects.toMatchObject({ code: 'invalid_field', message: 'Paste a YouTube video or Shorts link.' });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 31, edit: SEEDANCE })).rejects.toMatchObject({ code: 'invalid_range' });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 2, edit: SEEDANCE })).rejects.toMatchObject({ code: 'invalid_range' });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 2 })).resolves.toBeDefined(); // catalog-wide floor is 1 s
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 0, endSeconds: 10, edit: { provider: 'runware', modelId: 'runware:z-image@turbo' } })).rejects.toMatchObject({ code: 'invalid_field' });
    expect(importer.calls).toHaveLength(1);
  });
  it.each([
    [{ ok: false, code: 'range', detail: '' }, 'invalid_range', undefined],
    [{ ok: false, code: 'unavailable', reason: 'private', detail: '' }, 'source_unavailable', undefined],
    [{ ok: false, code: 'no_720p', detail: '' }, 'source_unavailable', undefined],
    [{ ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: 600 }, 'import_rate_limited', 600],
    [{ ok: false, code: 'busy', detail: '', retryAfterSeconds: 30 }, 'import_rate_limited', 30],
    [{ ok: false, code: 'refused', detail: '', retryAfterSeconds: 60 }, 'source_refused', 60],
    [{ ok: false, code: 'timeout', detail: '' }, 'source_refused', 60],
  ] as const)('maps %o to %s', async (failure, code, retry) => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => failure).namespace });
    const error = await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 }).catch(e => e);
    expect(error).toMatchObject({ code });
    expect(error.retryAfterSeconds).toBe(retry);
  });
  it('names the reason a video is unavailable', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => ({ ok: false, code: 'unavailable', reason: 'age', detail: '' })).namespace });
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 })).rejects.toThrow("This video can't be imported: it is age-restricted.");
  });
  it('never logs the proxy credentials yt-dlp echoes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => ({ ok: false, code: 'refused', detail: 'Unable to connect to proxy http://user:hunter2@proxy.example:8000 (timed out)' })).namespace });
    await importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 }).catch(() => {});
    expect(JSON.stringify(warn.mock.calls)).not.toContain('hunter2');
  });
  it('tombstones the upload when the clip fails the model source bounds or the cut is off', async () => {
    for (const patch of [{ width: 640, height: 360 }, { durationSeconds: 11 }]) {
      const { env, db } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk(patch)).namespace });
      await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4, edit: SEEDANCE })).rejects.toMatchObject({ code: expect.stringMatching(/source_unavailable|source_refused/) });
      expect(db.prepare("SELECT COUNT(*) AS n FROM account_uploads WHERE state='ready'").get()).toEqual({ n: 0 });
    }
  });
  it('answers source_refused with no importer bound', async () => {
    const { env } = agentEnv();
    await expect(importYouTubeClip(env, OWNER, { url: URL_, startSeconds: 62, endSeconds: 74.4 })).rejects.toMatchObject({ code: 'source_refused', message: 'YouTube import is not available right now.' });
  });
});

describe('POST /api/account/youtube-clips', () => {
  it('needs a session, imports, and hands back a working preview link for the owner only', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk()).namespace });
    const body = { url: URL_, startSeconds: 62, endSeconds: 74.4, edit: SEEDANCE };
    expect((await accountCall(env, 'youtube-clips', 'POST', '', body)).status).toBe(401);
    const response = await accountCall(env, 'youtube-clips', 'POST', await signIn(env), body);
    expect(response.status).toBe(201);
    const clip = await response.json() as { uploadId: string; previewUrl: string };
    const preview = await handleRequest(new Request(clip.previewUrl), env);
    expect(preview.status).toBe(200);
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(CLIP_BYTES);
  });
  it('returns the code and retry hint the browser shows', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => ({ ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: 600 })).namespace });
    const response = await accountCall(env, 'youtube-clips', 'POST', await signIn(env), { url: URL_, startSeconds: 62, endSeconds: 74.4 });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Import limit reached. Try again in 10 minutes.', code: 'import_rate_limited', retryAfterSeconds: 600 });
  });
  it('refuses malformed bodies', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk()).namespace });
    const cookie = await signIn(env);
    for (const bad of [{ url: URL_ }, { url: URL_, startSeconds: '1', endSeconds: 9 }, { url: URL_, startSeconds: 1, endSeconds: 9, edit: { provider: 1 } }]) {
      expect((await accountCall(env, 'youtube-clips', 'POST', cookie, bad)).status).toBe(400);
    }
  });
});
```

- [ ] **Step 7: Run the cloud suite and typecheck**

Run: `pnpm --dir cloud test && pnpm --dir cloud typecheck`
Expected: all PASS, including the existing `uploads`, `imports` and `ingress` tests (routing order) and `mcp-docs`. `mcp-docs` doesn't reach `import.ts` yet, because nothing in `mcp/` imports it until Task 5.

- [ ] **Step 8: Commit**

```bash
git add cloud/src/jobs.ts cloud/src/media.ts cloud/src/index.ts cloud/src/youtube/import.ts cloud/src/youtube/routes.ts cloud/tests/youtube-fixtures.ts cloud/tests/youtube-import.test.ts
git commit -m "Import a YouTube section as a temporary edit source through the account Worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: MCP `add_reference` youtube option

**Files:**
- Modify: `cloud/src/mcp/tools/references.ts`, `cloud/src/mcp/errors.ts`, `cloud/src/mcp/server.ts`, `app/docs/mcp/guide.md`
- Test: `cloud/tests/agent-references.test.ts`, `cloud/tests/mcp-docs.test.ts` (existing, must pass unchanged)

**Interfaces:**
- Consumes: Task 4 `importYouTubeClip`, `YouTubeImportResult`; Task 1 `parseYouTubeUrl`; Task 4 fixtures `fakeImporter`, `clipOk`.
- Produces: `add_reference` input gains `youtube?: { url: string; startSeconds: number; endSeconds: number; provider?: string; modelId?: string }`. It returns the `YouTubeImportResult` fields as structured content. `toRefusal` forwards `retryAfterSeconds`.

- [ ] **Step 1: Forward the retry hint** (`cloud/src/mcp/errors.ts`, in `toRefusal`)

```ts
  if (error instanceof AccountError) return refusal(error.code, error.message, error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}, isRetryableStatus(error.status));
```

- [ ] **Step 2: Extend the tool** (`cloud/src/mcp/tools/references.ts`)

Add imports:

```ts
import { parseYouTubeUrl } from '../../../../lib/youtube/clip';
import { importYouTubeClip } from '../../youtube/import';
```

Replace the `description`, `input` and the start of `run` as follows. Keep the existing `url` and `upload` branches below it unchanged.

```ts
  description: 'Stage a reference image, or a source video for edit mode, for generate. Pass exactly one of: url (an https link to a media file, downloaded now); upload with the file\'s mimeType and exact byte size, to get a putUrl, then PUT the file there with that Content-Type; or youtube with a YouTube link and startSeconds/endSeconds (one decimal), which cuts that section into an MP4 source video for edit mode — add provider and modelId to check the length against that model. Returns an uploadId to pass to generate (as sourceVideo in edit mode). YouTube imports are limited to 10 per hour per account.',
  input: z.object({
    url: z.string().max(2048).optional(),
    upload: z.object({ mimeType: z.enum(STAGEABLE), bytes: z.number().int().positive() }).optional(),
    youtube: z.object({
      url: z.string().max(2048),
      startSeconds: z.number().nonnegative(),
      endSeconds: z.number().positive(),
      provider: z.string().max(100).optional(),
      modelId: z.string().max(200).optional(),
    }).optional(),
  }),
  async run(ctx, args) {
    if ([args.url, args.upload, args.youtube].filter(Boolean).length !== 1) throw new ToolError('invalid_field', 'Pass exactly one of url, upload or youtube.', { field: 'url' });
    const owner = ctx.agent.user_id;
    if (args.youtube) {
      const { provider, modelId, ...range } = args.youtube;
      if (Boolean(provider) !== Boolean(modelId)) throw new ToolError('invalid_field', 'Pass provider and modelId together, or neither.', { field: 'youtube.modelId' });
      const clip = await importYouTubeClip(ctx.env, owner, { ...range, ...(provider && modelId ? { edit: { provider, modelId } } : {}) });
      return {
        structured: { ...clip },
        text: `Staged ${clip.durationSeconds}s (${clip.width}×${clip.height}) of YouTube video ${clip.source.videoId} as ${clip.uploadId}. Pass { "uploadId": "${clip.uploadId}" } as sourceVideo in edit mode.`,
      };
    }
    if (args.url && parseYouTubeUrl(args.url)) throw new ToolError('invalid_field', 'That is a YouTube page, not a media file. Pass it as youtube: { url, startSeconds, endSeconds } instead.', { field: 'url' });
```

- [ ] **Step 3: Add one sentence to the server instructions** (`cloud/src/mcp/server.ts`)

Find the instruction string that mentions `add_reference`, using `grep -n "add_reference" cloud/src/mcp/server.ts`. Append this to it, or if there is none, add it as a new array entry next to the reference instructions:

```ts
'To edit part of a YouTube video, stage it with add_reference({ youtube: { url, startSeconds, endSeconds, provider, modelId } }) and pass the uploadId as sourceVideo; tell the person if an import is refused rather than retrying before retryAfterSeconds.',
```

- [ ] **Step 4: Update the public guide** (`app/docs/mcp/guide.md`)

In `## References`, after the "From a file you have." block and before "**Using it.**", add:

````markdown
**From a YouTube video.** For edit mode, Scene Assembly can cut a section of a YouTube video into the source clip:

```json
{ "youtube": { "url": "https://youtu.be/aqz-KE-bpKQ", "startSeconds": 62, "endSeconds": 74.4, "provider": "runware", "modelId": "bytedance:seedance@2.5" } }
```

- Times are seconds to one decimal place. With `provider` and `modelId`, the section must fit that model's edit source length (`list_models`); without them, 1–30 seconds.
- Only that section is downloaded, at 720p or above, and saved as an MP4 for 24 hours. It is never added to the library.
- The response gives the clip's `durationSeconds`, `width` and `height`; check them against the model before calling `generate`.
- Private, members-only, age-restricted and live videos cannot be imported. An account can import 10 sections an hour, one at a time, shared with the browser.
- The call returns when the clip is ready, usually within 40 seconds and never more than 2 minutes.
````

In the `## Tools` table, replace the `add_reference` row with:

```markdown
| `add_reference` | Stages a reference image, or a source video for edit mode (from a file, a link, or a section of a YouTube video), and returns an `uploadId`. | `url`, `upload` with `mimeType` and `bytes`, or `youtube` with `url`, `startSeconds` and `endSeconds` |
```

In the `### References` errors table, append:

```markdown
| `invalid_range` | No | A YouTube section is outside the model's source length, not to a tenth of a second, or runs past the end of the video. |
| `source_unavailable` | No | The YouTube video is private, members-only, age-restricted, live or a premiere, has no version at 720p or above, or the clip does not meet the model's source size. The message says which. |
| `source_refused` | Yes | YouTube refused the download, the importer is busy or not available, or the import took too long. Wait `retryAfterSeconds`, then retry. |
| `import_rate_limited` | Yes | This account has imported 10 YouTube sections in the last hour, or another import is still running. Wait `retryAfterSeconds`. |
```

- [ ] **Step 5: Add tests to `cloud/tests/agent-references.test.ts`**

Add the import `import { clipOk, fakeImporter } from './youtube-fixtures';`, then add this block after the `add_reference` describe:

```ts
describe('add_reference with youtube', () => {
  const youtube = { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 };
  it('stages a section that generate accepts as an edit source', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk()).namespace });
    const client = await connectAgent(env, await seedAgent(env));
    const staged = structured<{ uploadId: string; durationSeconds: number; width: number; height: number; source: { videoId: string } }>(
      await client.callTool({ name: 'add_reference', arguments: { youtube: { ...youtube, provider: 'runware', modelId: 'bytedance:seedance@2.5' } } }));
    expect(staged).toMatchObject({ durationSeconds: 12.4, width: 1280, height: 720, source: { videoId: 'aqz-KE-bpKQ' } });
    expect(staged).not.toHaveProperty('previewUrl');
    const resolved = await resolveReferences({ env, agent: { user_id: OWNER } } as never, [], { uploadId: staged.uploadId });
    expect(resolved.sourceVideoId).toBe(staged.uploadId);
  });
  it('points a YouTube link given as url at the youtube option', async () => {
    const { env } = agentEnv();
    const client = await connectAgent(env, await seedAgent(env));
    expect(structured(await client.callTool({ name: 'add_reference', arguments: { url: youtube.url } }))).toMatchObject({ code: 'invalid_field', message: expect.stringContaining('youtube:') });
  });
  it('needs provider and modelId together, and exactly one source', async () => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => clipOk()).namespace });
    const client = await connectAgent(env, await seedAgent(env));
    expect(structured(await client.callTool({ name: 'add_reference', arguments: { youtube: { ...youtube, provider: 'runware' } } }))).toMatchObject({ code: 'invalid_field' });
    expect(structured(await client.callTool({ name: 'add_reference', arguments: { youtube, url: 'https://example.com/a.png' } }))).toMatchObject({ code: 'invalid_field' });
  });
  it.each([
    [{ ok: false, code: 'rate_limited', detail: '', retryAfterSeconds: 600 }, { code: 'import_rate_limited', retryable: true, retryAfterSeconds: 600 }],
    [{ ok: false, code: 'refused', detail: '', retryAfterSeconds: 60 }, { code: 'source_refused', retryable: true, retryAfterSeconds: 60 }],
    [{ ok: false, code: 'unavailable', reason: 'members', detail: '' }, { code: 'source_unavailable', retryable: false }],
    [{ ok: false, code: 'range', detail: '' }, { code: 'invalid_range', retryable: false }],
  ] as const)('refuses %o as %o', async (failure, expected) => {
    const { env } = agentEnv({ YOUTUBE_IMPORTER: fakeImporter(() => failure).namespace });
    const client = await connectAgent(env, await seedAgent(env));
    expect(structured(await client.callTool({ name: 'add_reference', arguments: { youtube } }))).toMatchObject(expected);
  });
});
```

If `resolveReferences`'s `ToolContext` type rejects the cast, build the context the way the existing "passes staged upload ids through untouched" test in this file does, and copy that pattern.

- [ ] **Step 6: Run the MCP and docs tests**

Run: `pnpm --dir cloud test -- agent-references mcp-docs && pnpm --dir cloud typecheck`
Expected: PASS. If `mcp-docs` names a code missing from the guide, it is a code the walk now reaches through `import.ts`. Add its row with the same wording rules, and don't silence the test.

- [ ] **Step 7: Commit**

```bash
git add cloud/src/mcp app/docs/mcp/guide.md cloud/tests/agent-references.test.ts
git commit -m "Let agents stage a YouTube section with add_reference

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gateway route, long timeout and abort forwarding

**Files:**
- Modify: `lib/account/gateway.ts`, `app/api/account/[...path]/route.ts`
- Test: `tests/account/gateway.test.ts`

**Interfaces:**
- Consumes: Task 4's Worker route.
- Produces: `/api/account/youtube-clips` (POST) is forwarded. Its upstream timeout is 130 000 ms and it is aborted when the browser's request aborts. A timeout or cancel answers 504 `{ error }`.

- [ ] **Step 1: Edit `lib/account/gateway.ts`**

Add `'youtube-clips'` to the `allowed` set. Then, just before `try {` around the upstream `fetch`, add:

```ts
  // A YouTube import holds the request while the Worker cuts the section (up to 120 s),
  // and Cancel in the dialog must reach the container, so this one path gets a longer
  // ceiling and the browser's own abort.
  const slow = path === 'youtube-clips';
```

Replace `signal: AbortSignal.timeout(25_000)` with:

```ts
signal: slow ? AbortSignal.any([request.signal, AbortSignal.timeout(130_000)]) : AbortSignal.timeout(25_000)
```

At the start of the `catch {` block, add:

```ts
    if (slow) return Response.json({ error: request.signal.aborted ? 'Import cancelled.' : 'The import took too long. Try a shorter section.' }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
```

- [ ] **Step 2: Raise the function ceiling** (`app/api/account/[...path]/route.ts`)

Add after `export const dynamic = 'force-dynamic';`:

```ts
// The YouTube import holds its request for up to 130 s; every other account route
// answers well inside the gateway's own 25 s upstream timeout.
export const maxDuration = 150;
```

- [ ] **Step 3: Add tests to `tests/account/gateway.test.ts`**

```ts
  it('forwards a YouTube import with a long ceiling and the browser abort', async () => {
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN', 'https://accounts.test');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ uploadId: 'u' }, { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const browser = new AbortController();
    const response = await accountGateway(new Request('https://app.test/api/account/youtube-clips', {
      method: 'POST', signal: browser.signal,
      headers: { origin: 'https://app.test', 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/aqz-KE-bpKQ', startSeconds: 1, endSeconds: 9 }),
    }));
    expect(response.status).toBe(201);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://accounts.test/api/account/youtube-clips');
    const forwarded: AbortSignal = fetcher.mock.calls[0][1].signal;
    expect(forwarded.aborted).toBe(false);
    browser.abort();
    expect(forwarded.aborted).toBe(true);
  });
  it('answers a cancelled YouTube import as cancelled, not as an outage', async () => {
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN', 'https://accounts.test');
    const browser = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))));
    const pending = accountGateway(new Request('https://app.test/api/account/youtube-clips', { method: 'POST', signal: browser.signal, headers: { origin: 'https://app.test' }, body: '{}' }));
    browser.abort();
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'Import cancelled.' });
  });
  it('still rejects neighbouring paths', async () => {
    vi.stubEnv('ACCOUNT_WORKER_ORIGIN', 'https://accounts.test');
    vi.stubGlobal('fetch', vi.fn());
    expect((await accountGateway(new Request('https://app.test/api/account/youtube-clips/x', { method: 'POST', headers: { origin: 'https://app.test' }, body: '{}' }))).status).toBe(404);
  });
```

If the existing "rejects unlisted routes" test shows the gateway answers an unlisted path with a status other than 404, use that status in the last test.

- [ ] **Step 4: Run**

Run: `pnpm vitest run tests/account/gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/account/gateway.ts "app/api/account/[...path]/route.ts" tests/account/gateway.test.ts
git commit -m "Forward YouTube imports through the account gateway with a long ceiling and cancel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Browser import call and one-use staging

**Files:**
- Create: `lib/account/staged-sources.ts`, `lib/account/youtube-clips.ts`
- Modify: `lib/account/useCloudWorkspace.ts:33-51`
- Test: `tests/account/staged-sources.test.ts`, `tests/account/execution.test.tsx`

**Interfaces:**
- Consumes: `accountRequest` (`lib/account/client.ts`); Task 1 `ClipSource`; Task 4 route response.
- Produces:
  - `stageSource(file: File, entry: { uploadId: string; owner: string; expiresAt: number }): void`
  - `stagedSourceId(file: File, owner: string, now?: number): string | undefined`. It returns undefined within 5 minutes of expiry.
  - `forgetStagedSource(file: File): void`
  - `interface YouTubeClipInput { url: string; startSeconds: number; endSeconds: number; provider: string; modelId: string }`
  - `importYouTubeClip(input: YouTubeClipInput, signal: AbortSignal, owner: string, onImported?: () => void): Promise<{ file: File; source: ClipSource }>`. `onImported` fires after the Worker answers, before the preview download.

- [ ] **Step 1: Write `lib/account/staged-sources.ts`**

```ts
/**
 * A source clip already uploaded by the Worker (a YouTube import), keyed by the
 * browser's copy of it so the edit form can stay a plain File.
 *
 * Staging is one-use: upload cleanup deletes an input as soon as every job holding
 * it has finished, so a second submission with the same clip must upload the
 * browser's copy instead of naming a row that may already be gone.
 */
interface StagedSource { uploadId: string; owner: string; expiresAt: number }
const staged = new WeakMap<File, StagedSource>();
/** Submission happens after this check; keep clear of the 24-hour edge. */
const EXPIRY_MARGIN_MS = 300_000;

export function stageSource(file: File, entry: StagedSource): void { staged.set(file, entry); }
export function forgetStagedSource(file: File): void { staged.delete(file); }
export function stagedSourceId(file: File, owner: string, now = Date.now()): string | undefined {
  const entry = staged.get(file);
  return entry && entry.owner === owner && entry.expiresAt - now > EXPIRY_MARGIN_MS ? entry.uploadId : undefined;
}
```

- [ ] **Step 2: Write `lib/account/youtube-clips.ts`**

```ts
import { accountRequest } from './client';
import { stageSource } from './staged-sources';
import type { ClipSource } from '@/lib/youtube/clip';

export interface YouTubeClipInput { url: string; startSeconds: number; endSeconds: number; provider: string; modelId: string }
interface ImportedClip { uploadId: string; bytes: number; expiresAt: number; previewUrl: string; source: ClipSource }

/** Cuts the section on the Worker, then fetches the finished clip once from the
 *  Worker origin (Vercel cannot relay it) so preview, probing and validation work on
 *  a File like any other source. The returned File is staged: submitting it skips the
 *  second upload. */
export async function importYouTubeClip(input: YouTubeClipInput, signal: AbortSignal, owner: string, onImported?: () => void): Promise<{ file: File; source: ClipSource }> {
  const clip = await accountRequest<ImportedClip>('youtube-clips', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Account-Id': owner },
    body: JSON.stringify({ url: input.url, startSeconds: input.startSeconds, endSeconds: input.endSeconds, edit: { provider: input.provider, modelId: input.modelId } }),
  });
  onImported?.();
  const response = await fetch(clip.previewUrl, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!response.ok) throw new Error('The clip was imported but could not be loaded. Try again.');
  const file = new File([await response.blob()], `youtube-${clip.source.videoId}-${Math.floor(clip.source.startSeconds)}s.mp4`, { type: 'video/mp4' });
  stageSource(file, { uploadId: clip.uploadId, owner, expiresAt: clip.expiresAt });
  return { file, source: clip.source };
}
```

- [ ] **Step 3: Skip the re-upload in `useCloudWorkspace.perform`** (`lib/account/useCloudWorkspace.ts`)

Add `import { forgetStagedSource, stagedSourceId } from './staged-sources';`. Inside the `if(!attempt||…){` block, replace the three lines from `const ids=await uploadAccountReferences(` to `const sourceVideoId=sourceVideo?ids.pop():undefined;` with:

```ts
      // A YouTube import is already on the Worker; upload only what is not.
      const stagedId=sourceVideo?stagedSourceId(sourceVideo,owner):undefined;
      const ids=await uploadAccountReferences([...files,...(sourceVideo&&!stagedId?[sourceVideo]:[])],undefined,owner);
      assertOwner();
      const sourceVideoId=stagedId??(sourceVideo?ids.pop():undefined);
```

After `const {job}=await submitAccountJob(attempt.token,attempt.request,undefined,owner);` add:

```ts
    // One-use: once a job holds the staged input, cleanup may delete it when that job ends.
    if(sourceVideo)forgetStagedSource(sourceVideo);
```

- [ ] **Step 4: Write `tests/account/staged-sources.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { forgetStagedSource, stageSource, stagedSourceId } from '@/lib/account/staged-sources';

describe('staged sources', () => {
  const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
  it('belongs to its owner, and lapses five minutes before expiry', () => {
    stageSource(file, { uploadId: 'u1', owner: 'owner', expiresAt: 1_000_000 });
    expect(stagedSourceId(file, 'owner', 1_000_000 - 300_001)).toBe('u1');
    expect(stagedSourceId(file, 'owner', 1_000_000 - 299_999)).toBeUndefined();
    expect(stagedSourceId(file, 'other', 0)).toBeUndefined();
    expect(stagedSourceId(new File(['x'], 'clip.mp4'), 'owner', 0)).toBeUndefined();
    forgetStagedSource(file);
    expect(stagedSourceId(file, 'owner', 0)).toBeUndefined();
  });
});
```

- [ ] **Step 5: Add hook tests to `tests/account/execution.test.tsx`**

Add `import { stageSource } from '@/lib/account/staged-sources';` at the top, then add inside `describe('account execution and isolation', …)`:

```ts
  it('submits a staged YouTube source without uploading it, then uploads the browser copy on the second submission', async () => {
    const runware: AccountSession = { ...session, providers: ['runware'], connections: [{ id: 'rw', provider: 'runware', hint: 'test', revision: 1 }] };
    useAccountStore.getState().applySession(runware); refresh.mockResolvedValue(runware);
    upload.mockResolvedValue(['uploaded-source']);
    const edit = { modelId: 'bytedance:seedance@2.5', mediaType: 'video' as const, inputMode: 'edit' as const, prompt: 'Clay', values: { size: '720p' } };
    const clip = new File(['mp4'], 'youtube.mp4', { type: 'video/mp4' });
    stageSource(clip, { uploadId: 'staged-source', owner: 'owner', expiresAt: Date.now() + 86_400_000 });
    const { result } = renderHook(() => useCloudWorkspace('runware'));
    await act(async () => { await result.current.submit(edit, [], 'Clay', clip); });
    expect(upload).toHaveBeenCalledWith([], undefined, 'owner');
    expect(submit.mock.calls[0][1]).toMatchObject({ sourceVideoId: 'staged-source' });
    await act(async () => { await result.current.submit({ ...edit, prompt: 'Clay again' }, [], 'Clay again', clip); });
    expect(upload).toHaveBeenLastCalledWith([clip], undefined, 'owner');
    expect(submit.mock.calls[1][1]).toMatchObject({ sourceVideoId: 'uploaded-source' });
  });
  it('uploads a staged source that belongs to a different account', async () => {
    const runware: AccountSession = { ...session, providers: ['runware'], connections: [{ id: 'rw', provider: 'runware', hint: 'test', revision: 1 }] };
    useAccountStore.getState().applySession(runware); refresh.mockResolvedValue(runware);
    upload.mockResolvedValue(['uploaded-source']);
    const clip = new File(['mp4'], 'youtube.mp4', { type: 'video/mp4' });
    stageSource(clip, { uploadId: 'someone-elses', owner: 'other', expiresAt: Date.now() + 86_400_000 });
    const { result } = renderHook(() => useCloudWorkspace('runware'));
    await act(async () => { await result.current.submit({ modelId: 'bytedance:seedance@2.5', mediaType: 'video', inputMode: 'edit', prompt: 'x', values: {} }, [], 'x', clip); });
    expect(submit.mock.calls[0][1]).toMatchObject({ sourceVideoId: 'uploaded-source' });
  });
```

- [ ] **Step 6: Run**

Run: `pnpm vitest run tests/account/staged-sources.test.ts tests/account/execution.test.tsx`
Expected: PASS. The existing execution tests are unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/account/staged-sources.ts lib/account/youtube-clips.ts lib/account/useCloudWorkspace.ts tests/account/staged-sources.test.ts tests/account/execution.test.tsx
git commit -m "Submit an imported YouTube clip without uploading it twice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: YouTube clip dialog and source wiring

**Files:**
- Create: `lib/youtube/iframe-api.ts`, `components/YouTubeClipDialog.tsx`
- Modify: `components/VideoSourceInput.tsx`, `components/ProviderVideoWorkspace.tsx:843`
- Test: `tests/youtube/clip-dialog.test.tsx`, `tests/youtube/source-input.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers; Task 7 `importYouTubeClip`; `DialogPortal`, `useAccessibleDialog`, `useAccountStore`.
- Produces:
  - `interface ClipPlayer { getCurrentTime(): number; getDuration(): number; seekTo(seconds: number, allowSeekAhead: boolean): void; playVideo(): void; pauseVideo(): void; destroy(): void }`
  - `createClipPlayer(element: HTMLElement, videoId: string): Promise<ClipPlayer>`
  - `interface YouTubeClipTarget { provider: string; modelId: string; modelLabel: string }`
  - `YouTubeClipDialog({ open, target, onClose, onImported }: { open: boolean; target: YouTubeClipTarget; onClose(): void; onImported(file: File, source: ClipSource): Promise<void> })`
  - `SourceVideo` gains `origin?: ClipSource`. `VideoSourceInput` gains the prop `youtube?: YouTubeClipTarget`.

- [ ] **Step 1: Write `lib/youtube/iframe-api.ts`**

```ts
'use client';

/** The few YouTube IFrame Player methods the clip dialog uses. */
export interface ClipPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface YouTubeNamespace { Player: new (element: HTMLElement, options: Record<string, unknown>) => ClipPlayer }
declare global { interface Window { YT?: YouTubeNamespace; onYouTubeIframeAPIReady?: () => void } }

let loading: Promise<YouTubeNamespace> | null = null;
function loadApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT!); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { loading = null; reject(new Error('The YouTube player could not load.')); };
    document.head.append(script);
  });
  return loading;
}

/** Mounts YouTube's own player (privacy-enhanced host) in `element`. Watching
 *  downloads nothing; only Import does. */
export async function createClipPlayer(element: HTMLElement, videoId: string): Promise<ClipPlayer> {
  const YT = await loadApi();
  return new Promise(resolve => {
    const player: ClipPlayer = new YT.Player(element, {
      videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0 },
      events: { onReady: () => resolve(player) },
    });
  });
}
```

- [ ] **Step 2: Write `components/YouTubeClipDialog.tsx`**

```tsx
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Play, X } from 'lucide-react';
import DialogPortal from '@/components/DialogPortal';
import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';
import { importYouTubeClip } from '@/lib/account/youtube-clips';
import { createClipPlayer, type ClipPlayer } from '@/lib/youtube/iframe-api';
import { formatClock, importBounds, parseClock, parseYouTubeUrl, rangeProblem, roundTenth, type ClipSource } from '@/lib/youtube/clip';
import { useAccountStore } from '@/store/useAccountStore';

export interface YouTubeClipTarget { provider: string; modelId: string; modelLabel: string }

const BUTTON = 'flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 text-sm font-medium text-[var(--foreground-muted)] transition-colors enabled:hover:border-[var(--neon-cyan)]/60 enabled:hover:text-[var(--foreground)] disabled:opacity-50';
const FIELD = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

export default function YouTubeClipDialog({ open, target, onClose, onImported }: {
  open: boolean; target: YouTubeClipTarget; onClose: () => void; onImported: (file: File, source: ClipSource) => Promise<void>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<ClipPlayer | null>(null);
  const controller = useRef<AbortController | null>(null);
  const titleId = useId();
  const [linkText, setLinkText] = useState('');
  const [fromText, setFromText] = useState('0:00.0');
  const [toText, setToText] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'fetching' | 'preparing'>('idle');
  const [error, setError] = useState<string | null>(null);

  const link = parseYouTubeUrl(linkText);
  const videoId = link?.videoId;
  const bounds = importBounds(target);
  const from = parseClock(fromText), to = parseClock(toText);
  const problem = !bounds ? 'This model cannot edit a source video.'
    : from === undefined || to === undefined ? 'Set From and To as times in the video, to a tenth of a second.'
    : rangeProblem(from, to, bounds);
  const length = from !== undefined && to !== undefined && to > from ? roundTenth(to - from) : null;
  const busy = phase !== 'idle';
  const close = () => { controller.current?.abort(); onClose(); };
  useAccessibleDialog({ open, onClose: close, dialogRef: panelRef });

  useEffect(() => {
    const host = playerHost.current;
    if (!open || !videoId || !host) return;
    let cancelled = false;
    const mount = document.createElement('div');
    host.replaceChildren(mount);
    void createClipPlayer(mount, videoId).then(created => {
      if (cancelled) { created.destroy(); return; }
      player.current = created;
      setDuration(created.getDuration() || null);
    }).catch(() => { if (!cancelled) setError('The YouTube player could not load. You can still type the times.'); });
    return () => { cancelled = true; player.current?.destroy(); player.current = null; };
  }, [open, videoId]);

  useEffect(() => {
    if (!looping || from === undefined || to === undefined) return;
    const timer = window.setInterval(() => { const p = player.current; if (p && p.getCurrentTime() >= to) p.seekTo(from, true); }, 100);
    return () => window.clearInterval(timer);
  }, [looping, from, to]);

  function changeLink(text: string) {
    setLinkText(text); setError(null); setLooping(false);
    const next = parseYouTubeUrl(text);
    if (next && next.videoId !== videoId) { setFromText(formatClock(next.startSeconds ?? 0)); setToText(''); setDuration(null); }
  }
  const mark = (set: (text: string) => void) => { const p = player.current; if (p) set(formatClock(p.getCurrentTime())); };
  function preview() {
    const p = player.current;
    if (!p || from === undefined) return;
    p.seekTo(from, true); p.playVideo(); setLooping(true);
  }

  async function submit() {
    if (!link || problem || from === undefined || to === undefined) return;
    const { session, epoch } = useAccountStore.getState();
    const owner = session?.account?.id;
    if (!owner) { setError('Sign in to import a clip.'); return; }
    const abort = new AbortController();
    controller.current = abort;
    setError(null); setPhase('fetching'); setLooping(false); player.current?.pauseVideo();
    try {
      const { file, source } = await importYouTubeClip({ url: linkText, startSeconds: from, endSeconds: to, provider: target.provider, modelId: target.modelId }, abort.signal, owner, () => setPhase('preparing'));
      // A clip imported for one account never attaches after a switch to another.
      if (useAccountStore.getState().epoch !== epoch) return;
      await onImported(file, source);
      onClose();
    } catch (cause) {
      setError(abort.signal.aborted ? 'Import cancelled.' : cause instanceof Error ? cause.message : 'The clip could not be imported.');
    } finally {
      if (controller.current === abort) controller.current = null;
      setPhase('idle');
    }
  }

  const percent = (seconds: number | undefined) => duration && seconds !== undefined ? `${Math.min(100, (seconds / duration) * 100)}%` : '0%';
  return <DialogPortal>{open && (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/70 backdrop-blur-md sm:items-center sm:p-4" onClick={close}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}
        className="glass-card flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl md:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="display text-lg font-semibold">Import a section from YouTube</h2>
          <button type="button" aria-label="Close" onClick={close} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[var(--foreground-muted)] hover:text-[var(--foreground)]"><X size={18} /></button>
        </div>
        <label className="block space-y-1 text-sm">
          <span>YouTube link</span>
          <input value={linkText} onChange={event => changeLink(event.target.value)} disabled={busy} inputMode="url" placeholder="https://www.youtube.com/watch?v=…" className={FIELD} />
        </label>
        {linkText.trim() && !link && <p role="alert" className="text-sm text-red-300">Paste a YouTube video or Shorts link.</p>}
        {link && <>
          <div ref={playerHost} data-testid="youtube-player" className="aspect-video w-full overflow-hidden rounded-xl bg-black [&_iframe]:h-full [&_iframe]:w-full" />
          <div className="relative h-1.5 w-full rounded-full bg-[var(--border)]" aria-hidden="true">
            {duration && from !== undefined && to !== undefined && to > from && <div className="absolute inset-y-0 rounded-full bg-[var(--neon-cyan)]" style={{ left: percent(from), width: `calc(${percent(to)} - ${percent(from)})` }} />}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" className={BUTTON} disabled={busy} onClick={() => mark(setFromText)}>Set start</button>
            <label className="space-y-1 text-xs"><span>From</span><input aria-label="From" value={fromText} onChange={event => setFromText(event.target.value)} disabled={busy} inputMode="decimal" className={`${FIELD} w-28`} /></label>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => mark(setToText)}>Set end</button>
            <label className="space-y-1 text-xs"><span>To</span><input aria-label="To" value={toText} onChange={event => setToText(event.target.value)} disabled={busy} inputMode="decimal" placeholder="m:ss.s" className={`${FIELD} w-28`} /></label>
            <button type="button" className={BUTTON} disabled={busy || Boolean(problem)} onClick={preview}><Play size={16} /> Preview range</button>
          </div>
          <p aria-live="polite" className={`text-sm ${problem && toText ? 'text-red-300' : 'text-[var(--foreground-muted)]'}`}>
            {length !== null ? `${length.toFixed(1)} s · ` : ''}{bounds ? `${target.modelLabel} edit takes ${bounds.minSeconds}–${bounds.maxSeconds} s` : problem}
          </p>
        </>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="mt-auto flex flex-wrap justify-end gap-2">
          {busy
            ? <button type="button" className={BUTTON} onClick={() => controller.current?.abort()}>Cancel import</button>
            : <button type="button" className={BUTTON} onClick={close}>Close</button>}
          <button type="button" className={`${BUTTON} text-[var(--foreground)]`} disabled={!link || Boolean(problem) || busy} onClick={() => void submit()}>
            {busy ? <><Loader2 size={16} className="animate-spin" /> {phase === 'fetching' ? 'Fetching section…' : 'Preparing clip…'}</> : 'Import clip'}
          </button>
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">Only this section is downloaded. It is kept for 24 hours as this edit&apos;s source and never added to your library.</p>
      </div>
    </div>
  )}</DialogPortal>;
}
```

Before writing it, check that `--border`, `--surface` and `--neon-cyan` exist in `app/globals.css` (`grep -n "\-\-border:\|\-\-surface:\|\-\-neon-cyan:" app/globals.css`). If a name differs, use the token `VideoSourceInput` and `LibraryOverlay` already use for the same purpose.

- [ ] **Step 3: Wire it into `components/VideoSourceInput.tsx`**

- Imports: add `Scissors` to the lucide import, and add `import YouTubeClipDialog, { type YouTubeClipTarget } from './YouTubeClipDialog';` and `import { formatClock, watchUrl, type ClipSource } from '@/lib/youtube/clip';`.
- Type: `export interface SourceVideo extends ProbedDimensions { file: File; epoch: number; origin?: ClipSource }`.
- Props: add `youtube?: YouTubeClipTarget` to the destructured props and their type.
- State: `const [youtubeOpen, setYoutubeOpen] = useState(false);`.
- `select` becomes `async function select(file: File, origin?: ClipSource)`, and its `onChange` call becomes `onChange({file, ...dimensions, epoch, ...(origin ? {origin} : {})});`.
- In the `<div className="flex gap-2">` row, add `flex-wrap` to its className, and after the Library button add:

```tsx
      {youtube && <button type="button" disabled={disabled || reading} onClick={() => setYoutubeOpen(true)} className="flex items-center justify-center gap-2 rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/5 px-4 py-3 text-sm font-medium text-[var(--foreground-muted)] transition-colors enabled:hover:border-[var(--neon-cyan)]/60 enabled:hover:bg-[var(--neon-cyan)]/10 enabled:hover:text-[var(--foreground)]"><Scissors size={18}/> From YouTube</button>}
```

- Replace the source caption `<p>` so the origin shows when present:

```tsx
    {source && <><SourceVideoPreview file={source.file} /><p className="break-all text-xs text-[var(--foreground-muted)]">{source.origin
      ? <a href={watchUrl(source.origin)} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">From YouTube · {formatClock(source.origin.startSeconds)}–{formatClock(source.origin.endSeconds)}</a>
      : source.file.name} · {source.durationSeconds.toFixed(1)}s · {source.width} × {source.height}</p></>}
```

- After `<LibraryOverlay …/>`, add:

```tsx
    {youtube && <YouTubeClipDialog open={youtubeOpen} target={youtube} onClose={() => setYoutubeOpen(false)} onImported={(file, origin) => select(file, origin)} />}
```

`select` rethrows its error, so the dialog shows it and stays open.

- [ ] **Step 4: Pass the target from the workspace** (`components/ProviderVideoWorkspace.tsx:843`)

```tsx
          {isEdit && <VideoSourceInput capability={selectedModel!.videoEdit!} source={source} onChange={setSelectedSource} disabled={isSubmitting}
            youtube={cloudWorkspace.cloud ? {provider, modelId: selectedModel!.id, modelLabel: selectedModel!.label} : undefined} />}
```

- [ ] **Step 5: Write `tests/youtube/clip-dialog.test.tsx`**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import YouTubeClipDialog from '@/components/YouTubeClipDialog';
import { useAccountStore } from '@/store/useAccountStore';

const { player, importClip } = vi.hoisted(() => ({
  player: { getCurrentTime: vi.fn(() => 62), getDuration: vi.fn(() => 596), seekTo: vi.fn(), playVideo: vi.fn(), pauseVideo: vi.fn(), destroy: vi.fn() },
  importClip: vi.fn(),
}));
vi.mock('@/lib/youtube/iframe-api', () => ({ createClipPlayer: vi.fn(async () => player) }));
vi.mock('@/lib/account/youtube-clips', () => ({ importYouTubeClip: importClip }));

const target = { provider: 'runware', modelId: 'bytedance:seedance@2.5', modelLabel: 'Seedance 2.5' };
const session = { account: { id: 'owner', name: 'Owner', email: 'o@example.test' }, googleEnabled: true, localSignIn: false, providers: ['runware'], connections: [] };
const file = new File(['mp4'], 'youtube.mp4', { type: 'video/mp4' });
function open(onImported = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) {
  render(<YouTubeClipDialog open target={target} onClose={onClose} onImported={onImported} />);
  return { onImported, onClose };
}
const link = (value: string) => fireEvent.change(screen.getByRole('textbox', { name: 'YouTube link' }), { target: { value } });
beforeEach(() => { vi.clearAllMocks(); useAccountStore.getState().applySession(session); });

describe('YouTubeClipDialog', () => {
  it('explains a link it cannot use and keeps Import disabled', () => {
    open(); link('https://vimeo.com/1');
    expect(screen.getByRole('alert')).toHaveTextContent('Paste a YouTube video or Shorts link.');
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeDisabled();
  });
  it('pre-fills From from the link, marks the player time, and reads out the length against the model', async () => {
    open(); link('https://youtu.be/aqz-KE-bpKQ?t=62');
    expect(screen.getByRole('textbox', { name: 'From' })).toHaveValue('1:02.0');
    await waitFor(() => expect(player.getDuration).toHaveBeenCalled());
    player.getCurrentTime.mockReturnValue(100);
    fireEvent.click(screen.getByRole('button', { name: 'Set end' }));
    expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('1:40.0');
    expect(screen.getByText(/38\.0 s · Seedance 2\.5 edit takes 4–30 s/)).toHaveClass('text-red-300');
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    expect(screen.getByText(/12\.4 s · Seedance 2\.5 edit takes 4–30 s/)).not.toHaveClass('text-red-300');
    expect(screen.getByRole('button', { name: 'Import clip' })).toBeEnabled();
  });
  it('imports the numbers it shows and hands the file on', async () => {
    importClip.mockResolvedValue({ file, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } });
    const { onImported, onClose } = open();
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(importClip).toHaveBeenCalledWith({ url: 'https://youtu.be/aqz-KE-bpKQ?t=62', startSeconds: 62, endSeconds: 74.4, provider: 'runware', modelId: 'bytedance:seedance@2.5' }, expect.any(AbortSignal), 'owner', expect.any(Function));
    expect(onImported).toHaveBeenCalledWith(file, { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 });
  });
  it('drops a clip that finishes after the account changed', async () => {
    let finish!: (value: unknown) => void;
    importClip.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { onImported } = open();
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
    act(() => { useAccountStore.getState().clear(); useAccountStore.getState().applySession({ ...session, account: { ...session.account, id: 'other' } }); });
    await act(async () => { finish({ file, source: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } }); });
    expect(onImported).not.toHaveBeenCalled();
  });
  it('cancels an import in flight and says so', async () => {
    importClip.mockImplementation((_input, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    open();
    link('https://youtu.be/aqz-KE-bpKQ?t=62');
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: '1:14.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import clip' }));
    expect(screen.getByRole('button', { name: /Fetching section/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Import cancelled.');
    expect(screen.getByRole('textbox', { name: 'To' })).toHaveValue('1:14.4');
  });
});
```

- [ ] **Step 6: Write `tests/youtube/source-input.test.tsx`**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VideoSourceInput from '@/components/VideoSourceInput';

vi.mock('@/lib/youtube/iframe-api', () => ({ createClipPlayer: vi.fn() }));
const capability = { minSeconds: 4, maxSeconds: 30, sizes: [], maxImages: 5, rate: { per: 'second' as const, usd: 0.1 } };
const file = new File(['mp4'], 'youtube-aqz-KE-bpKQ-62s.mp4', { type: 'video/mp4' });

describe('VideoSourceInput', () => {
  it('offers From YouTube only when given a target', () => {
    const { rerender } = render(<VideoSourceInput capability={capability} source={null} onChange={() => {}} disabled={false} />);
    expect(screen.queryByRole('button', { name: /From YouTube/ })).toBeNull();
    rerender(<VideoSourceInput capability={capability} source={null} onChange={() => {}} disabled={false} youtube={{ provider: 'runware', modelId: 'bytedance:seedance@2.5', modelLabel: 'Seedance 2.5' }} />);
    expect(screen.getByRole('button', { name: /From YouTube/ })).toBeEnabled();
  });
  it('labels an imported source with its origin and range', () => {
    render(<VideoSourceInput capability={capability} disabled={false} onChange={() => {}}
      source={{ file, epoch: 0, width: 1280, height: 720, durationSeconds: 12.4, origin: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } }} />);
    expect(screen.getByRole('link', { name: 'From YouTube · 1:02.0–1:14.4' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=62s');
  });
});
```

If `capability`'s shape doesn't satisfy `ProviderModel['videoEdit']`, copy the Seedance 2.5 `videoEdit` object from `lib/providers/catalog.ts`. If rendering fails because `LibraryOverlay` needs a provider (React Query, stores), wrap the render in the same providers `tests/providers/video-edit-workspace.test.tsx` uses.

- [ ] **Step 7: Run tests, lint and types**

Run: `pnpm vitest run tests/youtube tests/providers/video-edit-workspace.test.tsx tests/media/hover-play-adoption.test.ts && pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS and no errors. `hover-play-adoption` scans components for bare `<video>`. The dialog renders none: the embed is an iframe, and the source preview reuses `SourceVideoPreview`.

- [ ] **Step 8: Check it in the browser**

`.claude/launch.json` must have a configuration for the Next dev server (`pnpm dev`, port 3097). Add one if it doesn't. Start it with `preview_start`. Sign in locally. Then:
- Open the video workspace and choose Edit video with a Runware Seedance 2.5 model.
- Confirm **From YouTube** appears next to Upload and Library.
- Open the dialog, paste `https://youtu.be/aqz-KE-bpKQ?t=62`, and confirm the player loads and the markers and readout work.
- Resize to 375 px wide and confirm the dialog fills the height and nothing scrolls sideways.
- Take a screenshot.

Importing needs Task 10's container setup. Here, check that Import fails cleanly with "YouTube import is not available right now." when `pnpm dev` runs without containers.

- [ ] **Step 9: Commit**

```bash
git add lib/youtube/iframe-api.ts components/YouTubeClipDialog.tsx components/VideoSourceInput.tsx components/ProviderVideoWorkspace.tsx tests/youtube/clip-dialog.test.tsx tests/youtube/source-input.test.tsx .claude/launch.json
git commit -m "Pick a YouTube section as the edit source in the video workspace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Deploy pipeline and documentation

**Files:**
- Modify: `.github/workflows/deploy-account-worker.yml`, `docs/deployment.md`, `AGENTS.md`

- [ ] **Step 1: Deploy workflow**

In the "Require the Cloudflare token" step's error text, change the permission list to: `It needs Workers Scripts:Edit, D1:Edit, Workflows:Edit and Containers:Edit on the Rapid Systems account.` Add this comment above the `Deploy` step:

```yaml
      # Also builds and pushes cloud/containers/youtube (the YouTube clip importer):
      # ubuntu-latest has Docker, and `wrangler deploy` builds any image named in
      # `containers`. cloud/** already covers the image's files in the path filter.
```

- [ ] **Step 2: `docs/deployment.md`**

Add a section:

```markdown
## YouTube clip importer

The account Worker owns a Cloudflare Container (`cloud/containers/youtube`), which `wrangler deploy` builds and pushes. It needs:

- **Workers Paid** and a deploy token with **Containers:Edit**.
- **`YOUTUBE_PROXY_URL`**, a residential proxy, because YouTube refuses most datacenter IPs with a bot check: `pnpm --dir cloud exec wrangler secret put YOUTUBE_PROXY_URL`. Without it, imports answer `source_refused`.
- **A current yt-dlp.** When imports of public videos start failing with "YouTube refused the download" or "no 720p version" while the proxy is healthy, raise `YTDLP_VERSION` in the Dockerfile, run `cloud/containers/youtube/smoke.sh`, and push.

Locally, `pnpm --dir cloud dev` runs without containers, and the import route says it is unavailable. `pnpm --dir cloud dev:containers` needs Docker running.
```

- [ ] **Step 3: `AGENTS.md` routing entry**

Add under "Auto-load routing", next to the Edit video entry:

```markdown
- **YouTube clip import (edit source from a YouTube section)** → first read
  `docs/claude/specs/2026-10-13-youtube-clip-source-design.md` (its planning follow-ups
  override the body). `importYouTubeClip` in `cloud/src/youtube/import.ts` is the only
  import path: the browser route (`/api/account/youtube-clips`) and MCP
  `add_reference({ youtube })` both call it, because a refusal an agent reads and one a
  person reads must be the same check. The cut runs in a per-account Durable Object
  container (`YouTubeImporter`) because yt-dlp and ffmpeg need a real process; keep its
  logic in `importer-core.ts`, where it is testable without the Workers runtime. An
  imported clip is a one-use temporary input (`lib/account/staged-sources.ts`), never a
  library asset, because cleanup deletes an input once its jobs finish. Every
  `new AccountError(` in that path stays on one line with a literal code, or
  `mcp-docs.test.ts` cannot check the guide.
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-account-worker.yml docs/deployment.md AGENTS.md
git commit -m "Document the YouTube importer's deploy needs and routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Live verification (manual; one paid run, confirmed first)

**Files:** none changed unless a defect is found. A defect gets its own fix, test and commit in the task that owns the code.

- [ ] **Step 1: Local Worker with the container**

Start Docker. Run `pnpm --dir cloud exec wrangler secret put YOUTUBE_PROXY_URL --local`, or put `YOUTUBE_PROXY_URL=…` in `cloud/.dev.vars`. Then run `pnpm --dir cloud dev:containers` and the Next dev server, sign in locally, and connect a Runware key to the account.

- [ ] **Step 2: Browser import**

In Edit video (Seedance 2.5), import `https://youtu.be/aqz-KE-bpKQ` 1:02.0–1:14.4. Expected:
- The spinner goes "Fetching section…" then "Preparing clip…".
- The preview plays.
- The caption reads `From YouTube · 1:02.0–1:14.4 · 12.4s · 1920 × 1080` (or 1280 × 720).

Cancel a second import mid-way. "Import cancelled." should appear, and `docker ps` should show no lingering `yt-dlp` process within a few seconds (`docker exec <id> ps aux`).

- [ ] **Step 3: One paid Draft edit, after the user confirms the spend**

Show the estimate (Seedance 2.5 edit, 480p Draft, 12.4 s) and **ask the user to confirm** before submitting. After they confirm, submit with the prompt "Edit @Video1: restyle the clip as a clay animation. Preserve the subjects, composition, movement, camera, and timing." Expected:
- The job is accepted with no second source upload. The network panel shows no PUT to `/media/upload/`.
- It finishes and the result plays.
- Check the result frames by eye for the restyle.

- [ ] **Step 4: MCP**

Connect a real MCP client to the local server. Call `add_reference({ youtube: { url, startSeconds: 62, endSeconds: 74.4, provider: 'runware', modelId: 'bytedance:seedance@2.5' } })`. Expect an `uploadId` with dimensions. Call it again before the first finishes, from a second client, and expect `import_rate_limited`. Do not call `generate`: the paid path was proven in Step 3.

- [ ] **Step 5: Report**

Tell the user what was verified, with the screenshot and the job id. If the proxy or YouTube refused, say so and don't call it done. Deployment (push to `main`, setting `YOUTUBE_PROXY_URL` in production, Containers:Edit on the token) waits for the user's go-ahead.
