// components/VideoWorkspace.tsx
'use client';

import { ImagePlus, MoveRight, ScanFace, Type } from 'lucide-react';
import FalGenerationWorkspace from '@/components/FalGenerationWorkspace';
import GeminiVideoWorkspace from '@/components/GeminiVideoWorkspace';
import KieGenerationWorkspace from '@/components/KieGenerationWorkspace';
import VideoDirectionSelector, { type VideoDirection } from '@/components/VideoDirectionSelector';
import ProviderSelector, { type VideoProvider } from '@/components/ProviderSelector';
import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import type { EngineId } from '@/lib/engines/registry';
import { modelsFor } from '@/lib/providers/catalog';
import { isProviderId } from '@/lib/providers';
import type { ProviderId, ProviderMode } from '@/lib/providers/types';

/** Display names for the aggregator providers in the video workspace header. */
const PROVIDER_LABELS: Record<ProviderId, string> = {
  runware: 'Runware',
  atlas: 'Atlas Cloud',
  comet: 'CometAPI',
  piapi: 'PiAPI',
};
import type { FalInputMode } from '@/lib/fal/types';
import { useAppStore } from '@/store/useAppStore';
import catalogThumbnail from '@/public/thumbnails/neon-cat-catalog-isometric.jpg';
import leapThumbnail from '@/public/thumbnails/neon-cat-leap-cyan-magenta.jpg';
import bookendThumbnail from '@/public/thumbnails/neon-cat-jump-dashboard.jpg';
import characterThumbnail from '@/public/thumbnails/photorealistic_example.png';

interface VideoWorkspaceProps {
  inputMode: ProviderMode;
  onInputModeChange: (mode: ProviderMode) => void;
  onExit: () => void;
  onOpenConnections: (provider?: EngineId) => void;
}

// The selector and its preview share these fixtures; provider capabilities below
// still decide which directions can be offered before a submission is possible.
const MODES: readonly VideoDirection[] = [
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
    icon: MoveRight,
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

export default function VideoWorkspace({
  inputMode,
  onInputModeChange,
  onExit,
  onOpenConnections,
}: VideoWorkspaceProps) {
  const videoEngine = useAppStore((state) => state.videoEngine);
  const setVideoEngine = useAppStore((state) => state.setVideoEngine);
  const isGemini = videoEngine === 'gemini';
  const isFal = videoEngine === 'fal';
  const activeProvider: ProviderId | null =
    videoEngine === 'runware' || videoEngine === 'atlas' || videoEngine === 'comet' || videoEngine === 'piapi'
      ? videoEngine
      : null;
  /**
   * Who can bookend a clip between two stills: fal, and the Runware models
   * whose `frameImages` takes two — the vendor reads a pair as first and last.
   * Kie has no such model, so the card stays hidden there rather than offering
   * a mode that would fail at submit.
   */
  const supportsFrames = (engine: VideoProvider) =>
    engine === 'fal' ||
    (isProviderId(engine) && modelsFor(engine, 'video').some((model) => model.modes.includes('frames')));

  const supportsReference = (engine: VideoProvider) =>
    isProviderId(engine) &&
    modelsFor(engine, 'video').some((model) => model.modes.includes('reference'));

  const supportsMode = (engine: VideoProvider, mode: ProviderMode) =>
    mode === 'edit' ? isProviderId(engine) && modelsFor(engine, 'video').some(model => model.modes.includes('edit')) : mode === 'frames' ? supportsFrames(engine) : mode === 'reference' ? supportsReference(engine) : true;

  const framesProviders = supportsFrames(videoEngine);
  const referenceProviders = supportsReference(videoEngine);
  const modes = MODES.filter((mode) => {
    if (!mode.needsProviderSupport) return true;
    return mode.id === 'edit' ? supportsMode(videoEngine, 'edit') : mode.id === 'frames' ? framesProviders : referenceProviders;
  });
  // A deep link lands on the closest flow the current provider does have,
  // rather than passing a provider-only mode into fal or Kie.
  const activeMode: ProviderMode = supportsMode(videoEngine, inputMode) ? inputMode : 'image';
  const legacyMode: FalInputMode = activeMode === 'reference' || activeMode === 'edit' ? 'image' : activeMode;
  
  // Gemini supports only text and image modes
  const geminiMode: 'text' | 'image' = activeMode === 'text' ? 'text' : 'image';

  const selectEngine = (engine: VideoProvider) => {
    if (!supportsMode(engine, inputMode)) onInputModeChange('image');
    setVideoEngine(engine);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Hero — same shape as the landing hero: one headline line, then the
          blurb. No eyebrow; the nav's Image/Video toggle already says where
          you are. */}
      <div className="space-y-2 py-0 text-center sm:space-y-2.5 sm:py-1">
        <h2 className="display px-4 text-2xl font-semibold leading-[1.1] text-balance sm:text-3xl md:text-4xl">
          <span className="gradient-text">Create a video</span>{' '}
          <span className="text-[var(--foreground)]">from an idea or image</span>
        </h2>

        {/* States what this tab makes, in the plainest terms. The provider pills
            that used to sit beside it are gone: the selector below names the same
            two providers, and is the control rather than a label. */}
        <div className="flex justify-center px-4">
          <p className="max-w-xl text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)] sm:text-sm">
            Turn a prompt or a still image into a short video clip.
          </p>
        </div>
      </div>

      <VideoDirectionSelector
        key={videoEngine}
        modes={modes}
        value={activeMode}
        onChange={onInputModeChange}
      />

      <ProviderSelector value={videoEngine} onChange={selectEngine} />

      {activeProvider ? (
        <ProviderVideoWorkspace
          key={`${activeProvider}-${activeMode}`}
          provider={activeProvider}
          label={PROVIDER_LABELS[activeProvider]}
          inputMode={activeMode}
          onBack={onExit}
          onOpenConnections={onOpenConnections}
          onContinueFromFrame={() => onInputModeChange('image')}
        />
      ) : isGemini ? (
        <GeminiVideoWorkspace
          key={`gemini-${geminiMode}`}
          inputMode={geminiMode}
          onBack={onExit}
          onOpenConnections={onOpenConnections}
          onContinueFromFrame={() => onInputModeChange('image')}
        />
      ) : isFal ? (
        <FalGenerationWorkspace
          key={`fal-${legacyMode}`}
          inputMode={legacyMode}
          onBack={onExit}
          onOpenConnections={onOpenConnections}
          onContinueFromFrame={() => onInputModeChange('image')}
        />
      ) : (
        <KieGenerationWorkspace
          mediaType="video"
          inputMode={legacyMode === 'text' ? 'text' : 'image'}
          exampleFeatureId={legacyMode === 'text' ? 'text-to-video' : 'image-to-video'}
          onBack={onExit}
          onOpenConnections={onOpenConnections}
          onContinueFromFrame={() => onInputModeChange('image')}
        />
      )}
    </div>
  );
}
