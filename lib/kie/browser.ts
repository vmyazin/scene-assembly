import { RouteError } from '@/lib/providers/route-error';
import type { KieInputMode, KieJob, KieProtocol, KieTask, MediaType } from './types';

interface KieRouteResponse {
  success?: boolean;
  error?: string;
  taskId?: string;
  protocol?: KieProtocol;
  task?: KieTask;
  url?: string;
}

async function parseKieResponse(response: Response): Promise<KieRouteResponse> {
  const data = (await response.json().catch(() => ({}))) as KieRouteResponse;
  if (!response.ok || !data.success) {
    throw new RouteError(
      data.error || 'Kie could not complete that request. Please try again.',
      response.status
    );
  }
  return data;
}

export async function uploadKieFiles(apiKey: string, files: File[]): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      const form = new FormData();
      form.set('apiKey', apiKey);
      form.set('file', file);
      const data = await parseKieResponse(
        await fetch('/api/kie/upload', { method: 'POST', body: form })
      );
      if (!data.url) throw new Error('Kie did not return a temporary file URL.');
      return data.url;
    })
  );
}

export async function submitKieJob(args: {
  apiKey: string;
  modelId: string;
  mediaType: MediaType;
  inputMode: KieInputMode;
  prompt: string;
  uploadUrls: string[];
  values: Record<string, string | number | boolean>;
  editReferencePlan?: import('../providers/edit-references').EditReferencePlan;
}): Promise<Pick<KieJob, 'taskId' | 'protocol'>> {
  const data = await parseKieResponse(
    await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'kie', operation: 'submit', ...args }),
    })
  );
  if (!data.taskId || !data.protocol) throw new Error('Kie did not return a task ID.');
  return { taskId: data.taskId, protocol: data.protocol };
}

/** Balance readout for the spend ledger. Resolves to null on any failure. */
export async function fetchKieCredits(apiKey: string): Promise<number | null> {
  try {
    const response = await fetch('/api/kie/credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    const data = (await response.json().catch(() => ({}))) as { success?: boolean; credits?: unknown };
    return response.ok && data.success && typeof data.credits === 'number' ? data.credits : null;
  } catch {
    return null;
  }
}

export async function getKieJobStatus(
  args: {
    apiKey: string;
    taskId: string;
    protocol: KieProtocol;
  },
  options: { signal?: AbortSignal } = {}
): Promise<KieTask> {
  const data = await parseKieResponse(
    await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'kie', operation: 'status', ...args }),
      signal: options.signal,
    })
  );
  if (!data.task) throw new Error('Kie did not return the task status.');
  return data.task;
}
