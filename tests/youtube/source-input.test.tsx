import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VideoSourceInput from '@/components/VideoSourceInput';

vi.mock('@/lib/youtube/iframe-api', () => ({ createClipPlayer: vi.fn() }));
const capability = { minSeconds: 4, maxSeconds: 30, sizes: [], maxImages: 5, rate: { per: 'second' as const, usd: 0.1 } };
const file = new File(['mp4'], 'youtube-aqz-KE-bpKQ-62s.mp4', { type: 'video/mp4' });

describe('VideoSourceInput', () => {
  it('offers From YouTube only when given a target', () => {
    const { rerender } = render(<VideoSourceInput capability={capability} source={null} onChange={() => {}} disabled={false} />);
    expect(screen.queryByRole('button', { name: /From YouTube/ })).toBeNull();
    rerender(<VideoSourceInput capability={capability} source={null} onChange={() => {}} disabled={false} youtube={{ provider: 'runware', modelId: 'bytedance:seedance@2.5', modelLabel: 'Seedance 2.5' }} />);
    expect(screen.getByRole('button', { name: /From YouTube/ })).toBeEnabled();
  });
  it('labels an imported source with its origin and range', () => {
    render(<VideoSourceInput capability={capability} disabled={false} onChange={() => {}}
      source={{ file, epoch: 0, width: 1280, height: 720, durationSeconds: 12.4, origin: { videoId: 'aqz-KE-bpKQ', startSeconds: 62, endSeconds: 74.4 } }} />);
    expect(screen.getByRole('link', { name: 'From YouTube · 1:02.0–1:14.4' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=62s');
  });
});
