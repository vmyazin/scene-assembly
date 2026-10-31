import { ImagePlus, Images, ScanFace, Type } from 'lucide-react';
import type { VideoDirection } from '@/components/VideoDirectionSelector';
import catalogThumbnail from '@/public/thumbnails/neon-cat-catalog-isometric.jpg';
import leapThumbnail from '@/public/thumbnails/neon-cat-leap-cyan-magenta.jpg';
import bookendThumbnail from '@/public/thumbnails/neon-cat-jump-dashboard.jpg';
import characterThumbnail from '@/public/thumbnails/photorealistic_example.png';
import catalogLoopPoster from '@/public/thumbnails/neon-cat-catalog-loop-poster.jpg';
import leapLoopPoster from '@/public/thumbnails/neon-cat-leap-loop-poster.jpg';
import bookendLoopPoster from '@/public/thumbnails/neon-cat-bookend-loop-poster.jpg';
import editLoopPoster from '@/public/thumbnails/edit-video-loop-poster.jpg';
import characterLoopPoster from '@/public/thumbnails/character-references-loop-poster.jpg';

// The selector and its preview share these fixtures; provider capabilities below
// determine engine availability without hiding any direction.
export const VIDEO_DIRECTIONS: readonly VideoDirection[] = [
  {
    id: 'text',
    label: 'Text to video',
    blurb: 'Start from a written prompt',
    requires: 'Prompt only',
    icon: Type,
    thumbnail: catalogThumbnail,
    loop: { src: '/thumbnails/neon-cat-catalog-loop.mp4', poster: catalogLoopPoster },
  },
  {
    id: 'image',
    label: 'Image to video',
    blurb: 'Put a still frame into motion',
    requires: 'Needs an image',
    icon: ImagePlus,
    thumbnail: leapThumbnail,
    loop: { src: '/thumbnails/neon-cat-leap-loop.mp4', poster: leapLoopPoster },
  },
  {
    id: 'frames',
    label: 'First & last frame',
    blurb: 'Fill the motion between two stills',
    requires: 'Needs two images',
    icon: Images,
    thumbnail: bookendThumbnail,
    loop: { src: '/thumbnails/neon-cat-bookend-loop.mp4', poster: bookendLoopPoster },
    needsProviderSupport: true,
  },
  {id: 'edit', thumbnail: '/thumbnails/edit-video.jpg', loop: { src: '/thumbnails/edit-video-loop.mp4', poster: editLoopPoster }, label: 'Edit video', blurb: 'Replace a character, setting, or style', requires: 'Needs a video', icon: ScanFace, needsProviderSupport: true},
  {
    id: 'reference',
    label: 'Character references',
    blurb: 'Carry one character into a new scene',
    requires: 'Needs character views',
    icon: ScanFace,
    thumbnail: characterThumbnail,
    loop: { src: '/thumbnails/character-references-loop.mp4', poster: characterLoopPoster },
    needsProviderSupport: true,
  },
];
