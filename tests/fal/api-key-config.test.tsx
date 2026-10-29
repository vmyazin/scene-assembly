import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Home from '../../app/page';
import ApiKeyConfig from '../../components/ApiKeyConfig';
import { useAppStore } from '../../store/useAppStore';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
// The studio forwards ?workspace=timeline to the editor's own route, so it
// asks for a router these suites never mount one for.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('nuqs', () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock('@/components/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/FeatureSelector', () => ({ default: () => null }));
vi.mock('@/components/VideoWorkspace', () => ({ default: () => null }));

const GENERIC_FAL_ERROR = 'Unable to validate your fal API key.';
const INVALID_FAL_KEY_ERROR =
  'Your fal API key is invalid, revoked, or lacks access to this model.';
const PUBLIC_FAL_ERRORS = [
  INVALID_FAL_KEY_ERROR,
  'Your fal account needs additional credits.',
  'fal rejected one or more model settings. Review the controls and try again.',
  'fal is rate limiting requests. Please wait and try again.',
  'fal is temporarily unavailable. Please try again.',
  'fal could not complete that request.',
  'Something went wrong while contacting fal.',
] as const;

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function ControlledApiKeyConfig({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen dialog
      </button>
      <ApiKeyConfig
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen);
          setOpen(nextOpen);
        }}
      />
    </>
  );
}

function setStoredKeys(overrides: Partial<ReturnType<typeof useAppStore.getState>> = {}) {
  useAppStore.setState({
    apiKey: '',
    kieApiKey: '',
    falApiKey: '',
    hasHydrated: true,
    ...overrides,
  });
}

describe('fal API connection', () => {
  beforeEach(() => {
    localStorage.clear();
    setStoredKeys();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('validates and saves a fal key without generating media', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      )
    );

    render(<ApiKeyConfig open onOpenChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('fal API key'), {
      target: { value: 'id:secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/fal/validate',
        expect.objectContaining({ method: 'POST' })
      )
    );
    expect(useAppStore.getState().falApiKey).toBe('id:secret');
  });

  it('sends the candidate only in the validation POST body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ApiKeyConfig open onOpenChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('fal API key'), {
      target: { value: '  id:secret  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/fal/validate');
    expect(url).not.toContain('id:secret');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'id:secret' }),
      })
    );
    expect(url).not.toMatch(/generate|upload|queue/);
  });

  it('validates a changed non-empty key before saving or closing', async () => {
    setStoredKeys({ falApiKey: 'old:secret' });
    let resolveValidation!: (response: Response) => void;
    const validation = new Promise<Response>((resolve) => {
      resolveValidation = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(validation);
    vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();

    render(<ApiKeyConfig open onOpenChange={onOpenChange} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'new:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().falApiKey).toBe('old:secret');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveValidation(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await waitFor(() => expect(useAppStore.getState().falApiKey).toBe('new:secret'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not revalidate an unchanged existing fal key', async () => {
    setStoredKeys({ falApiKey: 'id:secret' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();

    render(<ApiKeyConfig open onOpenChange={onOpenChange} />);
    await waitFor(() => expect(screen.getByLabelText('fal API key')).toHaveValue('id:secret'));
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().falApiKey).toBe('id:secret');
  });

  it('intentionally clears a saved fal key without validation', async () => {
    setStoredKeys({ falApiKey: 'id:secret' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();

    render(<ApiKeyConfig open onOpenChange={onOpenChange} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('id:secret'));
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().falApiKey).toBe('');
  });

  it.each([401, 403])(
    'keeps the previous key and shows a safe route error after a %s response',
    async (status) => {
      setStoredKeys({ falApiKey: 'old:secret' });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: INVALID_FAL_KEY_ERROR }), {
          status,
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      const onOpenChange = vi.fn();

      render(<ApiKeyConfig open onOpenChange={onOpenChange} />);
      const input = await screen.findByLabelText('fal API key');
      await waitFor(() => expect(input).toHaveValue('old:secret'));
      fireEvent.change(input, { target: { value: 'candidate:secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(INVALID_FAL_KEY_ERROR);
      expect(screen.queryByText('candidate:secret')).not.toBeInTheDocument();
      expect(useAppStore.getState().falApiKey).toBe('old:secret');
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    }
  );

  it.each(PUBLIC_FAL_ERRORS)('displays the known public fal error: %s', async (publicError) => {
    setStoredKeys({ falApiKey: 'old:secret' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: publicError }), { status: 400 })
      )
    );

    render(<ApiKeyConfig open onOpenChange={vi.fn()} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'candidate:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(publicError);
    expect(useAppStore.getState().falApiKey).toBe('old:secret');
  });

  it.each([
    ['invalid JSON', () => Promise.resolve(new Response('{not-json', { status: 200 }))],
    [
      'a malformed success response',
      () => Promise.resolve(new Response(JSON.stringify({ success: 'yes' }), { status: 200 })),
    ],
    [
      'a malformed error response',
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ success: false, error: { message: 'raw' } }), {
            status: 403,
          })
        ),
    ],
    ['a network exception', () => Promise.reject(new Error('candidate:secret leaked'))],
  ])('uses a stable safe error for %s', async (_label, fetchResult) => {
    setStoredKeys({ falApiKey: 'old:secret' });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(fetchResult));
    const onOpenChange = vi.fn();

    render(<ApiKeyConfig open onOpenChange={onOpenChange} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'candidate:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_FAL_ERROR);
    expect(screen.queryByText(/candidate:secret leaked/)).not.toBeInTheDocument();
    expect(useAppStore.getState().falApiKey).toBe('old:secret');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it.each([
    ['an overlong route error', `Rejected: ${'x'.repeat(201)}`],
    ['a route error containing the candidate', 'Rejected candidate:secret'],
    ['a route error containing part of the candidate', 'Rejected secret'],
    ['a route error containing the URL-encoded candidate', 'Rejected candidate%3Asecret'],
    ['an arbitrary short provider detail', 'Provider request ref 123 failed.'],
  ])('does not render %s', async (_label, routeError) => {
    setStoredKeys({ falApiKey: 'old:secret' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: routeError }), { status: 403 })
      )
    );

    render(<ApiKeyConfig open onOpenChange={vi.fn()} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'candidate:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_FAL_ERROR);
    expect(screen.queryByText(routeError)).not.toBeInTheDocument();
    expect(useAppStore.getState().falApiKey).toBe('old:secret');
  });

  it('reseeds from the saved fal key and clears validation errors when reopened', async () => {
    setStoredKeys({ falApiKey: 'old:secret' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: INVALID_FAL_KEY_ERROR }), {
          status: 401,
        })
      )
    );
    const onOpenChange = vi.fn();
    const { rerender } = render(<ApiKeyConfig open onOpenChange={onOpenChange} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'candidate:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    rerender(<ApiKeyConfig open={false} onOpenChange={onOpenChange} />);
    rerender(<ApiKeyConfig open onOpenChange={onOpenChange} />);

    await waitFor(() => expect(screen.getByLabelText('fal API key')).toHaveValue('old:secret'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reveals and hides the fal key accessibly without rendering it as text', async () => {
    setStoredKeys({ falApiKey: 'id:secret' });
    render(<ApiKeyConfig open onOpenChange={vi.fn()} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('id:secret'));

    expect(input).toHaveAttribute('type', 'password');
    expect(document.body.textContent).not.toContain('id:secret');
    fireEvent.click(screen.getByRole('button', { name: 'Show fal key' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide fal key' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('id:secret');
    fireEvent.click(screen.getByRole('button', { name: 'Hide fal key' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('prevents duplicate fal validation while a request is pending', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    render(<ApiKeyConfig open onOpenChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('fal API key'), {
      target: { value: 'id:secret' },
    });
    const saveButton = screen.getByRole('button', { name: 'Save & close' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Validating…' })).toBeDisabled();
  });

  it('does not save or close after validation finishes on an unmounted dialog', async () => {
    setStoredKeys({ falApiKey: 'old:secret' });
    let resolveValidation!: (response: Response) => void;
    const validation = new Promise<Response>((resolve) => {
      resolveValidation = resolve;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(validation));
    const onOpenChange = vi.fn();

    const { unmount } = render(<ApiKeyConfig open onOpenChange={onOpenChange} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'new:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      resolveValidation(new Response(JSON.stringify({ success: true }), { status: 200 }));
      await validation;
    });

    expect(useAppStore.getState().falApiKey).toBe('old:secret');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('cancels validation when the controlled dialog closes', async () => {
    setStoredKeys({ falApiKey: 'old:secret' });
    const validation = deferredResponse();
    const fetchMock = vi.fn().mockReturnValue(validation.promise);
    vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();

    render(<ControlledApiKeyConfig onOpenChange={onOpenChange} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'new:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal | undefined;

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    await act(async () => {
      validation.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      await validation.promise;
    });

    expect(useAppStore.getState().falApiKey).toBe('old:secret');
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    ['success', new Response(JSON.stringify({ success: true }), { status: 200 })],
    [
      'error',
      new Response(JSON.stringify({ success: false, error: INVALID_FAL_KEY_ERROR }), {
        status: 401,
      }),
    ],
  ])('ignores an old %s response after the dialog closes and reopens', async (_kind, response) => {
    setStoredKeys({ falApiKey: 'old:secret' });
    const validation = deferredResponse();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(validation.promise));
    const onOpenChange = vi.fn();

    render(<ControlledApiKeyConfig onOpenChange={onOpenChange} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'stale:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen dialog' }));

    const reopenedInput = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(reopenedInput).toHaveValue('old:secret'));
    const reopenedSaveButton = screen.getByRole('button', {
      name: /Save & close|Validating…/,
    });
    const reopenedWasUsable =
      reopenedSaveButton.textContent === 'Save & close' && !reopenedSaveButton.hasAttribute('disabled');

    await act(async () => {
      validation.resolve(response);
      await validation.promise;
    });

    expect(reopenedWasUsable).toBe(true);
    expect(screen.getByLabelText('fal API key')).toHaveValue('old:secret');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(useAppStore.getState().falApiKey).toBe('old:secret');
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('lets only the new operation save after close and reopen', async () => {
    setStoredKeys({ falApiKey: 'old:secret' });
    const oldValidation = deferredResponse();
    const newValidation = deferredResponse();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldValidation.promise)
      .mockReturnValueOnce(newValidation.promise);
    vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();

    render(<ControlledApiKeyConfig onOpenChange={onOpenChange} />);
    const input = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(input).toHaveValue('old:secret'));
    fireEvent.change(input, { target: { value: 'stale:secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & close' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen dialog' }));

    const reopenedInput = await screen.findByLabelText('fal API key');
    await waitFor(() => expect(reopenedInput).toHaveValue('old:secret'));
    fireEvent.change(reopenedInput, { target: { value: 'fresh:secret' } });
    fireEvent.click(screen.getByRole('button', { name: /Save & close|Validating…/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      oldValidation.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      await oldValidation.promise;
    });
    expect(useAppStore.getState().falApiKey).toBe('old:secret');
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Validating…' })).toBeDisabled();

    await act(async () => {
      newValidation.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      await newValidation.promise;
    });
    await waitFor(() => expect(useAppStore.getState().falApiKey).toBe('fresh:secret'));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it.each([
    ['Gemini', { apiKey: 'gemini-key' }],
    ['Kie', { kieApiKey: 'kie-key' }],
    ['fal', { falApiKey: 'fal-key' }],
  ])('treats a saved %s key as a connected API key', async (_provider, keyState) => {
    setStoredKeys(keyState);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    render(<Home />);

    expect(await screen.findByTitle('Manage provider connections')).toBeInTheDocument();
  });
});
