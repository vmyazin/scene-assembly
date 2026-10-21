import { describe, expect, it } from 'vitest';
import { featureImagePrompt } from '../../lib/image/feature-prompt';

describe('thumbnail reference roles', () => {
  it('names no image when none was uploaded', () => {
    expect(featureImagePrompt('social-media-thumbnail', 'a chef', 0)).not.toContain('Image 1');
  });

  it('makes a lone upload the subject and mentions no others', () => {
    const prompt = featureImagePrompt('social-media-thumbnail', 'a chef', 1);

    expect(prompt).toContain('Reference image:\n- Image 1 is the main subject.');
    expect(prompt).not.toContain('Image 2');
  });

  it('casts a second upload as a supporting element', () => {
    expect(featureImagePrompt('social-media-thumbnail', 'a chef', 2)).toContain('- Image 2 is a supporting element');
  });

  it('ranges the supporting uploads when there are several', () => {
    const prompt = featureImagePrompt('social-media-thumbnail', 'a chef', 4);

    expect(prompt).toContain('Reference images:\n- Image 1 is the main subject.');
    expect(prompt).toContain('- Images 2–4 are supporting elements');
    expect(prompt).toContain("never merge them into the subject's face");
  });
});

describe('session master prompts', () => {
  it('sends the typed prompt as written in a mode with no built-in wrapper', () => {
    expect(featureImagePrompt('text-to-image', 'a red fox', 0)).toBe('a red fox');
  });

  it('wraps the prompt in an edited template', () => {
    const master = { template: 'Studio lighting. {prompt}. 35mm film.' };

    expect(featureImagePrompt('text-to-image', 'a red fox', 0, master)).toBe('Studio lighting. a red fox. 35mm film.');
  });

  it('keeps reference roles available to an edited thumbnail template', () => {
    const prompt = featureImagePrompt('social-media-thumbnail', 'a chef', 2, { template: '{prompt}{references}' });

    expect(prompt).toContain('a chef\nReference images:');
    expect(prompt).not.toContain('VIRAL');
  });

  it('sends the empty-prompt text only when nothing was typed', () => {
    const master = { template: '{prompt}', whenEmpty: 'Make it watercolor.' };

    expect(featureImagePrompt('style-transfer', '', 2, master)).toBe('Make it watercolor.');
    expect(featureImagePrompt('style-transfer', 'oil paint', 2, master)).toBe('oil paint');
  });

  it('does not read replacement patterns in the typed prompt', () => {
    expect(featureImagePrompt('text-to-image', 'cost $& more', 0, { template: '[{prompt}]' })).toBe('[cost $& more]');
  });
});
