// components/PromptHeader.tsx
import type { ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

/** The prompt panel's title row: the field's label, then its helpers. */
export function PromptHeader({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <label htmlFor={htmlFor} className="display block text-base font-semibold">
        Prompt
      </label>
      <div className="flex flex-wrap items-center justify-end gap-1.5">{children}</div>
    </div>
  );
}

/** The prompt header's one accent: asks for an example prompt to start from. */
export function GenExampleButton({
  busy,
  disabled = false,
  onClick,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--brand-accent)]/30 bg-[var(--brand-accent)]/10 px-2.5 py-1.5 text-xs font-medium text-[var(--brand-accent)] transition-colors hover:text-[var(--neon-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
      title="Generate an example prompt with the shared fast model, or your own Gemini key"
    >
      {busy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
      {busy ? 'Thinking…' : 'Gen Example'}
    </button>
  );
}
