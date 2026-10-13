import { YOUTUBE_IMPORTS_PER_HOUR, type ClipSource } from '../../../lib/youtube/clip';

/** The slice of `ctx.container` the importer uses, so tests can hand it a fake. */
export interface ClipProcess {
  stdout: ReadableStream<Uint8Array> | null;
  exitCode: Promise<number>;
  output(): Promise<{ stdout: ArrayBuffer; stderr: ArrayBuffer; exitCode: number }>;
  /** Queues a signal; the default is SIGTERM. */
  kill(signal?: number): void;
}
export interface ClipContainer {
  readonly running: boolean;
  start(options: { enableInternet: boolean }): void;
  exec(cmd: string[], options?: { env?: Record<string, string>; stdout?: 'pipe' | 'ignore'; stderr?: 'pipe' | 'ignore' }): Promise<ClipProcess>;
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

/** Deliberately not exec()'s own `signal` option: that sends SIGKILL to the exec'd
 *  process only, which would orphan yt-dlp and ffmpeg and skip clip.py's SIGTERM
 *  handler (it kills the whole process group), and aborting an exec that already
 *  exited throws inside the Durable Object. kill() defaults to SIGTERM, and the
 *  listener goes away once the process has exited. */
function killOnAbort(proc: ClipProcess, signal: AbortSignal) {
  if (signal.aborted) { proc.kill(); return; }
  const kill = () => proc.kill();
  signal.addEventListener('abort', kill, { once: true });
  const remove = () => signal.removeEventListener('abort', kill);
  proc.exitCode.then(remove, remove);
}

export async function runClip(container: ClipContainer, request: ClipRequest, options: { proxyUrl?: string; signal: AbortSignal; workId: string; sleep(ms: number): Promise<void> }): Promise<ClipResult> {
  await ready(container, options.sleep);
  const work = `/tmp/clips/${options.workId}`;
  const cleanup = () => container.exec(['rm', '-rf', work], { stdout: 'ignore', stderr: 'ignore' }).then(() => {}, () => {});
  let line = '';
  try {
    const clip = await container.exec(
      ['python3', '/app/clip.py', request.videoId, request.startSeconds.toFixed(1), request.endSeconds.toFixed(1), work],
      { env: options.proxyUrl ? { YOUTUBE_PROXY_URL: options.proxyUrl } : {}, stdout: 'pipe', stderr: 'ignore' },
    );
    killOnAbort(clip, options.signal);
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
  const file = await container.exec(['cat', path], { stdout: 'pipe', stderr: 'ignore' });
  killOnAbort(file, options.signal);
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
