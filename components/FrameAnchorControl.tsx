// components/FrameAnchorControl.tsx
'use client';

const CHOICES = [
  { value: 'auto', label: 'Automatic' },
  { value: 'first', label: 'First frame' },
  { value: 'last', label: 'Last frame' },
  { value: '0', label: 'Frame 0' },
  { value: '-1', label: 'Frame −1' },
  { value: 'timestamp', label: 'Timestamp' },
] as const;

export type FrameAnchorChoice = (typeof CHOICES)[number]['value'];

/** Where one reference image lands in the source clip. Automatic leaves the pin off the request. */
export default function FrameAnchorControl({
  index, choice, timestamp, onChange, disabled,
}: {
  index: number;
  choice: FrameAnchorChoice;
  timestamp: string;
  onChange: (next: { choice: FrameAnchorChoice; timestamp: string }) => void;
  disabled?: boolean;
}) {
  const label = `Anchor for image ${index + 1}`;
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
        <select
          aria-label={label}
          className="w-full"
          disabled={disabled}
          value={choice}
          onChange={(event) => onChange({ choice: event.target.value as FrameAnchorChoice, timestamp })}
        >
          {CHOICES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {choice === 'timestamp' && (
        <label className="block space-y-1.5">
          <span className="block text-xs text-[var(--foreground-muted)]">Seconds into the source</span>
          <input
            aria-label={`Timestamp for image ${index + 1}`}
            type="number"
            min={0}
            max={30}
            step={0.01}
            className="w-full"
            disabled={disabled}
            value={timestamp}
            onChange={(event) => onChange({ choice: 'timestamp', timestamp: event.target.value })}
          />
        </label>
      )}
    </div>
  );
}
