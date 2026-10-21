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
