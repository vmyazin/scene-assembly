import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  AUTO_RETRY_DELAY_SECONDS,
  AUTO_RETRY_LIMIT,
  isRetryableFailure,
  useAutoRetry,
} from '../../lib/providers/auto-retry';

const failure = (status: number) => Object.assign(new Error('Kie failed'), { status });

describe('isRetryableFailure', () => {
  it.each([408, 425, 429, 500, 502, 503, 504])('retries a transient %i', (status) => {
    expect(isRetryableFailure(failure(status))).toBe(true);
  });

  it.each([400, 401, 402, 403, 404, 422])('never retries a settled %i', (status) => {
    expect(isRetryableFailure(failure(status))).toBe(false);
  });

  it('retries a request that never left the machine', () => {
    expect(isRetryableFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('leaves an unlabelled failure alone', () => {
    expect(isRetryableFailure(new Error('Kie did not return a task ID.'))).toBe(false);
  });

  it('does not retry a content-policy or floor refusal even when the status is 500', () => {
    expect(isRetryableFailure(Object.assign(new Error('blocked by content policy'), { status: 500 }))).toBe(false);
    expect(
      isRetryableFailure(
        Object.assign(
          new Error(
            "Scene Assembly doesn't generate this (minors in a suggestive context / sexualized real people). Relaxed filter doesn't change this."
          ),
          { status: 500 }
        )
      )
    ).toBe(false);
  });
});

function Harness({ action }: { action: () => void }) {
  const retry = useAutoRetry();
  return (
    <div>
      <button type="button" onClick={() => retry.schedule(action)}>schedule</button>
      <button type="button" onClick={retry.cancel}>cancel</button>
      <button type="button" onClick={retry.reset}>reset</button>
      <p data-testid="pending">
        {retry.pending ? `${retry.pending.attempt}:${retry.pending.secondsRemaining}` : 'idle'}
      </p>
    </div>
  );
}

describe('useAutoRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const click = async (name: string) => {
    await act(async () => {
      screen.getByRole('button', { name }).click();
    });
  };
  const tick = async (seconds: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(seconds * 1_000);
    });
  };

  it('counts down and runs the action once', async () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    await click('schedule');
    expect(screen.getByTestId('pending').textContent).toBe(`1:${AUTO_RETRY_DELAY_SECONDS}`);

    await tick(3);
    expect(screen.getByTestId('pending').textContent).toBe(`1:${AUTO_RETRY_DELAY_SECONDS - 3}`);
    expect(action).not.toHaveBeenCalled();

    await tick(AUTO_RETRY_DELAY_SECONDS);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByTestId('pending').textContent).toBe('idle');
  });

  it('stops the countdown when cancelled', async () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    await click('schedule');
    await tick(4);
    await click('cancel');

    expect(screen.getByTestId('pending').textContent).toBe('idle');
    await tick(AUTO_RETRY_DELAY_SECONDS * 2);
    expect(action).not.toHaveBeenCalled();
  });

  it('spends a budget of five attempts, and reset hands it back', async () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    for (let attempt = 1; attempt <= AUTO_RETRY_LIMIT; attempt += 1) {
      await click('schedule');
      expect(screen.getByTestId('pending').textContent).toBe(`${attempt}:${AUTO_RETRY_DELAY_SECONDS}`);
      await tick(AUTO_RETRY_DELAY_SECONDS);
    }
    expect(action).toHaveBeenCalledTimes(AUTO_RETRY_LIMIT);

    await click('schedule');
    expect(screen.getByTestId('pending').textContent).toBe('idle');
    await tick(AUTO_RETRY_DELAY_SECONDS);
    expect(action).toHaveBeenCalledTimes(AUTO_RETRY_LIMIT);

    await click('reset');
    await click('schedule');
    expect(screen.getByTestId('pending').textContent).toBe(`1:${AUTO_RETRY_DELAY_SECONDS}`);
  });

  it('never fires after the countdown is unmounted', async () => {
    const action = vi.fn();
    const view = render(<Harness action={action} />);

    await click('schedule');
    view.unmount();
    await tick(AUTO_RETRY_DELAY_SECONDS * 2);

    expect(action).not.toHaveBeenCalled();
  });
});
