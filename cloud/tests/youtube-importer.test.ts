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
