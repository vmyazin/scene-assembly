import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ResultMeta from '@/components/ResultMeta';
import { formatRelativeTime } from '@/lib/results/meta';

const NOW = new Date('2026-09-17T14:32:00Z').getTime();

/**
 * A result used to say nothing about itself, so comparing two runs meant
 * remembering which model was selected when each was fired. These are the rules
 * that keep the footer honest about what each panel actually knows.
 */
describe('ResultMeta', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the whole record when the panel knows it', () => {
    render(
      <ResultMeta
        provider="gemini"
        modelId="nano-banana-pro"
        width={1024}
        height={1536}
        cost={0.039}
        startedAt={NOW - 48_000}
        finishedAt={NOW}
        createdAt={NOW}
      />
    );

    expect(screen.getByText('gemini')).toBeInTheDocument();
    expect(screen.getByText('nano-banana-pro')).toBeInTheDocument();
    expect(screen.getByText('1024×1536')).toBeInTheDocument();
    expect(screen.getByText('$0.0390')).toBeInTheDocument();
    expect(screen.getByText('took 48s')).toBeInTheDocument();
  });

  /**
   * The account panel loses the duration when its job row is dismissed, and Kie
   * reports no per-task cost at all. A row of placeholder dashes would make an
   * incomplete record look like a broken one.
   */
  it('drops a fact it was not told rather than blanking it', () => {
    render(<ResultMeta provider="kie" modelId="seedream-4" createdAt={NOW} />);

    expect(screen.getByText('seedream-4')).toBeInTheDocument();
    expect(screen.queryByText(/took/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it('renders nothing at all when it knows nothing', () => {
    const { container } = render(<ResultMeta />);
    expect(container).toBeEmptyDOMElement();
  });

  /** `took 0s` reads as a measurement; a missing one should read as missing. */
  it('withholds a duration that did not measure anything', () => {
    render(<ResultMeta modelId="flux" startedAt={NOW} finishedAt={NOW} createdAt={NOW} />);
    expect(screen.queryByText(/took/)).not.toBeInTheDocument();
  });

  it('omits a half-known pixel size', () => {
    render(<ResultMeta modelId="flux" width={1024} createdAt={NOW} />);
    expect(screen.queryByText(/1024/)).not.toBeInTheDocument();
  });

  /** The rough label is the one on screen; the exact moment is the tooltip. */
  it('pairs a rough age with the exact moment behind it', () => {
    render(<ResultMeta modelId="flux" createdAt={NOW - 7 * 60_000} />);

    const when = screen.getByText('7m ago');
    expect(when.tagName).toBe('TIME');
    expect(when).toHaveAttribute('dateTime', new Date(NOW - 7 * 60_000).toISOString());
    expect(when.getAttribute('title')).toBeTruthy();
    expect(when.getAttribute('title')).not.toBe('7m ago');
  });

  it('falls back to the finish time when no created time is given', () => {
    render(<ResultMeta modelId="flux" startedAt={NOW - 90_000} finishedAt={NOW - 30_000} />);
    expect(screen.getByText('took 1:00')).toBeInTheDocument();
    expect(screen.getByText('30s ago')).toBeInTheDocument();
  });
});

describe('formatRelativeTime', () => {
  /**
   * The card appears the moment the job finishes, so a counter starting at zero
   * draws the eye to the clock instead of the image that just arrived.
   */
  it('stays quiet for the first few seconds', () => {
    expect(formatRelativeTime(0)).toBe('just now');
    expect(formatRelativeTime(9)).toBe('just now');
  });

  it('steps up through seconds, minutes, hours and days', () => {
    expect(formatRelativeTime(10)).toBe('10s ago');
    expect(formatRelativeTime(59)).toBe('59s ago');
    expect(formatRelativeTime(60)).toBe('1m ago');
    expect(formatRelativeTime(59 * 60)).toBe('59m ago');
    expect(formatRelativeTime(60 * 60)).toBe('1h ago');
    expect(formatRelativeTime(23 * 3600)).toBe('23h ago');
    expect(formatRelativeTime(24 * 3600)).toBe('1d ago');
    expect(formatRelativeTime(9 * 24 * 3600)).toBe('9d ago');
  });

  it('does not trust a nonsense age', () => {
    expect(formatRelativeTime(Number.NaN)).toBe('just now');
    expect(formatRelativeTime(-5)).toBe('just now');
  });
});
