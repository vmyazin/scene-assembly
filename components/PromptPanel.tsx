'use client';

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';

const REPEAT_DELAY_MS = 5_000;

interface PromptPanelProps {
  children: ReactNode;
  className?: string;
  /**
   * There is already a prompt written, so stop inviting one.
   *
   * The runner is an ambient "type something here". Once something is typed it
   * has nothing left to say, and a lap of cyan circling a person's own sentence
   * is decoration over the thing they are reading.
   *
   * A prop rather than the panel watching its own textarea, even though it
   * already reaches into children for focus: a prompt restored from the draft
   * store arrives as a React value change and fires no `input` event, so a
   * panel that learned only from typing would animate over a prompt it could
   * not see.
   */
  hasPrompt?: boolean;
}

function isTextarea(target: EventTarget | null): target is HTMLTextAreaElement {
  return target instanceof HTMLTextAreaElement;
}

export default function PromptPanel({
  children,
  className = '',
  hasPrompt = false,
}: PromptPanelProps) {
  const quiet = hasPrompt;
  const [runnerVisible, setRunnerVisible] = useState(!quiet);
  const textareaFocusedRef = useRef(false);
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRepeatTimer = () => {
    if (repeatTimerRef.current === null) return;
    clearTimeout(repeatTimerRef.current);
    repeatTimerRef.current = null;
  };

  const scheduleRepeat = () => {
    clearRepeatTimer();
    repeatTimerRef.current = setTimeout(() => {
      repeatTimerRef.current = null;
      if (!textareaFocusedRef.current) setRunnerVisible(true);
    }, REPEAT_DELAY_MS);
  };

  useEffect(() => () => {
    if (repeatTimerRef.current !== null) clearTimeout(repeatTimerRef.current);
  }, []);


  // Adjusted during render rather than in an effect: going quiet stops the
  // current lap and any pending repeat, and coming back hands the panel one
  // fresh lap, so emptying the box brings the invitation back.
  const [wasQuiet, setWasQuiet] = useState(quiet);
  if (wasQuiet !== quiet) {
    setWasQuiet(quiet);
    // A repeat timer already in flight needs no cancelling: the runner cannot
    // render while quiet, and coming back sets it visible anyway.
    setRunnerVisible(!quiet);
  }

  const handleAnimationEnd = () => {
    setRunnerVisible(false);
    if (!textareaFocusedRef.current && repeatTimerRef.current === null) {
      scheduleRepeat();
    }
  };

  const handleFocusCapture = (event: FocusEvent<HTMLElement>) => {
    if (!isTextarea(event.target)) return;
    textareaFocusedRef.current = true;
    clearRepeatTimer();
  };

  const handleBlurCapture = (event: FocusEvent<HTMLElement>) => {
    if (!isTextarea(event.target)) return;
    textareaFocusedRef.current = false;
    scheduleRepeat();
  };

  return (
    <section
      data-testid="prompt-panel"
      className={`prompt-panel relative p-3.5 md:p-4 ${className}`.trim()}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      {runnerVisible && !quiet && (
        <svg
          aria-hidden="true"
          focusable="false"
          className="prompt-panel-border-runner"
        >
          <rect
            data-testid="prompt-panel-runner"
            className="prompt-panel-border-runner-track"
            x="1"
            y="1"
            width="calc(100% - 2px)"
            height="calc(100% - 2px)"
            rx="11"
            pathLength="100"
            vectorEffect="non-scaling-stroke"
            onAnimationEnd={handleAnimationEnd}
          />
        </svg>
      )}
      <div className="relative z-[1] space-y-3">{children}</div>
    </section>
  );
}
