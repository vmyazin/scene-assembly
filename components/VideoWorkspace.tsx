// components/VideoWorkspace.tsx
'use client';

import { useEffect } from 'react';
import FalGenerationWorkspace from '@/components/FalGenerationWorkspace';
import GeminiVideoWorkspace from '@/components/GeminiVideoWorkspace';
import KieGenerationWorkspace from '@/components/KieGenerationWorkspace';
import VideoDirectionSelector from '@/components/VideoDirectionSelector';
import ProviderSelector, { VIDEO_PROVIDERS, type VideoProvider } from '@/components/ProviderSelector';
import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import { PROVIDER_LABELS, type EngineId } from '@/lib/engines/registry';
import { modelsForFalMode } from '@/lib/fal/catalog';
import { modelsForKieMode } from '@/lib/kie/catalog';
import type { KieInputMode } from '@/lib/kie/types';
import { modelsFor } from '@/lib/providers/catalog';
import { isProviderId } from '@/lib/providers';
import type { ProviderId, ProviderMode } from '@/lib/providers/types';

import type { FalInputMode } from '@/lib/fal/types';
import { useAppStore } from '@/store/useAppStore';
import { VIDEO_DIRECTIONS as MODES } from '@/lib/video/directions';
interface VideoWorkspaceProps {
  inputMode: ProviderMode;
  onInputModeChange: (mode: ProviderMode) => void;
  onExit: () => void;
  onOpenConnections: (provider?: EngineId) => void;
}

// Aggregators advertise modes in their catalogs; the dedicated workspaces expose
// only their implemented input modes, so unsupported forms are never mounted.
function supportsMode(engine: VideoProvider, mode: ProviderMode): boolean {
  // Fal is not a catalog ProviderId. Edit is a real fal mode; folding it into
  // image posted the clip to image-to-video.
  if (engine === 'fal' && mode === 'edit') return modelsForFalMode('video', 'edit').length > 0;
  if (engine === 'kie' && mode === 'edit') return modelsForKieMode('video', 'edit').length > 0;
  if (isProviderId(engine)) return modelsFor(engine, 'video').some(model => model.modes.includes(mode));
  return mode === 'text' || mode === 'image' || (engine === 'fal' && mode === 'frames');
}

export default function VideoWorkspace({
  inputMode,
  onInputModeChange,
  onExit,
  onOpenConnections,
}: VideoWorkspaceProps) {
  const storedEngine = useAppStore((state) => state.videoEngine);
  const setVideoEngine = useAppStore((state) => state.setVideoEngine);
  const availableEngines = VIDEO_PROVIDERS.filter(provider => supportsMode(provider.id, inputMode));
  const videoEngine = supportsMode(storedEngine, inputMode) ? storedEngine : availableEngines[0]?.id;
  const disabledProviders = VIDEO_PROVIDERS.filter(provider => !supportsMode(provider.id, inputMode)).map(provider => provider.id);
  // Resolve before rendering as well as persisting: deep links must never mount
  // an unsupported workspace for a frame while the stored engine catches up.
  useEffect(() => {
    if (videoEngine && videoEngine !== storedEngine) setVideoEngine(videoEngine);
  }, [videoEngine, storedEngine, setVideoEngine]);
  const isGemini = videoEngine === 'gemini';
  const isFal = videoEngine === 'fal';
  const activeProvider: ProviderId | null =
    videoEngine === 'runware' || videoEngine === 'atlas' || videoEngine === 'comet' || videoEngine === 'piapi'
      ? videoEngine
      : null;
  const activeMode = inputMode;
  // Edit stays edit on fal. Folding it into image mode hid the source video
  // and posted the clip to an image-to-video endpoint.
  const falMode: FalInputMode = activeMode === 'edit' ? 'edit' : activeMode === 'frames' ? 'frames' : activeMode === 'text' ? 'text' : 'image';
  const kieMode: KieInputMode = activeMode === 'edit' ? 'edit' : activeMode === 'text' ? 'text' : 'image';
  
  // Gemini supports only text and image modes
  const geminiMode: 'text' | 'image' = activeMode === 'text' ? 'text' : 'image';

  const selectEngine = (engine: VideoProvider) => {
    if (!supportsMode(engine, inputMode)) return;
    setVideoEngine(engine);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Hero — same shape as the landing hero: one headline line, then the
          blurb. No eyebrow; the nav's Image/Video toggle already says where
          you are. */}
      <div className="space-y-2 py-0 text-center sm:space-y-2.5 sm:py-1">
        <h2 className="display px-4 text-2xl font-semibold text-balance sm:text-3xl md:text-4xl">
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
        modes={MODES}
        value={activeMode}
        onChange={onInputModeChange}
      />

      <ProviderSelector value={videoEngine ?? storedEngine} onChange={selectEngine} disabledProviders={disabledProviders} />

      {!videoEngine ? (
        <p className="text-sm text-[var(--foreground-muted)]">No provider currently supports this mode.</p>
      ) : activeProvider ? (
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
          key={`fal-${falMode}`}
          inputMode={falMode}
          onBack={onExit}
          onOpenConnections={onOpenConnections}
          onContinueFromFrame={() => onInputModeChange('image')}
        />
      ) : (
        <KieGenerationWorkspace
          mediaType="video"
          inputMode={kieMode}
          exampleFeatureId={kieMode === 'edit' ? 'edit-video' : kieMode === 'text' ? 'text-to-video' : 'image-to-video'}
          onBack={onExit}
          onOpenConnections={onOpenConnections}
          onContinueFromFrame={() => onInputModeChange('image')}
        />
      )}
    </div>
  );
}
