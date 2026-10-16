import { beforeEach, expect, it, vi } from 'vitest';
import { trimVideoToLimit, videoTrimNotice } from '@/lib/media/trim-video';
import { probeDimensions } from '@/lib/timeline/probe';

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(), init: vi.fn(), cancel: vi.fn(), execute: vi.fn(), video: vi.fn(),
}));
vi.mock('@/lib/timeline/probe', () => ({probeDimensions: vi.fn()}));
vi.mock('mediabunny', () => ({
  Input: class { dispose = mocks.dispose; getPrimaryVideoTrack = mocks.video; },
  BlobSource: class {}, ALL_FORMATS: [],
  BufferTarget: class { buffer = new ArrayBuffer(12); },
  Output: class {}, Mp4OutputFormat: class {}, Conversion: {init: mocks.init},
}));
const dimensions = {width:1280,height:720,durationSeconds:12};
const file = new File(['original'], 'clip.mov', {type:'video/quicktime'});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.video.mockResolvedValue({});
  mocks.cancel.mockResolvedValue(undefined);
  mocks.init.mockResolvedValue({isValid:true,discardedTracks:[],state:'done',execute:mocks.execute,cancel:mocks.cancel});
  vi.mocked(probeDimensions).mockResolvedValue({...dimensions,durationSeconds:9.98});
});
it('leaves short and exact-limit clips byte-identical without opening a converter', async () => {
  for (const durationSeconds of [4,10.05]) {
    expect((await trimVideoToLimit(file,{...dimensions,durationSeconds},10.05)).file).toBe(file);
  }
  expect(mocks.init).not.toHaveBeenCalled();
});
it('trims padded clips and reports the probed duration, not the requested duration', async () => {
  const result = await trimVideoToLimit(file,{...dimensions,durationSeconds:10.08},10.05);
  expect(result).toMatchObject({durationSeconds:9.98,trimmedFromSeconds:10.08});
  expect(result.file.name).toBe('clip-trimmed.mp4');
  expect(result.file.type).toBe('video/mp4');
  expect(result.file).not.toBe(file);
  expect(mocks.init.mock.calls[0][0].trim.end).toBeCloseTo(9.95);
  expect(videoTrimNotice(result)).toContain('first 9.98 seconds');
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
it('rejects output still above the hard limit instead of trusting the trim request', async () => {
  vi.mocked(probeDimensions).mockResolvedValue({...dimensions,durationSeconds:10.06});
  await expect(trimVideoToLimit(file,dimensions,10.05)).rejects.toThrow('model’s limit');
  expect(mocks.dispose).toHaveBeenCalledOnce();
});
it('does not silently discard an unsupported audio track', async () => {
  mocks.init.mockResolvedValue({isValid:true,discardedTracks:[{track:'audio'}],state:'idle',cancel:mocks.cancel});
  await expect(trimVideoToLimit(file,dimensions,10.05)).rejects.toThrow('keeping its video and audio');
  expect(mocks.cancel).toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalled();
});
it('cancels conversion and releases resources when selection becomes stale', async () => {
  const controller = new AbortController();
  mocks.execute.mockImplementation(async () => {controller.abort();});
  await expect(trimVideoToLimit(file,dimensions,10.05,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  expect(mocks.cancel).toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalled();
});
it.each([0,NaN,Infinity])('refuses an unreadable length %s', async durationSeconds => {
  await expect(trimVideoToLimit(file,{...dimensions,durationSeconds},10)).rejects.toThrow('usable video length');
  expect(mocks.init).not.toHaveBeenCalled();
});
