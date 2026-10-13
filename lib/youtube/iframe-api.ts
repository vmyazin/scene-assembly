'use client';

/** The few YouTube IFrame Player methods the clip dialog uses. */
export interface ClipPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface YouTubeNamespace { Player: new (element: HTMLElement, options: Record<string, unknown>) => ClipPlayer }
declare global { interface Window { YT?: YouTubeNamespace; onYouTubeIframeAPIReady?: () => void } }

const LOAD_TIMEOUT_MS = 15_000;
let loading: Promise<YouTubeNamespace> | null = null;
function loadApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise((resolve, reject) => {
    const fail = () => { loading = null; reject(new Error('The YouTube player could not load.')); };
    const timer = window.setTimeout(fail, LOAD_TIMEOUT_MS);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { window.clearTimeout(timer); previous?.(); resolve(window.YT!); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { window.clearTimeout(timer); fail(); };
    document.head.append(script);
  });
  return loading;
}

export interface ClipPlayerHooks {
  /** Fires on every player state change; the duration is often unknown until then. */
  onStateChange?: (player: ClipPlayer) => void;
  /** Fires when YouTube cannot play the video, before or after the player is ready. */
  onError?: (message: string) => void;
}
const UNPLAYABLE = "This video can't be played here.";

/** Mounts YouTube's own player (privacy-enhanced host) in `element`. Watching
 *  downloads nothing; only Import does. Rejects when the API cannot load or the
 *  video cannot be played. */
export async function createClipPlayer(element: HTMLElement, videoId: string, hooks: ClipPlayerHooks = {}): Promise<ClipPlayer> {
  const YT = await loadApi();
  return new Promise((resolve, reject) => {
    const player: ClipPlayer = new YT.Player(element, {
      videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => resolve(player),
        onStateChange: () => hooks.onStateChange?.(player),
        onError: () => { hooks.onError?.(UNPLAYABLE); reject(new Error(UNPLAYABLE)); },
      },
    });
  });
}
