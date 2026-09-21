// store/useAppStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { EngineId } from '@/lib/engines/registry';
import { DEFAULT_GEMINI_IMAGE_MODEL } from '@/lib/engines/gemini-catalog';
import { DEFAULT_GEMINI_VIDEO_MODEL } from '@/lib/engines/gemini-video-catalog';
import type { ImageFormatPreference } from '@/lib/image/policy';
import { DEFAULT_MODELS } from '@/lib/providers/catalog';
import type { ProviderId } from '@/lib/providers/types';
import type { ImportableProvider } from '@/lib/account/key-import';

/** Engines that can produce video: the two original ones plus the aggregators. */
export type VideoEngineId = 'gemini' | 'kie' | 'fal' | ProviderId;

/** Store field names per provider, so the setters stay one line each. */
const KEY_FIELDS: Record<ProviderId, 'runwareApiKey' | 'atlasApiKey' | 'cometApiKey' | 'piapiApiKey'> = {
  runware: 'runwareApiKey',
  atlas: 'atlasApiKey',
  comet: 'cometApiKey',
  piapi: 'piapiApiKey',
};

const MODEL_FIELDS: Record<ProviderId, Record<'image' | 'video', string>> = {
  runware: { image: 'runwareImageModel', video: 'runwareVideoModel' },
  atlas: { image: 'atlasImageModel', video: 'atlasVideoModel' },
  comet: { image: 'cometImageModel', video: 'cometVideoModel' },
  piapi: { image: 'piapiImageModel', video: 'piapiVideoModel' },
};

/** Public persist key after rebrand. */
const STORAGE_KEY = 'scene-assembly-store';
/** Pre-rebrand Zustand persist key — read once, then retired. */
const LEGACY_STORAGE_KEY = 'nano-banana-store';

interface AppState {
  /** The user's Gemini API key (persisted to localStorage). */
  apiKey: string;
  /** Selected image generation engine (persisted). */
  engine: EngineId;
  /**
   * Which Gemini image model runs (persisted). One key buys Nano Banana Pro,
   * Nano Banana 2 and Nano Banana 2 Lite, and they differ fourfold in price at
   * the same resolution, so the choice is worth keeping between visits.
   */
  geminiImageModel: string;
  /** Which Gemini video model runs (persisted). */
  geminiVideoModel: string;
  /** Cloudflare Workers AI credentials (persisted). */
  cfAccountId: string;
  cfToken: string;
  /** Kie.ai BYOK credentials and per-media model preferences (persisted). */
  kieApiKey: string;
  kieImageModel: string;
  kieVideoModel: string;
  falApiKey: string;
  videoEngine: VideoEngineId;
  falVideoModel: string;
  /**
   * Aggregator providers (Runware, Atlas Cloud, CometAPI). One key each, plus
   * the model chosen per media kind — their catalogs are large enough that the
   * choice is worth persisting rather than resetting to the default each visit.
   */
  runwareApiKey: string;
  runwareImageModel: string;
  runwareVideoModel: string;
  atlasApiKey: string;
  atlasImageModel: string;
  atlasVideoModel: string;
  piapiApiKey: string;
  piapiImageModel: string;
  piapiVideoModel: string;
  cometApiKey: string;
  cometImageModel: string;
  cometVideoModel: string;
  /**
   * Image format policy. `'auto'` re-encodes PNG to WebP wherever bytes enter
   * or leave the app; an explicit format forces it. Persisted because it is a
   * preference about output, not a per-session choice.
   */
  imageFormat: ImageFormatPreference;
  /**
   * Whether the library re-encodes what it stores. Opt-out because it is the
   * one irreversible conversion: once a record holds WebP the original PNG is
   * gone, and a later "download as PNG" can only re-encode a lossy image.
   */
  convertLibraryImages: boolean;
  /**
   * Whether a finished generation rings the completion chime. On by default:
   * the jobs it announces run for minutes, and the sound is the point of
   * being able to look away. Persisted so silencing it survives a reload.
   */
  /**
   * Whether the studio plays interface sounds. Named for the category rather
   * than for the one sound that exists today: it used to be `chimeOnComplete`,
   * which would have been a misleading gate the moment a second sound was
   * added. `migrate` below carries the old value across.
   */
  uiSoundsEnabled: boolean;
  /**
   * Providers deliberately kept out of the account. Save & close syncs every
   * other key, so without this flag pressing "Remove from account" would be
   * undone by the very next close.
   */
  accountKeyOptOuts: ImportableProvider[];
  /** True once the persisted state has rehydrated on the client. */
  hasHydrated: boolean;
  setApiKey: (key: string) => void;
  setEngine: (engine: EngineId) => void;
  setGeminiImageModel: (modelId: string) => void;
  setGeminiVideoModel: (modelId: string) => void;
  setCfAccountId: (v: string) => void;
  setCfToken: (v: string) => void;
  setKieApiKey: (key: string) => void;
  setKieImageModel: (modelId: string) => void;
  setKieVideoModel: (modelId: string) => void;
  setFalApiKey: (key: string) => void;
  setVideoEngine: (engine: VideoEngineId) => void;
  setFalVideoModel: (modelId: string) => void;
  setProviderApiKey: (provider: ProviderId, key: string) => void;
  setProviderModel: (provider: ProviderId, kind: 'image' | 'video', modelId: string) => void;
  setImageFormat: (preference: ImageFormatPreference) => void;
  setConvertLibraryImages: (convert: boolean) => void;
  setUiSoundsEnabled: (enabled: boolean) => void;
  setAccountKeyOptOut: (provider: ImportableProvider, optedOut: boolean) => void;
  setHasHydrated: (v: boolean) => void;
}

/**
 * One-time bridge: if `scene-assembly-store` is missing, copy the full
 * `nano-banana-store` blob (credentials, engine, preferences) into it.
 * Runs on first getItem so rehydration sees the migrated payload.
 */
function createMigratingStorage(): StateStorage {
  return {
    getItem: (name) => {
      const existing = localStorage.getItem(name);
      if (existing != null) return existing;

      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy == null) return null;

      localStorage.setItem(name, legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return legacy;
    },
    setItem: (name, value) => {
      localStorage.setItem(name, value);
    },
    removeItem: (name) => {
      localStorage.removeItem(name);
    },
  };
}

/**
 * Centralized client state. Persists under `scene-assembly-store`, migrating
 * from the legacy `nano-banana-store` key on first load, and still lifting the
 * older raw `gemini_api_key` value when no API key is present after rehydrate.
 *
 * Hydration is deferred (`skipHydration`) and kicked off from a mount effect
 * so the server and first client render agree (no hydration mismatch on the
 * header CTA). Call `useAppStore.persist.rehydrate()` once on mount.
 */
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      apiKey: '',
      engine: 'gemini',
      geminiImageModel: DEFAULT_GEMINI_IMAGE_MODEL,
      geminiVideoModel: DEFAULT_GEMINI_VIDEO_MODEL,
      cfAccountId: '',
      cfToken: '',
      kieApiKey: '',
      kieImageModel: 'nano-banana-pro',
      kieVideoModel: 'veo-3-1',
      falApiKey: '',
      videoEngine: 'kie',
      falVideoModel: 'veo-3-1-fast',
      runwareApiKey: '',
      runwareImageModel: DEFAULT_MODELS.runware.image,
      runwareVideoModel: DEFAULT_MODELS.runware.video,
      atlasApiKey: '',
      atlasImageModel: DEFAULT_MODELS.atlas.image,
      atlasVideoModel: DEFAULT_MODELS.atlas.video,
      piapiApiKey: '',
      piapiImageModel: DEFAULT_MODELS.piapi.image,
      piapiVideoModel: DEFAULT_MODELS.piapi.video,
      cometApiKey: '',
      cometImageModel: DEFAULT_MODELS.comet.image,
      cometVideoModel: DEFAULT_MODELS.comet.video,
      accountKeyOptOuts: [],
      imageFormat: 'auto',
      convertLibraryImages: true,
      uiSoundsEnabled: true,
      hasHydrated: false,
      setApiKey: (key) => set({ apiKey: key }),
      setEngine: (engine) => set({ engine }),
      setGeminiImageModel: (modelId) => set({ geminiImageModel: modelId }),
      setGeminiVideoModel: (modelId) => set({ geminiVideoModel: modelId }),
      setCfAccountId: (v) => set({ cfAccountId: v }),
      setCfToken: (v) => set({ cfToken: v }),
      setKieApiKey: (key) => set({ kieApiKey: key }),
      setKieImageModel: (modelId) => set({ kieImageModel: modelId }),
      setKieVideoModel: (modelId) => set({ kieVideoModel: modelId }),
      setFalApiKey: (key) => set({ falApiKey: key }),
      setVideoEngine: (engine) => set({ videoEngine: engine }),
      setFalVideoModel: (modelId) => set({ falVideoModel: modelId }),
      setProviderApiKey: (provider, key) => set({ [KEY_FIELDS[provider]]: key } as Partial<AppState>),
      setProviderModel: (provider, kind, modelId) =>
        set({ [MODEL_FIELDS[provider][kind]]: modelId } as Partial<AppState>),
      setImageFormat: (preference) => set({ imageFormat: preference }),
      setConvertLibraryImages: (convert) => set({ convertLibraryImages: convert }),
      setUiSoundsEnabled: (enabled) => set({ uiSoundsEnabled: enabled }),
      setAccountKeyOptOut: (provider, optedOut) =>
        set((state) => ({
          accountKeyOptOuts: optedOut
            ? state.accountKeyOptOuts.includes(provider)
              ? state.accountKeyOptOuts
              : [...state.accountKeyOptOuts, provider]
            : state.accountKeyOptOuts.filter((id) => id !== provider),
        })),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => createMigratingStorage()),
      /**
       * Bumped when `chimeOnComplete` became `uiSoundsEnabled`. Without this
       * the rename is silently destructive in the worse direction: the stored
       * blob has no `uiSoundsEnabled`, so every existing user falls back to the
       * default `true` and anyone who deliberately silenced the studio starts
       * hearing it again.
       *
       * A blob written before this reports `version: 0` — zustand defaults the
       * option to 0 and writes it into the payload — so `0 !== 1` is what makes
       * the migration run for exactly those users. Note it runs only when the
       * stored version is a *number* that differs: a payload with no `version`
       * key is skipped, which zustand never produces but a hand-edited
       * localStorage would.
       */
      version: 1,
      migrate: (persisted, from) => {
        if (from >= 1 || !persisted || typeof persisted !== 'object') return persisted;
        const legacy = persisted as { chimeOnComplete?: unknown };
        if (typeof legacy.chimeOnComplete !== 'boolean') return persisted;
        return { ...(persisted as object), uiSoundsEnabled: legacy.chimeOnComplete };
      },
      partialize: (s) => ({
        apiKey: s.apiKey,
        engine: s.engine,
        geminiImageModel: s.geminiImageModel,
        geminiVideoModel: s.geminiVideoModel,
        cfAccountId: s.cfAccountId,
        cfToken: s.cfToken,
        kieApiKey: s.kieApiKey,
        kieImageModel: s.kieImageModel,
        kieVideoModel: s.kieVideoModel,
        falApiKey: s.falApiKey,
        videoEngine: s.videoEngine,
        falVideoModel: s.falVideoModel,
        runwareApiKey: s.runwareApiKey,
        runwareImageModel: s.runwareImageModel,
        runwareVideoModel: s.runwareVideoModel,
        atlasApiKey: s.atlasApiKey,
        atlasImageModel: s.atlasImageModel,
        atlasVideoModel: s.atlasVideoModel,
        piapiApiKey: s.piapiApiKey,
        piapiImageModel: s.piapiImageModel,
        piapiVideoModel: s.piapiVideoModel,
        cometApiKey: s.cometApiKey,
        cometImageModel: s.cometImageModel,
        cometVideoModel: s.cometVideoModel,
        accountKeyOptOuts: s.accountKeyOptOuts,
        imageFormat: s.imageFormat,
        convertLibraryImages: s.convertLibraryImages,
        uiSoundsEnabled: s.uiSoundsEnabled,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Legacy pre-Zustand key (older app versions stored the Gemini key raw).
        if (!state.apiKey && typeof localStorage !== 'undefined') {
          const legacy = localStorage.getItem('gemini_api_key');
          if (legacy) state.setApiKey(legacy);
        }
        state.setHasHydrated(true);
      },
    }
  )
);
