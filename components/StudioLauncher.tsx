'use client';

import Image, { type StaticImageData } from 'next/image';
import { VIDEO_DIRECTIONS } from '@/lib/video/directions';
import type { ProviderMode } from '@/lib/providers/types';
import { FEATURES, type Feature } from '@/types';
import RecentCreations from '@/components/RecentCreations';

const IMAGE_LABELS: Record<string, string> = {
  'text-to-image': 'Create image',
  'image-editing': 'Edit image',
  'multi-image-compose': 'Combine images',
  'search-grounding': 'Search visualization',
  'social-media-thumbnail': 'Create thumbnail',
  'style-transfer': 'Transfer style',
};

function requirement(feature: Feature) {
  if (feature.id === 'search-grounding') return 'Live Google Search';
  if (feature.maxImages) return feature.requiresMultipleImages && feature.maxImages === 2
    ? '2 images' : `Up to ${feature.maxImages} images`;
  return feature.requiresImage ? 'Needs an image' : 'Prompt only';
}

function LauncherTile({ title, detail, thumbnail, onClick }: {
  title: string; detail: string; thumbnail: string | StaticImageData; onClick: () => void;
}) {
  return <button type="button" onClick={onClick} aria-label={title}
    className="group flex min-h-[124px] cursor-pointer flex-col overflow-hidden rounded-lg border border-[var(--border-input)] bg-[var(--background-elevated)] text-left transition-colors hover:border-[var(--border-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--neon-cyan)]">
    <div className="relative aspect-video w-full shrink-0 overflow-hidden">
      {typeof thumbnail === 'string' ? (
        // eslint-disable-next-line @next/next/no-img-element -- existing public catalog illustrations
        <img src={thumbnail} alt="" className="h-full w-full object-cover" />
      ) : <Image src={thumbnail} alt="" fill sizes="(min-width: 640px) 25vw, 50vw" className="object-cover" />}
    </div>
    <span className="block px-2 py-2 text-xs font-medium leading-snug text-[var(--foreground)]">
      {title}<span className="mt-1 block text-[0.625rem] font-normal text-[var(--foreground-muted)]">{detail}</span>
    </span>
  </button>;
}

export default function StudioLauncher({ onSelectImage, onSelectVideo }: {
  onSelectImage: (feature: Feature) => void; onSelectVideo: (mode: ProviderMode) => void;
}) {
  return <div className="space-y-6" data-testid="studio-launcher">
    <div className="space-y-2 py-0 text-center sm:space-y-2.5 sm:py-1">
      <h2 className="display px-4 text-2xl font-semibold text-balance sm:text-3xl md:text-4xl">
        <span className="gradient-text home-hero-lava">Make images. Create motion.</span>
      </h2>
      <p className="mx-auto max-w-3xl px-4 text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)] sm:text-sm">Generate, edit, and combine images and video with the right AI model for the job.</p>
    </div>
    {/* Both families keep the same columns, thumbnail sizes and label scale.
        They stack together on phones rather than shrinking eleven actions. */}
    <div className="grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 sm:gap-[18px]">
      <section aria-labelledby="home-image-tools" className="rounded-xl border border-[var(--brand-accent)]/10 bg-[var(--brand-accent)]/[0.025] p-3 sm:p-4">
        <h3 id="home-image-tools" className="mb-3 flex items-center justify-between border-b border-[var(--border-input)] pb-2.5 text-sm font-semibold text-[var(--brand-accent)]">
          Image <span className="text-[0.625rem] font-normal text-[var(--foreground-muted)]">{FEATURES.length} modes</span>
        </h3>
        <div className="grid grid-cols-2 gap-2">{FEATURES.map(feature => <LauncherTile key={feature.id}
          title={IMAGE_LABELS[feature.id] ?? feature.name} detail={requirement(feature)} thumbnail={feature.thumbnail} onClick={() => onSelectImage(feature)} />)}</div>
      </section>
      <section aria-labelledby="home-video-tools" className="rounded-xl border border-[var(--neon-purple)]/15 bg-[var(--neon-purple)]/[0.035] p-3 sm:p-4">
        <h3 id="home-video-tools" className="mb-3 flex items-center justify-between border-b border-[var(--border-input)] pb-2.5 text-sm font-semibold text-violet-300">
          Video <span className="text-[0.625rem] font-normal text-[var(--foreground-muted)]">{VIDEO_DIRECTIONS.length} modes</span>
        </h3>
        <div className="grid grid-cols-2 gap-2">{VIDEO_DIRECTIONS.map(mode => <LauncherTile key={mode.id}
          title={mode.label} detail={mode.requires} thumbnail={mode.thumbnail} onClick={() => onSelectVideo(mode.id)} />)}</div>
      </section>
    </div>
    <RecentCreations />
  </div>;
}
