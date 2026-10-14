import type { RenderEngine, RenderProgress, RenderRequest } from './port';
import { formatBytes } from '@/lib/format-bytes';

/**
 * The client half of server-side rendering: uploads the timeline to
 * `app/api/timeline/render/route.ts`, polls it, and downloads the result.
 * The actual ffmpeg spawn lives entirely on the server — this file only ever
 * speaks HTTP.
 */

const RENDER_ENDPOINT = '/api/timeline/render';
const POLL_INTERVAL_MS = 1000;

const NOT_CONFIGURED = 'Server rendering is not available here.';
const SIGN_IN_REQUIRED = 'Sign in to use server rendering.';
/**
 * A 403 is an account that exists but is pending or blocked. Reporting `null`
 * ("available") for it showed those users a working server-export button that
 * failed the moment they pressed it — a real reason is the whole point of
 * `unavailableReason`.
 */
const NOT_APPROVED = 'Your account is not approved for server rendering.';

function abortError(): DOMException {
  return new DOMException('The export was cancelled.', 'AbortError');
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function safeErrorMessage(response: Response): Promise<string | null> {
  const error = (await safeJson(response))?.error;
  return typeof error === 'string' ? error : null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort);
  });
}

interface JobStatus {
  id: string;
  phase: 'queued' | 'preparing' | 'encoding' | 'muxing' | 'uploading' | 'done' | 'error' | 'cancelled';
  progress: number | null;
  error: string | null;
}

function mapPhase(status: JobStatus): RenderProgress {
  switch (status.phase) {
    case 'encoding':
      return { phase: 'encoding', completed: status.progress };
    case 'muxing':
      return { phase: 'muxing', completed: status.progress };
    default:
      // 'queued' and 'preparing' both read as "not encoding yet" to the UI.
      return { phase: 'preparing', completed: status.progress };
  }
}

async function pollUntilDone(
  jobId: string,
  signal: AbortSignal,
  onProgress: (p: RenderProgress) => void
): Promise<void> {
  while (true) {
    if (signal.aborted) throw abortError();

    const response = await fetch(`${RENDER_ENDPOINT}?id=${encodeURIComponent(jobId)}`, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const message = await safeErrorMessage(response);
      throw new Error(message ?? 'Lost track of the server render.');
    }

    const status = (await response.json()) as JobStatus;
    if (status.phase === 'done') return;
    if (status.phase === 'error') throw new Error(status.error ?? 'The server render failed.');
    if (status.phase === 'cancelled') {
      if (signal.aborted) throw abortError();
      throw new Error('The render was cancelled on the server.');
    }

    onProgress(mapPhase(status));
    await sleep(POLL_INTERVAL_MS, signal);
  }
}

export function createServerEngine(): RenderEngine {
  return {
    id: 'server',

    /**
     * Probes the route itself rather than guessing: a bare GET with no
     * job id runs both of the route's gates and nothing else. 404 means the
     * ffmpeg path is not configured on this deployment; 401 means the
     * account gate is on and this browser has no session. Anything else —
     * including a network failure reaching the route at all — reads as
     * "available," and a real attempt to render surfaces whatever actually
     * went wrong.
     */
    async unavailableReason(): Promise<string | null> {
      let response: Response;
      try {
        response = await fetch(RENDER_ENDPOINT, { method: 'GET', cache: 'no-store' });
      } catch {
        return null;
      }
      if (response.status === 404) return NOT_CONFIGURED;
      if (response.status === 401) return SIGN_IN_REQUIRED;
      if (response.status === 403) return NOT_APPROVED;
      return null;
    },

    async render(request: RenderRequest, { signal, onProgress }): Promise<Blob> {
      if (signal.aborted) throw abortError();
      if (request.clips.length === 0) throw new Error('There is nothing on the timeline to export.');

      onProgress({ phase: 'uploading', completed: null });

      const totalBytes = request.clips.reduce((sum, clip) => sum + clip.media.size, 0);

      const form = new FormData();
      form.append('output', JSON.stringify(request.output));
      form.append(
        'clips',
        JSON.stringify(
          request.clips.map((clip) => ({
            fit: clip.fit,
            // Sent rather than pre-cut client-side: the whole clip is uploaded
            // either way, and letting ffmpeg seek keeps both engines honouring
            // exactly the same numbers.
            ...(typeof clip.trimStart === 'number' ? { trimStart: clip.trimStart } : {}),
            ...(typeof clip.trimEnd === 'number' ? { trimEnd: clip.trimEnd } : {}),
            // Only meaningful with sound switched on, and only ever a hint:
            // the server cannot probe (it has ffmpeg, not ffprobe), so this is
            // how it learns which inputs need silence generated to stand in
            // for them, and how long that silence has to be.
            ...(request.output.keepAudio && clip.hasAudio !== undefined
              ? { hasAudio: clip.hasAudio }
              : {}),
            ...(request.output.keepAudio && typeof clip.durationSeconds === 'number'
              ? { durationSeconds: clip.durationSeconds }
              : {}),
          }))
        )
      );
      request.clips.forEach((clip, index) => {
        form.append(`clip-${index}`, clip.media, `clip-${index}`);
      });

      let uploadResponse: Response;
      try {
        uploadResponse = await fetch(RENDER_ENDPOINT, { method: 'POST', body: form, signal });
      } catch {
        if (signal.aborted) throw abortError();
        throw new Error('The upload to the server failed.');
      }

      if (!uploadResponse.ok) {
        if (uploadResponse.status === 413) {
          // Both numbers, per the design spec: the size sent and the ceiling
          // it broke. "8.4 GB of a 512 MB limit" is a timeline to shorten;
          // "8.4 MB of a 1 MB limit" is a reverse proxy whose
          // `client_max_body_size` was never raised. The ceiling comes from
          // the route's own response — a proxy that answers 413 itself sends
          // no such field, and the message simply omits it rather than
          // inventing a number.
          const limit = (await safeJson(uploadResponse))?.limit;
          const ceiling = typeof limit === 'number' && limit > 0 ? ` of a ${formatBytes(limit)} limit` : '';
          throw new Error(
            `This timeline is too large to upload (${formatBytes(totalBytes)}${ceiling}). Remove or shorten clips and try again.`
          );
        }
        const message = await safeErrorMessage(uploadResponse);
        throw new Error(message ?? 'The server could not start the render.');
      }

      const { jobId } = (await uploadResponse.json()) as { jobId: string };

      /**
       * Tells the server to stop. Aborting locally only ends the *client's*
       * interest in the render — ffmpeg would keep running to completion,
       * holding the single concurrency slot and its temp directory, so the
       * next export sits behind a render nobody is waiting for.
       *
       * Deliberately made without `signal`: this request exists precisely
       * because that signal fired, and a fetch issued with an already-aborted
       * signal never leaves the browser. `keepalive` so it still goes out if
       * the abort came from the page unloading. Failure is ignored — the
       * 30-minute sweeper is the backstop, and there is nothing useful to
       * tell a user who has already cancelled.
       */
      const cancelOnServer = () => {
        void fetch(`${RENDER_ENDPOINT}?id=${encodeURIComponent(jobId)}`, {
          method: 'DELETE',
          keepalive: true,
          cache: 'no-store',
        }).catch(() => {});
      };

      try {
        // An already-aborted signal never fires 'abort' again, so the
        // listener alone would miss a cancel that landed during the upload.
        if (signal.aborted) {
          cancelOnServer();
          throw abortError();
        }
        signal.addEventListener('abort', cancelOnServer);

        await pollUntilDone(jobId, signal, onProgress);

        if (signal.aborted) throw abortError();

        const resultResponse = await fetch(`${RENDER_ENDPOINT}?id=${encodeURIComponent(jobId)}&result=1`, {
          signal,
          cache: 'no-store',
        });
        if (!resultResponse.ok) {
          const message = await safeErrorMessage(resultResponse);
          throw new Error(message ?? 'The finished render could not be downloaded.');
        }

        return await resultResponse.blob();
      } finally {
        signal.removeEventListener('abort', cancelOnServer);
      }
    },
  };
}
