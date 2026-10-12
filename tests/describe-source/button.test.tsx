// tests/describe-source/button.test.tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DescribeSourceButton from '@/components/DescribeSourceButton';
import { requestSourceDescription } from '@/lib/describe-source/browser';
import { describeOmittedNotice } from '@/lib/describe-source/errors';

import { DESCRIPTION } from './paragraph';

vi.mock('@/lib/describe-source/browser', () => ({
  requestSourceDescription: vi.fn(),
}));

function deferred() {
  let resolve: (result: { prompt: string; omitted: string[] }) => void = () => undefined;
  const promise = new Promise<{ prompt: string; omitted: string[] }>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: (result: { prompt: string; omitted: string[] }) => resolve(result) };
}

describe('DescribeSourceButton', () => {
  beforeEach(() => {
    vi.mocked(requestSourceDescription).mockReset();
  });

  it('aborts the fetch when the source changes and does not write the old description', async () => {
    const first = new File(['a'], 'a.png', { type: 'image/png' });
    const second = new File(['b'], 'b.png', { type: 'image/png' });
    const pending = deferred();
    let signal: AbortSignal | undefined;
    vi.mocked(requestSourceDescription).mockImplementation((_sources, _apiKey, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const onPrompt = vi.fn();
    const view = render(
      <DescribeSourceButton
        sources={[{ file: first, label: 'Image 1' }]}
        apiKey="gemini-key"
        prompt=""
        onPrompt={onPrompt}
        onError={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Describe source' }));
    view.rerender(
      <DescribeSourceButton
        sources={[{ file: second, label: 'Image 2' }]}
        apiKey="gemini-key"
        prompt=""
        onPrompt={onPrompt}
        onError={vi.fn()}
      />
    );

    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve({ prompt: DESCRIPTION, omitted: [] });
    });
    expect(onPrompt).not.toHaveBeenCalled();
  });

  it('aborts the fetch on unmount', () => {
    const pending = deferred();
    let signal: AbortSignal | undefined;
    vi.mocked(requestSourceDescription).mockImplementation((_sources, _apiKey, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const view = render(
      <DescribeSourceButton
        sources={[{ file: new File(['a'], 'a.png', { type: 'image/png' }), label: 'Image 1' }]}
        apiKey=""
        prompt=""
        onPrompt={vi.fn()}
        onError={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Describe source' }));
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('names a source that was left out', async () => {
    vi.mocked(requestSourceDescription).mockResolvedValue({ prompt: DESCRIPTION, omitted: ['Image 6'] });
    const onPrompt = vi.fn();
    const onNotice = vi.fn();
    render(
      <DescribeSourceButton
        sources={[{ file: new File(['a'], 'a.png', { type: 'image/png' }), label: 'Image 1' }]}
        apiKey=""
        prompt=""
        onPrompt={onPrompt}
        onError={vi.fn()}
        onNotice={onNotice}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Describe source' }));
    expect(await screen.findByRole('button', { name: 'Describe source' })).toBeEnabled();
    expect(onPrompt).toHaveBeenCalledWith(DESCRIPTION);
    expect(onNotice).toHaveBeenCalledWith(describeOmittedNotice(['Image 6']));
  });
});
