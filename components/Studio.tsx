// components/Studio.tsx
'use client';

import { useEffect, useLayoutEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useQueryState } from 'nuqs';
import { motion, AnimatePresence } from 'framer-motion';
import StudioLauncher from '@/components/StudioLauncher';
import FeatureSelector from '@/components/FeatureSelector';
import ProviderLogo from '@/components/ProviderLogo';
import { brand } from '@/lib/brand';
import StudioHeader from '@/components/StudioHeader';
import VideoWorkspace from '@/components/VideoWorkspace';
import { Feature, FEATURES } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { PROVIDER_LABELS } from '@/lib/engines/registry';
import { useConnectionsDialog } from '@/store/useConnectionsDialog';

// Lazy-load the heavy generation workspace so the landing bundle stays light.
const GenerationInterface = dynamic(() => import('@/components/GenerationInterface'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-16">
      <div className="loading-spinner" />
    </div>
  ),
});

/**
 * The interactive studio: header, workspace switch, and the picker/generation
 * column between them.
 *
 * It stops at `</main>` on purpose. Everything below — the crawlable intro and
 * the footer — is server-rendered from `app/page.tsx`, because this component
 * reads the URL through nuqs and therefore suspends during a static prerender:
 * anything inside its Suspense boundary is absent from the HTML a crawler gets.
 * See `components/marketing/LandingIntro.tsx`.
 */
export default function Studio() {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // API key lives in the persisted Zustand store (single source of truth).
  const apiKey = useAppStore((s) => s.apiKey);

  // View is driven by the URL (?feature=<id>) so it deep-links, supports
  // browser back/forward, and survives a refresh.
  const router = useRouter();
  const [featureId, setFeatureId] = useQueryState('feature', { history: 'push' });
  const [workspace, setWorkspace] = useQueryState('workspace', { history: 'push' });
  const [videoMode, setVideoMode] = useQueryState('videoMode', { history: 'push' });
  const activeWorkspace = workspace === 'video' ? 'video' : 'image';
  const activeVideoMode =
    videoMode === 'image' || videoMode === 'frames' || videoMode === 'reference' || videoMode === 'edit'
      ? videoMode
      : 'text';
  const selectedFeature: Feature | null =
    FEATURES.find((f) => f.id === featureId) ?? null;
  const selectFeature = (feature: Feature) => setFeatureId(feature.id);
  const clearFeature = () => {
    void setFeatureId(null);
    void setWorkspace('image');
  };
  const isHome = activeWorkspace === 'image' && !selectedFeature && workspace !== 'image';
  // The timeline used to widen this column to the account console's 110rem,
  // because a horizontal track beside the export panel is the widest thing in
  // the app. It runs on /timeline now with a shell of its own, so the studio is
  // back to one width.
  const columnWidth = 'max-w-7xl';

  const selectWorkspace = (nextWorkspace: 'image' | 'video') => {
    if (nextWorkspace === 'image') {
      void setFeatureId(null);
      void setWorkspace('image');
      return;
    }
    void setFeatureId(null);
    void setWorkspace(nextWorkspace);
  };

  /**
   * `?workspace=timeline` was how the editor was reached before it had a route,
   * so bookmarks and any link already in the wild still point here. Sent on
   * rather than 404'd or silently shown the image workspace, and `replace` so
   * Back does not bounce between the two.
   */
  useEffect(() => {
    if (workspace === 'timeline') router.replace('/timeline');
  }, [workspace, router]);
  /**
   * Send a finished image on as the opening frame of a clip. The frame itself
   * travels through the seed store; this only moves the user to the workspace
   * that claims it, which is state only this component owns.
   */
  const startVideoFromFirstFrame = () => {
    void setFeatureId(null);
    void setWorkspace('video');
    void setVideoMode('image');
  };
  /**
   * Send a finished image on to editing. The image travels through the draft's
   * references; this only opens the mode that shows them.
   */
  const startEditingFromResult = () => {
    void setWorkspace(null);
    void setFeatureId('image-editing');
  };
  /**
   * A workspace missing a key opens the connections dialog focused on its own
   * provider. The dialog itself belongs to `StudioHeader` now, so the request
   * travels through the store rather than down through props.
   */
  const openConnections = useConnectionsDialog((state) => state.openConnections);

  return (
    <>
      <StudioHeader
        active={isHome ? 'home' : activeWorkspace}
        onSelectWorkspace={selectWorkspace}
        columnWidth={columnWidth}
      />

      {/* Main Content */}
      <main className={`relative z-10 w-full ${columnWidth} mx-auto px-6 sm:px-8 md:px-12 lg:px-16 py-4 sm:py-5 md:py-6`}>
        <AnimatePresence mode="wait">
          {activeWorkspace === 'video' ? (
            <motion.div
              key={`video-${activeVideoMode}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <VideoWorkspace
                inputMode={activeVideoMode}
                onInputModeChange={(mode) => void setVideoMode(mode === 'text' ? null : mode)}
                onExit={() => selectWorkspace('image')}
                onOpenConnections={openConnections}
              />
            </motion.div>
          ) : !selectedFeature ? (
            <motion.div
              key={isHome ? 'home' : 'image-picker'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full"
            >
              {!isHome ? <section className="space-y-6" aria-labelledby="image-workspace-title">
              <div className="text-center space-y-2 sm:space-y-2.5 py-0 sm:py-1">
                <h2 id="image-workspace-title"
                  className="display text-2xl sm:text-3xl md:text-4xl font-semibold px-4 text-balance"
                >
                  <span className="gradient-text">Create stunning images</span>{' '}
                  <span className="text-[var(--foreground)]">with AI power</span>
                </h2>

                {/* Blurb and engines share one row on desktop, stack on mobile. */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 }}
                  className="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4"
                >
                  <p className="text-[0.8125rem] sm:text-sm text-[var(--foreground-muted)] max-w-xl leading-relaxed">
                    {brand.heroBlurb}
                  </p>

                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <span className="pill">
                      <ProviderLogo provider="gemini" size={13} className="text-emerald-400" />
                      {PROVIDER_LABELS.gemini}
                    </span>
                    <span className="pill">
                      <ProviderLogo provider="pollinations" size={13} className="text-[var(--neon-purple)]" />
                      {PROVIDER_LABELS.pollinations}
                    </span>
                    <span className="pill">
                      <ProviderLogo provider="cloudflare" size={13} className="text-[var(--brand-accent)]" />
                      {PROVIDER_LABELS.cloudflare}
                    </span>
                  </div>
                </motion.div>
              </div>
                <FeatureSelector selectedFeature={null} onFeatureSelect={selectFeature} />
              </section> : <StudioLauncher onSelectImage={selectFeature} onSelectVideo={(mode) => {
                void setFeatureId(null);
                void setWorkspace('video');
                void setVideoMode(mode === 'text' ? null : mode);
              }} />}
            </motion.div>
          ) : (
            <motion.div
              key={selectedFeature.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <GenerationInterface
                feature={selectedFeature}
                apiKey={apiKey}
                onBack={clearFeature}
                onOpenConnections={openConnections}
                onUseAsFirstFrame={startVideoFromFirstFrame}
                onEditImage={startEditingFromResult}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </>
  );
}
