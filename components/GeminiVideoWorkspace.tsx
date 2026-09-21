// components/GeminiVideoWorkspace.tsx
'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import AutoExpandingPrompt from '@/components/AutoExpandingPrompt';
import ConnectionGate, { isGated } from '@/components/ConnectionGate';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';
import PromptPanel from '@/components/PromptPanel';
import ProviderLogo from '@/components/ProviderLogo';
import { GEMINI_VIDEO_MODELS } from '@/lib/engines/gemini-video-catalog';
import { geminiVideoCost, geminiVideoRateLabel } from '@/lib/spend/rates';
import { useAppStore } from '@/store/useAppStore';
import type { EngineId } from '@/lib/engines/registry';

interface GeminiVideoWorkspaceProps {
  inputMode: 'text' | 'image';
  onBack: () => void;
  onOpenConnections: (provider?: EngineId) => void;
}

export default function GeminiVideoWorkspace({
  inputMode,
  onBack,
  onOpenConnections,
}: GeminiVideoWorkspaceProps) {
  const apiKey = useAppStore((state) => state.apiKey);
  const geminiVideoModel = useAppStore((state) => state.geminiVideoModel);
  
  const [prompt, setPrompt] = useState('');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [duration, setDuration] = useState<4 | 6 | 8>(8);

  const needsKey = !apiKey;
  const currentModel = GEMINI_VIDEO_MODELS.find((m) => m.id === geminiVideoModel) || GEMINI_VIDEO_MODELS[0];
  const costEstimate = geminiVideoCost(geminiVideoModel, resolution, duration);
  const rateLabel = geminiVideoRateLabel(geminiVideoModel, resolution);

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast.error('Enter a prompt for your video');
      return;
    }
    toast.info('Gemini video generation coming soon! For now, try the other providers.');
  };

  const setup = (
    <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background-elevated)] p-4">
      <div className="flex items-center gap-2">
        <ProviderLogo provider="gemini" size={20} />
        <h3 className="font-semibold">Gemini · Veo 3.1 Lite</h3>
      </div>
      
      <div className="space-y-3">
        <div className="text-sm text-[var(--foreground-muted)]">
          {currentModel.note}
        </div>

        <div className="grid gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Resolution</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              {currentModel.resolutions.map((res) => (
                <option key={res} value={res}>{res}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Duration</span>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) as 4 | 6 | 8)}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              {currentModel.durations.map((dur) => (
                <option key={dur} value={dur}>{dur}s</option>
              ))}
            </select>
          </label>
        </div>

        {costEstimate > 0 && (
          <div className="text-sm text-[var(--foreground-muted)]">
            Estimated: ${costEstimate.toFixed(3)} {rateLabel && `(${rateLabel})`}
          </div>
        )}
      </div>
    </div>
  );

  const actions = (
    <div className="space-y-3">
      <button
        onClick={handleGenerate}
        disabled={needsKey}
        className="w-full rounded-lg bg-[var(--neon-purple)] px-4 py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Sparkles className="inline-block mr-2 h-4 w-4" />
        Generate video
      </button>

      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-600">
        <strong>Note:</strong> Gemini video generation is now available in the catalog! 
        Full async polling support coming in the next update. For now, use other providers for video generation.
      </div>
    </div>
  );

  return (
    <ConnectionGate
      provider="gemini"
      label="Gemini"
      storage="browser"
      needsKey={needsKey}
      onConnect={() => onOpenConnections('gemini')}
    >
      <GenerationWorkspaceLayout
        setup={setup}
        prompt={
          <PromptPanel paused={needsKey}>
            <AutoExpandingPrompt
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Describe the video you want to create${inputMode === 'image' ? ' (the image will be animated)' : ''}...`}
            />
          </PromptPanel>
        }
        actions={actions}
        results={null}
      />
    </ConnectionGate>
  );
}
