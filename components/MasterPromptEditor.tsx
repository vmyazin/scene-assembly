'use client';

import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import {
  PROMPT_TOKEN,
  REFERENCES_TOKEN,
  defaultMasterPrompt,
} from '@/lib/image/feature-prompt';
import { resolveMasterPrompt, useMasterPromptStore } from '@/store/useMasterPromptStore';

interface MasterPromptEditorProps {
  featureId: string;
  imageCount: number;
}

/**
 * Shows the instruction this mode wraps around the prompt, and lets the
 * session edit it. Collapsed by default: most runs never need it, and the
 * thumbnail template alone is taller than the prompt box it sits under.
 */
export default function MasterPromptEditor({ featureId, imageCount }: MasterPromptEditorProps) {
  const override = useMasterPromptStore((state) => state.overrides[featureId]);
  const setOverride = useMasterPromptStore((state) => state.setOverride);
  const resetOverride = useMasterPromptStore((state) => state.resetOverride);
  const templateId = useId();
  const whenEmptyId = useId();
  const warningId = useId();
  // The fields mount only while open, so a closed editor adds no second
  // textbox beside the prompt for keyboard and screen-reader users to land on.
  const [open, setOpen] = useState(false);

  const builtIn = defaultMasterPrompt(featureId, imageCount);
  const master = resolveMasterPrompt(featureId, imageCount, override);
  // Compared rather than read off `override`, so typing the original back
  // stops calling it edited.
  const edited = master.template !== builtIn.template || master.whenEmpty !== builtIn.whenEmpty;
  const dropsPrompt = !master.template.includes(PROMPT_TOKEN);

  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group border-t border-[var(--border)] pt-2 text-xs text-[var(--foreground-muted)]">
      <summary className="flex cursor-pointer select-none items-center gap-2 py-1 text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-cyan-300">
        <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open:rotate-90" />
        Master prompt
        {edited && (
          <span className="whitespace-nowrap rounded-full border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-2 py-0.5 text-[0.7rem] font-medium text-[var(--brand-accent)]">
            Edited for this session
          </span>
        )}
      </summary>

      {open && <div className="mt-2 space-y-3">
        <p>
          Wraps what you type before it is sent. <code>{PROMPT_TOKEN}</code> is your prompt
          {(builtIn.template.includes(REFERENCES_TOKEN) || master.template.includes(REFERENCES_TOKEN)) && (
            <>; <code>{REFERENCES_TOKEN}</code> says what each attached image is for</>
          )}
          . Edits apply to this mode until you reload.
        </p>

        <div className="space-y-1">
          <label htmlFor={templateId} className="font-semibold text-[var(--foreground)]">Template</label>
          <textarea
            id={templateId}
            value={master.template}
            onChange={(event) => setOverride(featureId, 'template', event.target.value)}
            rows={Math.min(14, master.template.split('\n').length + 1)}
            spellCheck={false}
            aria-invalid={dropsPrompt ? true : undefined}
            aria-describedby={dropsPrompt ? warningId : undefined}
            className="w-full resize-y font-mono text-xs"
          />
          {dropsPrompt && (
            <p id={warningId} role="alert" className="text-[var(--brand-accent)]">
              Without <code>{PROMPT_TOKEN}</code>, what you type in the prompt box is not sent.
            </p>
          )}
        </div>

        {master.whenEmpty !== undefined && (
          <div className="space-y-1">
            <label htmlFor={whenEmptyId} className="font-semibold text-[var(--foreground)]">
              Sent when the prompt box is empty
            </label>
            <textarea
              id={whenEmptyId}
              value={master.whenEmpty}
              onChange={(event) => setOverride(featureId, 'whenEmpty', event.target.value)}
              rows={3}
              className="w-full resize-y text-xs"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => resetOverride(featureId)}
          disabled={!edited}
          className="text-sky-200 underline underline-offset-4 disabled:cursor-not-allowed disabled:text-[var(--foreground-subtle)] disabled:no-underline"
        >
          Restore the built-in master prompt
        </button>
      </div>}
    </details>
  );
}
