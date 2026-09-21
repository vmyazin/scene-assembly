// tests/engines/gemini-video.test.ts
import { describe, expect, it } from 'vitest';

import { geminiGenerateVideo } from '../../lib/engines/gemini';

describe('geminiGenerateVideo stub', () => {
  it('acknowledges a still frame on the image-to-video path', async () => {
    await expect(
      geminiGenerateVideo({
        apiKey: 'test',
        prompt: 'Animate the still',
        image: 'abc123',
        model: 'veo-3.1-lite-generate-preview',
      })
    ).rejects.toThrow(/image-to-video is not wired yet \(still frame received\)/);
  });

  it('does not claim a still was received on the text-to-video path', async () => {
    await expect(
      geminiGenerateVideo({
        apiKey: 'test',
        prompt: 'A moonlit ocean',
      })
    ).rejects.toThrow(/text-to-video is not wired yet/);
    await expect(
      geminiGenerateVideo({
        apiKey: 'test',
        prompt: 'A moonlit ocean',
      })
    ).rejects.not.toThrow(/still frame received/);
  });
});
