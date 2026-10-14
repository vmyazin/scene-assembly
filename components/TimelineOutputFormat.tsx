'use client';

import type { FocusEvent, KeyboardEvent } from 'react';
import { Settings2, Volume2, VolumeX } from 'lucide-react';

import type { TimelineOutput } from '@/store/useTimelineStore';

/**
 * The output format, shown and editable.
 *
 * The project owner's choice was "the timeline picks a sensible target from
 * what's on it and shows it as an editable output setting", paired with the
 * per-clip crop override. The crop half shipped first; this is the other half.
 * Without it `output.auto` could never become false, so the store's `setOutput`
 * had no caller and the "match clips" affordance was unreachable.
 *
 * Every value is constrained on commit rather than trusted as typed — see
 * `constrainDimension`, which is what keeps a hand-entered odd number from
 * reaching an encoder that would reject it.
 */

/** Small enough to be a thumbnail, large enough for 8K; both engines cope. */
export const MIN_DIMENSION = 16;
export const MAX_DIMENSION = 7680;
export const MIN_FPS = 1;
export const MAX_FPS = 240;

/**
 * A width or height the encoders will actually accept.
 *
 * Both engines encode H.264 in yuv420p, which requires even dimensions —
 * libx264 refuses "width not divisible by 2" outright and WebCodecs rejects
 * the config. `deriveOutputFormat` already guarantees that for the automatic
 * value; a hand-typed 1921 would break both engines identically, so it is
 * rounded *down* here (never up: growing the frame to satisfy the codec would
 * upscale the source).
 */
export function constrainDimension(value: number): number {
  const clamped = Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value)));
  return Math.floor(clamped / 2) * 2;
}

/**
 * A framerate both engines can use. Deliberately not forced to an integer:
 * NTSC rates (23.976, 29.97) are exactly what `deriveOutputFormat` derives
 * from real Veo output, and rounding them to 24/30 would reintroduce the
 * uneven cadence the framerate probe exists to avoid.
 */
export function constrainFps(value: number): number {
  const clamped = Math.min(MAX_FPS, Math.max(MIN_FPS, value));
  return Number(clamped.toFixed(3));
}

interface TimelineOutputFormatProps {
  output: TimelineOutput;
  /** Any committed edit; the store freezes `auto` in response. */
  onEdit: (patch: Partial<Pick<TimelineOutput, 'width' | 'height' | 'fps'>>) => void;
  /** Separate from `onEdit` because sound is not part of the derived format:
   *  ticking the box must not freeze the frame size the way editing one does. */
  onKeepAudioChange: (keepAudio: boolean) => void;
  onMatchClips: () => void;
}

type Field = 'width' | 'height' | 'fps';

const INPUT_CLASS = 'w-[4.5rem] text-right tabular-nums outline-none';

export default function TimelineOutputFormat({
  output,
  onEdit,
  onKeepAudioChange,
  onMatchClips,
}: TimelineOutputFormatProps) {
  /**
   * The inputs are uncontrolled, and the whole control is keyed on the
   * committed format.
   *
   * Two things have to be true at once: a half-typed "19" on the way to "1920"
   * must not be clamped out from under the cursor, and a value changed from
   * *outside* — the auto recompute as clips arrive, or "match clips" — must
   * show up immediately. A controlled draft would need an effect syncing state
   * to props, which is the cascading-render pattern React specifically warns
   * against; remounting on the committed value does the same job with no state
   * of our own to keep in step.
   */
  const commit = (field: Field, input: HTMLInputElement) => {
    const raw = input.value;
    const current = output[field];
    const parsed = Number(raw);

    // Empty or nonsense is not an edit, it is a slip: put the committed value
    // back and leave `auto` alone rather than freezing the format on a typo.
    if (raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      input.value = String(current);
      return;
    }

    const next = field === 'fps' ? constrainFps(parsed) : constrainDimension(parsed);
    // Written back directly, because a constrained value that equals the
    // committed one leaves the key unchanged and so triggers no remount —
    // the field would otherwise keep showing the rejected 1921.
    input.value = String(next);

    // Compared against what was typed, not against the constrained result: a
    // hand-entered 1921 constrains back to 1920 and still counts as an edit
    // (the user meant to take control), while tabbing through a field without
    // touching it does not silently freeze the automatic format.
    if (raw !== String(current)) onEdit({ [field]: next });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  const field = (name: Field, label: string, step: string) => (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      min={name === 'fps' ? MIN_FPS : MIN_DIMENSION}
      max={name === 'fps' ? MAX_FPS : MAX_DIMENSION}
      step={step}
      defaultValue={String(output[name])}
      onBlur={(event: FocusEvent<HTMLInputElement>) => commit(name, event.currentTarget)}
      onKeyDown={onKeyDown}
      className={INPUT_CLASS}
    />
  );

  return (
    <div
      key={`${output.width}x${output.height}@${output.fps}`}
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.8125rem] text-[var(--foreground-muted)]"
    >
      <span className="flex items-center gap-1.5">
        <Settings2 size={13} className="text-[var(--foreground-subtle)]" aria-hidden />
        Output
      </span>
      {field('width', 'Output width', '2')}
      <span aria-hidden>×</span>
      {field('height', 'Output height', '2')}
      <span>@</span>
      {field('fps', 'Output frames per second', '1')}
      <span>fps</span>
      {output.auto ? (
        <span className="pill">auto</span>
      ) : (
        <button
          type="button"
          onClick={onMatchClips}
          className="text-[var(--neon-cyan)] underline-offset-2 hover:underline"
        >
          match clips
        </button>
      )}
      {/* A real checkbox, not a styled button: it is a two-state setting, and
          the native control is what gives it Space-to-toggle and a label that
          is already announced as "checkbox, checked". */}
      <label className="flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap">
        <input
          type="checkbox"
          checked={output.keepAudio}
          onChange={(event) => onKeepAudioChange(event.currentTarget.checked)}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--neon-cyan)]"
        />
        {output.keepAudio ? (
          <Volume2 size={13} className="text-[var(--foreground-subtle)]" aria-hidden />
        ) : (
          <VolumeX size={13} className="text-[var(--foreground-subtle)]" aria-hidden />
        )}
        Keep audio
      </label>
    </div>
  );
}
