import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  candidatesFromSizes,
  candidatesFromValues,
  closestAspectCandidate,
  describeAspectMismatch,
  parseAspect,
  useAutoAspect,
} from '../../lib/draft/aspect-match';
import type { DraftReference } from '../../store/useDraftStore';

function reference(id: string, width?: number, height?: number): DraftReference {
  return {
    id,
    file: new File(['x'], `${id}.png`, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
    width,
    height,
  };
}

describe('parseAspect', () => {
  it.each([
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1280x720', 1280 / 720],
    ['1280×720', 1280 / 720],
    ['auto', null],
    ['720p', null],
    ['0:9', null],
    ['landscape', null],
  ])('%s → %s', (value, expected) => {
    const ratio = parseAspect(value);
    if (expected === null) expect(ratio).toBeNull();
    else expect(ratio).toBeCloseTo(expected);
  });
});

describe('closestAspectCandidate', () => {
  const options = candidatesFromValues(['1:1', '16:9', '9:16', '21:9']);

  it('matches a portrait photo to the portrait option', () => {
    expect(closestAspectCandidate(1080, 1920, options)?.value).toBe('9:16');
  });

  it('matches a landscape photo to the landscape option', () => {
    expect(closestAspectCandidate(4032, 2268, options)?.value).toBe('16:9');
  });

  it('treats 2:1 and 1:2 as equally far from square (log-space distance)', () => {
    const square = candidatesFromValues(['1:1']);
    expect(closestAspectCandidate(200, 100, square)?.value).toBe('1:1');
    expect(closestAspectCandidate(100, 200, square)?.value).toBe('1:1');
  });

  it('returns null when nothing is parsable', () => {
    expect(closestAspectCandidate(100, 100, [])).toBeNull();
  });
});

describe('candidatesFromValues', () => {
  it('keeps only ratio-shaped strings', () => {
    expect(candidatesFromValues(['auto', '16:9', 1024, true]).map((c) => c.value)).toEqual(['16:9']);
  });
});

describe('candidatesFromSizes', () => {
  it('prefers published pixels, falls back to the label, skips bare presets', () => {
    const candidates = candidatesFromSizes([
      { label: 'HD (16:9)', width: 1280, height: 720 },
      { label: '720×1280' },
      { label: '720p', preset: '720p' },
    ]);
    expect(candidates.map((c) => c.value)).toEqual(['HD (16:9)', '720×1280']);
    expect(candidates[0].ratio).toBeCloseTo(16 / 9);
    expect(candidates[1].ratio).toBeCloseTo(9 / 16);
  });
});

describe('useAutoAspect', () => {
  const candidates = candidatesFromValues(['16:9', '9:16']);

  it('applies the match once the reference has dimensions', () => {
    const apply = vi.fn();
    const { rerender } = renderHook(
      ({ ref }: { ref: DraftReference | undefined }) => useAutoAspect(ref, candidates, apply),
      { initialProps: { ref: reference('a') as DraftReference | undefined } }
    );
    expect(apply).not.toHaveBeenCalled();

    // The measurement lands later, as it does in the store.
    rerender({ ref: reference('a', 1080, 1920) });
    expect(apply).toHaveBeenCalledExactlyOnceWith('9:16');
  });

  it('re-applies for a new reference, but not on unrelated re-renders', () => {
    const apply = vi.fn();
    const { rerender } = renderHook(
      ({ ref }: { ref: DraftReference }) => useAutoAspect(ref, candidates, apply),
      { initialProps: { ref: reference('a', 1080, 1920) } }
    );
    expect(apply).toHaveBeenCalledTimes(1);

    rerender({ ref: reference('a', 1080, 1920) });
    expect(apply).toHaveBeenCalledTimes(1);

    rerender({ ref: reference('b', 1920, 1080) });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith('16:9');
  });

  it('re-applies when the candidate list changes (model switch)', () => {
    const apply = vi.fn();
    const { rerender } = renderHook(
      ({ options }: { options: ReturnType<typeof candidatesFromValues> }) =>
        useAutoAspect(reference('a', 1080, 1920), options, apply),
      { initialProps: { options: candidates } }
    );
    expect(apply).toHaveBeenLastCalledWith('9:16');

    rerender({ options: candidatesFromValues(['1:1', '3:4']) });
    expect(apply).toHaveBeenLastCalledWith('3:4');
  });

  it('stays quiet without a reference or without a parsable candidate', () => {
    const apply = vi.fn();
    renderHook(() => useAutoAspect(undefined, candidates, apply));
    renderHook(() => useAutoAspect(reference('a', 100, 100), [], apply));
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('an explicit size choice survives a new reference',()=>{
  // The catalogue rounds: 480p is 864x496 (1.742), 720p is exactly 1280x720.
  const SIZES=[
    {label:'480p · 16:9',width:864,height:496},
    {label:'480p · 9:16',width:496,height:864},
    {label:'480p · 1:1',width:640,height:640},
    {label:'480p · 3:4',width:560,height:752},
    {label:'720p · 16:9',width:1280,height:720},
    {label:'720p · 9:16',width:720,height:1280},
  ];
  const candidates=candidatesFromSizes(SIZES);

  it('keeps 480p when a 16:9 reference arrives, instead of buying 720p',()=>{
    // The whole report: 720p is a closer numeric match only because the vendor
    // rounded 480p, and taking it is a 2.25x jump on a rate the reader chose.
    const matched=closestAspectCandidate(1920,1080,candidates,'480p · 16:9');
    expect(matched?.value).toBe('480p · 16:9');
  });

  it('still corrects a genuinely wrong shape',()=>{
    const matched=closestAspectCandidate(1080,1920,candidates,'480p · 16:9');
    expect(matched?.value).toBe('480p · 9:16');
  });

  it('changes the shape without also changing the resolution',()=>{
    // A portrait reference needs a portrait row; it does not need a dearer one.
    const matched=closestAspectCandidate(496,864,candidates,'480p · 16:9');
    expect(matched?.value).toBe('480p · 9:16');
  });

  it('matches on ratio alone when nothing has been chosen yet',()=>{
    expect(closestAspectCandidate(1920,1080,candidates)?.value).toBe('720p · 16:9');
  });

  it('ignores a current value the model does not offer',()=>{
    // Switching model republishes the whitelist; a stale label must not stick.
    expect(closestAspectCandidate(1920,1080,candidates,'4K · 16:9')?.value).toBe('720p · 16:9');
  });

  it('leaves a ratio-only control alone once it already fits',()=>{
    const ratios=candidatesFromValues(['16:9','9:16','1:1','4:3']);
    expect(closestAspectCandidate(1920,1080,ratios,'16:9')?.value).toBe('16:9');
    expect(closestAspectCandidate(1080,1920,ratios,'16:9')?.value).toBe('9:16');
  });
});

/** UX audit M5: Veo's 16:9 / 9:16 silently reframed a square reference. */
describe('describeAspectMismatch', () => {
  const veo = candidatesFromValues(['16:9', '9:16']);
  const kling = candidatesFromValues(['16:9', '1:1', '9:16']);

  it('names a shape the model cannot output', () => {
    expect(describeAspectMismatch({ width: 1024, height: 1024 }, veo, '16:9')).toBe(
      'Your reference is 1:1, and this model has no 1:1 output. It will be reframed to 16:9.'
    );
  });

  it('points at the control when a matching shape exists but is not selected', () => {
    expect(describeAspectMismatch({ width: 1024, height: 1024 }, kling, '16:9')).toBe(
      'Your reference is 1:1 but the output is set to 16:9, so it will be reframed.'
    );
  });

  it('stays quiet when the shapes agree within vendor rounding', () => {
    expect(describeAspectMismatch({ width: 864, height: 496 }, veo, '16:9')).toBeNull();
  });

  it('stays quiet before the reference is measured or without a ratio control', () => {
    expect(describeAspectMismatch({}, veo, '16:9')).toBeNull();
    expect(describeAspectMismatch({ width: 1024, height: 1024 }, veo, undefined)).toBeNull();
    expect(describeAspectMismatch({ width: 1024, height: 1024 }, [], 'auto')).toBeNull();
  });

  it('describes an unnamed shape by its pixels', () => {
    expect(describeAspectMismatch({ width: 1000, height: 370 }, veo, '16:9')).toMatch(/^Your reference is 1000×370,/);
  });
});
