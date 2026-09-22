import { beforeEach, describe, expect, it } from 'vitest';
import { assetForJob, libraryHashForAsset, studioLocationForJob } from '@/lib/account/job-location';
import type { CloudAsset, CloudJobRequest } from '@/lib/account/contracts';
import { useAppStore } from '@/store/useAppStore';

function request(over: Partial<CloudJobRequest> = {}): CloudJobRequest {
  return { provider: 'runware', modelId: 'bytedance:seedance@2.0-mini', mediaType: 'video', inputMode: 'text', prompt: 'A canal at dusk', values: {}, referenceIds: [], ...over };
}
function asset(id: string, jobId: string | null): CloudAsset {
  return { id, kind: 'image', mimeType: 'image/png', bytes: 10, createdAt: 1, metadata: request(), jobId };
}

beforeEach(() => {
  useAppStore.setState({ engine: 'gemini', videoEngine: 'kie' });
});

describe('where a job is looked at', () => {
  it('joins a finished job to its asset by jobId, never by matching metadata', () => {
    // Two runs of the same prompt and model produce two assets whose metadata is
    // identical, so anything but the id would pick the wrong card.
    const assets = [asset('a1', 'other'), asset('a2', 'mine')];
    expect(assetForJob({ id: 'mine' }, assets)?.id).toBe('a2');
    expect(assetForJob({ id: 'gone' }, assets)).toBeNull();
    expect(libraryHashForAsset('a2')).toBe('/account#asset-a2');
  });

  it('sends a video job to its workspace and mode, and selects its engine and model', () => {
    const location = studioLocationForJob(request({ inputMode: 'image' }));
    expect(location?.href).toBe('/?workspace=video&videoMode=image');
    location?.select();
    expect(useAppStore.getState().videoEngine).toBe('runware');
    expect(useAppStore.getState().runwareVideoModel).toBe('bytedance:seedance@2.0-mini');
  });

  it('leaves videoMode off a text-to-video job, the way Studio writes it back', () => {
    // Studio sets the param to null for `text`; emitting it here would make Back
    // step through two URLs for one view.
    expect(studioLocationForJob(request())?.href).toBe('/?workspace=video');
  });

  it('routes each video engine to the model field it actually reads', () => {
    studioLocationForJob(request({ provider: 'fal', modelId: 'fal-ai/veo3' }))?.select();
    expect(useAppStore.getState().videoEngine).toBe('fal');
    expect(useAppStore.getState().falVideoModel).toBe('fal-ai/veo3');
    studioLocationForJob(request({ provider: 'gemini', modelId: 'veo-3.1-generate-preview' }))?.select();
    expect(useAppStore.getState().geminiVideoModel).toBe('veo-3.1-generate-preview');
    studioLocationForJob(request({ provider: 'kie', modelId: 'sora-2-text-to-video' }))?.select();
    expect(useAppStore.getState().kieVideoModel).toBe('sora-2-text-to-video');
  });

  it('sends an image job to the feature its input mode collapsed from', () => {
    const text = studioLocationForJob(request({ provider: 'gemini', mediaType: 'image', inputMode: 'text', modelId: 'gemini-3-pro-image-preview' }));
    expect(text?.href).toBe('/?feature=text-to-image');
    text?.select();
    expect(useAppStore.getState().engine).toBe('gemini');
    expect(useAppStore.getState().geminiImageModel).toBe('gemini-3-pro-image-preview');
    // Every feature that takes an image submits `inputMode: 'image'`, and the
    // result panel filters on that, so one editing form answers for all of them.
    expect(studioLocationForJob(request({ mediaType: 'image', inputMode: 'image' }))?.href).toBe('/?feature=image-editing');
  });

  it('has nowhere to send a provider with no workspace', () => {
    // `local-test` is a real CloudProvider that reaches the browser in local
    // development and has no form at all.
    expect(studioLocationForJob(request({ provider: 'local-test', modelId: 'local-test' }))).toBeNull();
    expect(studioLocationForJob(request({ provider: 'local-test', modelId: 'local-test', mediaType: 'image', inputMode: 'text' }))).toBeNull();
    // Cloudflare and Pollinations run images only; a video job filed against one
    // would have no video workspace to open.
    expect(studioLocationForJob(request({ provider: 'cloudflare' }))).toBeNull();
  });

  it('leaves the engine alone for fixed-model image engines', () => {
    const location = studioLocationForJob(request({ provider: 'pollinations', modelId: 'flux', mediaType: 'image', inputMode: 'text' }));
    location?.select();
    expect(useAppStore.getState().engine).toBe('pollinations');
  });
});
