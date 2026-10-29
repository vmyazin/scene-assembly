import { ImagePlus, Images, ScanFace, Type } from 'lucide-react';
import type { VideoDirection } from '@/components/VideoDirectionSelector';
import catalogThumbnail from '@/public/thumbnails/neon-cat-catalog-isometric.jpg';
import leapThumbnail from '@/public/thumbnails/neon-cat-leap-cyan-magenta.jpg';
import bookendThumbnail from '@/public/thumbnails/neon-cat-jump-dashboard.jpg';
import characterThumbnail from '@/public/thumbnails/photorealistic_example.png';

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
  },
  {
    id: 'image',
    label: 'Image to video',
    blurb: 'Put a still frame into motion',
    requires: 'Needs an image',
    icon: ImagePlus,
    thumbnail: leapThumbnail,
  },
  {
    id: 'frames',
    label: 'First & last frame',
    blurb: 'Fill the motion between two stills',
    requires: 'Needs two images',
    icon: Images,
    thumbnail: bookendThumbnail,
    needsProviderSupport: true,
  },
  {id: 'edit', thumbnail: '/thumbnails/edit-video.jpg', label: 'Edit video', blurb: 'Replace a character, setting, or style', requires: 'Needs a video', icon: ScanFace, needsProviderSupport: true},
  {
    id: 'reference',
    label: 'Character references',
    blurb: 'Carry one character into a new scene',
    requires: 'Needs character views',
    icon: ScanFace,
    thumbnail: characterThumbnail,
    needsProviderSupport: true,
  },
];
