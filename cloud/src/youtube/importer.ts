import { DurableObject } from 'cloudflare:workers';
import { YOUTUBE_IMPORT_TIMEOUT_MS } from '../../../lib/youtube/clip';
import type { Env } from '../security';
import { handleImport, toResponse, type ClipContainer } from './importer-core';

/** One instance per account: importYouTubeClip addresses it by owner id, which is what
 *  makes "one import at a time" and the hourly count per account. The logic lives in
 *  importer-core so it is testable without the Workers runtime. */
export class YouTubeImporter extends DurableObject<Env> {
  private readonly state = { busy: false };

  async fetch(request: Request): Promise<Response> {
    // request.signal needs the enable_request_signal flag; without it a closed tab
    // would leave yt-dlp running until the timeout.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(YOUTUBE_IMPORT_TIMEOUT_MS)]);
    const body = await request.json().catch(() => null);
    return toResponse(await handleImport({
      container: this.ctx.container as unknown as ClipContainer | undefined,
      storage: this.ctx.storage,
      state: this.state,
      proxyUrl: this.env.YOUTUBE_PROXY_URL,
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      workId: () => crypto.randomUUID(),
    }, body, signal));
  }
}
