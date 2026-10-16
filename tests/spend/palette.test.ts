import { describe, expect, it } from 'vitest';

import { PROVIDER_FILL, PROVIDER_ORDER } from '@/lib/spend/palette';

/** L4: Gemini and PiAPI shared one cyan, told apart only by opacity. */
describe('spend palette', () => {
  it('gives every provider its own colour', () => {
    const colours = PROVIDER_ORDER.map((provider) => PROVIDER_FILL[provider].color.toLowerCase());
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('draws every fill at full strength, so a legend dot matches its bar', () => {
    expect(PROVIDER_ORDER.every((provider) => PROVIDER_FILL[provider].opacity === 1)).toBe(true);
  });
});
