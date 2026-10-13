import { describe, expect, it, vi } from 'vitest';
import { admit, fromResponse, handleImport, toResponse, type ClipContainer, type ClipProcess, type GateStorage, type ImporterDeps } from '../src/youtube/importer-core';

const ID = 'aqz-KE-bpKQ';
const encode = (text: string) => new TextEncoder().encode(text);
type Scripted = Omit<ClipProcess, 'kill'> & { kill?(signal?: number): void };
const fakeProcess = (stdout: Uint8Array, exit = 0): Scripted => ({
  stdout: new Blob([stdout]).stream(), exitCode: Promise.resolve(exit),
  output: async () => ({ stdout: stdout.slice().buffer, stderr: new ArrayBuffer(0), exitCode: exit }),
});
function fakeContainer(script: (cmd: string[]) => Scripted | Promise<Scripted>) {
  const calls: { cmd: string[]; env?: Record<string, string> }[] = [];
  /** Every kill() on any process, as the signal argument it received. */
  const kills: (number | undefined)[] = [];
  let signalOptionSeen = false;
  let running = false;
  const container: ClipContainer = {
    get running() { return running; },
    start: () => { running = true; },
    setInactivityTimeout: async () => {},
    exec: async (cmd, options) => {
      if (options && 'signal' in options) signalOptionSeen = true; // exec's own signal would SIGKILL and can throw after exit
      calls.push({ cmd, env: options?.env });
      const proc = await script(cmd);
      return { ...proc, kill: signal => { kills.push(signal); proc.kill?.(signal); } };
    },
  };
  return { container, calls, kills, get signalOptionSeen() { return signalOptionSeen; } };
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
    const fake = fakeContainer(cmd => cmd[0] === 'python3' ? fakeProcess(encode(`noise\n${success('/tmp/clips/work-1')}\n`)) : fakeProcess(encode(cmd[0] === 'cat' ? 'MP4!' : '')));
    const { container, calls } = fake;
    const result = await handleImport(deps(container), body, signal());
    expect(fake.signalOptionSeen).toBe(false);
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
    const reply = (json: string) => fakeContainer(cmd => fakeProcess(encode(cmd[0] === 'python3' ? json : ''))).container;
    expect(await handleImport(deps(reply('{"ok":false,"code":"unavailable","reason":"private","detail":"Private video"}')), body, signal()))
      .toEqual({ ok: false, code: 'unavailable', reason: 'private', detail: 'Private video' });
    expect(await handleImport(deps(reply('{"ok":false,"code":"rm -rf","reason":"x"}')), body, signal())).toMatchObject({ ok: false, code: 'failed' });
    expect(await handleImport(deps(reply('Traceback (most recent call last)')), body, signal())).toMatchObject({ ok: false, code: 'failed' });
    expect(await handleImport(deps(reply('{"ok":true,"path":"/etc/passwd","bytes":1,"width":1,"height":1,"duration":1}')), body, signal())).toMatchObject({ ok: false, code: 'failed' });
  });
  it('reports cancelled and timeout separately, sends SIGTERM, and releases the slot', async () => {
    // A process that only ends once it is killed; `settle` decides whether output() rejects or resolves.
    const hang = (settle: 'reject' | 'resolve') => {
      const fake = fakeContainer(cmd => {
        if (cmd[0] !== 'python3') return fakeProcess(new Uint8Array());
        let end!: () => void;
        const ended = new Promise<void>(resolve => { end = resolve; });
        return {
          stdout: null, exitCode: ended.then(() => 143),
          output: () => ended.then(() => settle === 'reject' ? Promise.reject(new Error('killed')) : { stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 143 }),
          kill: () => end(),
        };
      });
      return fake;
    };
    for (const settle of ['reject', 'resolve'] as const) {
      const fake = hang(settle);
      const cancel = new AbortController();
      const state = { busy: false };
      const pending = handleImport(deps(fake.container, { state }), body, cancel.signal);
      await vi.waitFor(() => expect(fake.calls.map(c => c.cmd[0])).toContain('python3'));
      cancel.abort();
      expect(await pending).toMatchObject({ ok: false, code: 'cancelled' });
      expect(state.busy).toBe(false);
      expect(fake.signalOptionSeen).toBe(false);
      expect(fake.kills).toHaveLength(1);
      expect([undefined, 15]).toContain(fake.kills[0]);
      const timed = hang(settle);
      const clock = new AbortController();
      const waiting = handleImport(deps(timed.container), body, clock.signal);
      await vi.waitFor(() => expect(timed.calls.map(c => c.cmd[0])).toContain('python3'));
      clock.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      expect(await waiting).toMatchObject({ ok: false, code: 'timeout' });
      expect(timed.kills).toHaveLength(1);
      expect([undefined, 15]).toContain(timed.kills[0]);
    }
  });
  it('kills a running process on a later abort but never touches one that already exited', async () => {
    const { container, kills } = fakeContainer(cmd => cmd[0] === 'python3' ? fakeProcess(encode(success('/tmp/clips/work-1'))) : fakeProcess(encode('MP4!')));
    const controller = new AbortController();
    const result = await handleImport(deps(container), body, controller.signal);
    await new Response((result as { body: ReadableStream }).body).text();
    await Promise.resolve();
    controller.abort();
    expect(kills).toEqual([]);
  });
  it('keeps the account busy until the clip is streamed out and removed', async () => {
    let catExit!: (code: number) => void;
    const idle: number[] = [];
    const fake = fakeContainer(cmd => cmd[0] === 'python3' ? fakeProcess(encode(success('/tmp/clips/work-1')))
      : cmd[0] === 'cat' ? { ...fakeProcess(encode('MP4!')), exitCode: new Promise<number>(resolve => { catExit = resolve; }) }
      : fakeProcess(new Uint8Array()));
    fake.container.setInactivityTimeout = async ms => { idle.push(Number(ms)); };
    const state = { busy: false };
    const result = await handleImport(deps(fake.container, { state }), body, signal());
    expect(result.ok).toBe(true);
    expect(state.busy).toBe(true);
    expect(idle).toEqual([]);
    expect(await handleImport(deps(fake.container, { state }), body, signal())).toMatchObject({ ok: false, code: 'busy' });
    expect(await new Response((result as { body: ReadableStream }).body).text()).toBe('MP4!');
    expect(state.busy).toBe(true); // the body is read, but cat has not exited yet
    catExit(0);
    await vi.waitFor(() => expect(state.busy).toBe(false));
    expect(idle).toEqual([60_000]);
    expect(fake.calls.map(c => c.cmd[0])).toContain('rm');
    expect(await handleImport(deps(fake.container, { state }), body, signal())).toMatchObject({ ok: true });
  });
  it('escalates to SIGKILL when SIGTERM is ignored, and stops the timer once the process exits', async () => {
    vi.useFakeTimers();
    try {
      let end!: () => void;
      const stubborn = fakeContainer(cmd => {
        if (cmd[0] !== 'python3') return fakeProcess(new Uint8Array());
        const ended = new Promise<void>(resolve => { end = resolve; });
        return { stdout: null, exitCode: ended.then(() => 137), output: () => ended.then(() => ({ stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 137 })), kill: signal => { if (signal === 9) end(); } };
      });
      const cancel = new AbortController();
      const state = { busy: false };
      const pending = handleImport(deps(stubborn.container, { state }), body, cancel.signal);
      await vi.advanceTimersByTimeAsync(0);
      cancel.abort();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(stubborn.kills).toEqual([undefined]);
      expect(state.busy).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(stubborn.kills).toEqual([undefined, 9]);
      expect(await pending).toMatchObject({ ok: false, code: 'cancelled' });
      expect(state.busy).toBe(false);
      // A process that exits on SIGTERM is never SIGKILLed.
      const polite = fakeContainer(cmd => {
        if (cmd[0] !== 'python3') return fakeProcess(new Uint8Array());
        const ended = new Promise<void>(resolve => { end = resolve; });
        return { stdout: null, exitCode: ended.then(() => 143), output: () => ended.then(() => ({ stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 143 })), kill: () => end() };
      });
      const again = new AbortController();
      const second = handleImport(deps(polite.container), body, again.signal);
      await vi.advanceTimersByTimeAsync(0);
      again.abort();
      await second;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(polite.kills).toEqual([undefined]);
    } finally { vi.useRealTimers(); }
  });
  it('survives kill() throwing because the process just exited', async () => {
    const racy = fakeContainer(cmd => cmd[0] === 'python3'
      ? { stdout: null, exitCode: new Promise<number>(() => {}), output: async () => { throw new Error('killed'); }, kill: () => { throw new Error('internal error'); } }
      : fakeProcess(new Uint8Array()));
    const cancel = new AbortController();
    cancel.abort();
    expect(await handleImport(deps(racy.container), body, cancel.signal)).toMatchObject({ ok: false, code: 'cancelled' });
  });
  it('stops probing for the container once cancelled, instead of holding the slot', async () => {
    const cancel = new AbortController();
    let probes = 0;
    const fake = fakeContainer(() => { probes++; throw new Error('not up yet'); });
    const state = { busy: false };
    const result = await handleImport(deps(fake.container, { state, sleep: async () => { if (probes === 3) cancel.abort(); } }), body, cancel.signal);
    expect(result).toMatchObject({ ok: false, code: 'cancelled' });
    expect(probes).toBe(3);
    expect(state.busy).toBe(false);
    const timedOut = AbortSignal.abort(new DOMException('', 'TimeoutError'));
    expect(await handleImport(deps(fakeContainer(() => fakeProcess(new Uint8Array())).container), body, timedOut)).toMatchObject({ ok: false, code: 'timeout' });
  });
  it('does not hand out a clip stream when cancelled while it was being opened', async () => {
    const cancel = new AbortController();
    const fake = fakeContainer(cmd => {
      if (cmd[0] === 'cat') cancel.abort();
      return cmd[0] === 'python3' ? fakeProcess(encode(success('/tmp/clips/work-1'))) : fakeProcess(encode('MP4!'));
    });
    const state = { busy: false };
    expect(await handleImport(deps(fake.container, { state }), body, cancel.signal)).toMatchObject({ ok: false, code: 'cancelled' });
    expect(state.busy).toBe(false);
    expect(fake.kills).toEqual([undefined]);
    await vi.waitFor(() => expect(fake.calls.map(c => c.cmd[0])).toContain('rm'));
  });
  it('refuses a second import while one runs, and a container that never starts', async () => {
    expect(await handleImport(deps(fakeContainer(() => fakeProcess(new Uint8Array())).container, { state: { busy: true } }), body, signal()))
      .toEqual({ ok: false, code: 'busy', detail: '', retryAfterSeconds: 30 });
    const dead = fakeContainer(() => { throw new Error('max_instances reached'); }).container;
    expect(await handleImport(deps(dead), body, signal())).toMatchObject({ ok: false, code: 'refused', retryAfterSeconds: 60 });
    expect(await handleImport(deps(undefined), body, signal())).toMatchObject({ ok: false, code: 'refused' });
  });
  it('rejects malformed requests before touching the container', async () => {
    const { container, calls } = fakeContainer(() => fakeProcess(new Uint8Array()));
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
