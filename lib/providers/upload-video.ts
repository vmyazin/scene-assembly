// lib/providers/upload-video.ts
import { fileAsDataUrl } from '@/lib/file-data-url';
import { validateEditVideo } from './video-edit';
const API = 'https://api.runware.ai/v1';

/** Direct upload: a media data URI must never pass through Vercel's body limit.
 * Only called after Generate, with the explicitly chosen browser Runware key.
 * Reference video and audio use the same media-storage task as an edit source.
 */
export async function uploadRunwareMedia(file: File, apiKey: string, onProgress: (percent: number) => void): Promise<string> {
  const media = await fileAsDataUrl(file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API);
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 180_000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error('Source upload failed. Check your connection and try again.'));
    xhr.ontimeout = () => reject(new Error('Source upload timed out. Try again.'));
    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300 || payload.errors?.length) throw new Error(payload.errors?.[0]?.message || 'Runware could not store that file.');
        const id = payload.data?.[0]?.mediaUUID;
        if (typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id)) throw new Error('Runware did not return a media ID.');
        resolve(id);
      } catch (error) { reject(error); }
    };
    xhr.send(JSON.stringify([{taskType: 'mediaStorage', taskUUID: crypto.randomUUID(), operation: 'upload', media}]));
  });
}

export async function uploadRunwareVideo(file: File, apiKey: string, onProgress: (percent: number) => void): Promise<string> {
  validateEditVideo(file);
  return uploadRunwareMedia(file, apiKey, onProgress);
}
