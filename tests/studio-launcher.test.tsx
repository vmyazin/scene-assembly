import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudioLauncher from '../components/StudioLauncher';
import { FEATURES } from '../types';
import { VIDEO_DIRECTIONS } from '../lib/video/directions';

vi.mock('../components/RecentCreations', () => ({ default: () => <section>Recent creations</section> }));
afterEach(cleanup);

describe('B2 home launcher', () => {
  it('keeps every image and video mode reachable without silently changing the requested direction', () => {
    const onSelectImage = vi.fn(), onSelectVideo = vi.fn();
    render(<StudioLauncher onSelectImage={onSelectImage} onSelectVideo={onSelectVideo} />);
    const image = screen.getByRole('region', { name: 'Image 6 modes' });
    const video = screen.getByRole('region', { name: 'Video 5 modes' });
    const images = within(image).getAllByRole('button');
    expect(images).toHaveLength(FEATURES.length);
    images.forEach((button, index) => { fireEvent.click(button); expect(onSelectImage).toHaveBeenLastCalledWith(FEATURES[index]); });
    expect(within(video).getAllByRole('button')).toHaveLength(VIDEO_DIRECTIONS.length);
    VIDEO_DIRECTIONS.forEach(mode => { fireEvent.click(within(video).getByRole('button', { name: mode.label })); expect(onSelectVideo).toHaveBeenLastCalledWith(mode.id); });
    expect(onSelectVideo).toHaveBeenCalledTimes(5);
  });
});
