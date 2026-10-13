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

let loading: Promise<YouTubeNamespace> | null = null;
function loadApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT!); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { loading = null; reject(new Error('The YouTube player could not load.')); };
    document.head.append(script);
  });
  return loading;
}

/** Mounts YouTube's own player (privacy-enhanced host) in `element`. Watching
 *  downloads nothing; only Import does. */
export async function createClipPlayer(element: HTMLElement, videoId: string): Promise<ClipPlayer> {
  const YT = await loadApi();
  return new Promise(resolve => {
    const player: ClipPlayer = new YT.Player(element, {
      videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0 },
      events: { onReady: () => resolve(player) },
    });
  });
}
