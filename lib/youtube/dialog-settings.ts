/** Quick section lengths the import dialog offers, in seconds. */
export const QUICK_LENGTHS = [5, 7, 10] as const;

/** What the YouTube import dialog remembers in this browser, so reopening it (or
 *  reloading the page) picks up where the last import left off. */
export interface ClipDialogSettings {
  link: string; from: string; to: string;
  /** The last quick length chosen; a newly pasted link gets To = From + this. */
  length: number | null;
  saveToLibrary: boolean;
}

const KEY = 'scene-assembly:youtube-dialog';
/** The save choice was stored on its own before the rest was remembered. */
const LEGACY_SAVE_KEY = 'scene-assembly:youtube-save-to-library';
const DEFAULTS: ClipDialogSettings = { link: '', from: '0:00.0', to: '', length: null, saveToLibrary: false };

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);

/** Never throws: storage can be blocked, full, or hold something another version wrote. */
export function readClipDialogSettings(): ClipDialogSettings {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    const saved = stored && typeof stored === 'object' ? stored : {};
    return {
      link: text(saved.link, 2048) ?? DEFAULTS.link,
      from: text(saved.from, 16) ?? DEFAULTS.from,
      to: text(saved.to, 16) ?? DEFAULTS.to,
      length: typeof saved.length === 'number' && (QUICK_LENGTHS as readonly number[]).includes(saved.length) ? saved.length : null,
      saveToLibrary: typeof saved.saveToLibrary === 'boolean' ? saved.saveToLibrary : window.localStorage.getItem(LEGACY_SAVE_KEY) === '1',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeClipDialogSettings(settings: ClipDialogSettings): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: remembered for this visit only */ }
}
