import { beforeEach, describe, expect, it } from 'vitest';
import { readClipDialogSettings, writeClipDialogSettings } from '@/lib/youtube/dialog-settings';

beforeEach(() => window.localStorage.clear());

describe('remembered YouTube dialog settings', () => {
  it('round-trips what the dialog writes', () => {
    writeClipDialogSettings({ link: 'https://youtu.be/aqz-KE-bpKQ', from: '1:02.0', to: '1:09.0', length: 7, saveToLibrary: true });
    expect(readClipDialogSettings()).toEqual({ link: 'https://youtu.be/aqz-KE-bpKQ', from: '1:02.0', to: '1:09.0', length: 7, saveToLibrary: true });
  });
  it('falls back to defaults for missing, corrupt or foreign values', () => {
    expect(readClipDialogSettings()).toEqual({ link: '', from: '0:00.0', to: '', length: null, saveToLibrary: false });
    window.localStorage.setItem('scene-assembly:youtube-dialog', '{not json');
    expect(readClipDialogSettings().from).toBe('0:00.0');
    window.localStorage.setItem('scene-assembly:youtube-dialog', JSON.stringify({ link: 42, from: 'x'.repeat(100), length: 9 }));
    expect(readClipDialogSettings()).toMatchObject({ link: '', from: 'x'.repeat(16), length: null });
  });
  it('keeps the save choice made before the rest was remembered', () => {
    window.localStorage.setItem('scene-assembly:youtube-save-to-library', '1');
    expect(readClipDialogSettings().saveToLibrary).toBe(true);
  });
});
