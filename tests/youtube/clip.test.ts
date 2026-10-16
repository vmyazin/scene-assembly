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
    expect(importBounds({ provider: 'fal', modelId: 'veo-3-1-fast' })).toBeNull();
    expect(importBounds({ provider: 'fal', modelId: 'unknown' })).toBeNull();
    expect(importBounds({ provider: 'runware', modelId: 'runware:z-image@turbo' })).toBeNull();
    expect(importBounds({ provider: 'nope', modelId: 'x' })).toBeNull();
    expect(importBounds({ provider: 'toString', modelId: 'x' })).toBeNull();
  });
  it.each([
    ['kling-o1-edit', 10.05, 2160],
    ['kling-o3-standard-edit', 15, 3840],
  ])('uses fal edit limits for %s in the dialog and importer', (modelId, maxSeconds, maxEdge) => {
    const bounds = importBounds({ provider: 'fal', modelId })!;
    expect(bounds).toMatchObject({ minSeconds: 3, maxSeconds, capability: { sourceBounds: { minEdge: 720, maxEdge } } });
    expect(rangeProblem(0, 3, bounds)).toBeNull();
    expect(rangeProblem(0, 2.9, bounds)).toMatch(/Choose a section/);
    expect(rangeProblem(0, 15.1, bounds)).toMatch(/Choose a section/);
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
