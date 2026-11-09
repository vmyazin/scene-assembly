import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PromptPanel from '@/components/PromptPanel';

function finishRunnerLap(element: Element) {
  fireEvent(element, new Event('webkitAnimationEnd', { bubbles: true }));
}

function renderPanel() {
  return render(
    <PromptPanel>
      <label htmlFor="prompt-panel-test">Prompt</label>
      <button type="button">Gen Example</button>
      <textarea id="prompt-panel-test" />
    </PromptPanel>
  );
}

describe('PromptPanel', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('plays once, stays quiet for five seconds, then repeats', () => {
    renderPanel();
    const runner = screen.getByTestId('prompt-panel-runner');

    finishRunnerLap(runner);
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();

    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('prompt-panel-runner')).toBeInTheDocument();
  });

  it('finishes the current lap but suppresses repeats while the textarea is focused', () => {
    renderPanel();
    const prompt = screen.getByLabelText('Prompt');
    const runner = screen.getByTestId('prompt-panel-runner');

    fireEvent.focus(prompt);
    expect(runner).toBeInTheDocument();
    finishRunnerLap(runner);

    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();
  });

  it('cancels a queued repeat when the textarea receives focus during the pause', () => {
    renderPanel();
    finishRunnerLap(screen.getByTestId('prompt-panel-runner'));

    fireEvent.focus(screen.getByLabelText('Prompt'));
    act(() => vi.advanceTimersByTime(5_000));

    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();
  });

  it('waits a fresh five seconds after textarea blur', () => {
    renderPanel();
    const prompt = screen.getByLabelText('Prompt');
    fireEvent.focus(prompt);
    finishRunnerLap(screen.getByTestId('prompt-panel-runner'));
    fireEvent.blur(prompt);

    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('prompt-panel-runner')).toBeInTheDocument();
  });

  it('starts the fresh blur wait even when the current lap is still running', () => {
    renderPanel();
    const prompt = screen.getByLabelText('Prompt');

    fireEvent.focus(prompt);
    fireEvent.blur(prompt);
    act(() => vi.advanceTimersByTime(1_000));
    finishRunnerLap(screen.getByTestId('prompt-panel-runner'));

    act(() => vi.advanceTimersByTime(3_999));
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('prompt-panel-runner')).toBeInTheDocument();
  });

  it('does not gate repeats when a non-textarea control receives focus', () => {
    renderPanel();
    finishRunnerLap(screen.getByTestId('prompt-panel-runner'));
    fireEvent.focus(screen.getByRole('button', { name: 'Gen Example' }));

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByTestId('prompt-panel-runner')).toBeInTheDocument();
  });

  it('never runs while a prompt is already written', () => {
    // The runner is an invitation to type; with something typed it has nothing
    // left to say, and a lap around a person's own sentence is decoration.
    render(
      <PromptPanel hasPrompt>
        <textarea id="p" defaultValue="a rainy neon arcade" />
      </PromptPanel>
    );
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();

    // Not merely a suppressed first lap: no repeat arrives later either.
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();
  });

  it('goes quiet the moment a prompt is written, mid-lap', () => {
    const { rerender } = render(
      <PromptPanel>
        <textarea id="p" />
      </PromptPanel>
    );
    expect(screen.getByTestId('prompt-panel-runner')).toBeInTheDocument();

    rerender(
      <PromptPanel hasPrompt>
        <textarea id="p" defaultValue="x" />
      </PromptPanel>
    );
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();
  });

  it('brings the invitation back when the box is emptied', () => {
    const { rerender } = render(
      <PromptPanel hasPrompt>
        <textarea id="p" defaultValue="x" />
      </PromptPanel>
    );
    expect(screen.queryByTestId('prompt-panel-runner')).toBeNull();

    rerender(
      <PromptPanel>
        <textarea id="p" />
      </PromptPanel>
    );
    expect(screen.getByTestId('prompt-panel-runner')).toBeInTheDocument();
  });

  it('clears the queued repeat when unmounted', () => {
    const view = renderPanel();
    finishRunnerLap(screen.getByTestId('prompt-panel-runner'));
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
