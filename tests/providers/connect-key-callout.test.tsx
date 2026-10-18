import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import { KEY_SOURCES } from '@/lib/providers/key-source';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  useProviderJobsStore.getState().clearJobs();
  useDraftStore.setState({ prompt: '', references: [], controlValues: {} });
  useAppStore.setState({ atlasApiKey: '' });
});

function renderAtlas(onOpenConnections = () => undefined) {
  return render(
    <ProviderVideoWorkspace
      provider="atlas"
      label="Atlas Cloud"
      inputMode="image"
      onBack={() => undefined}
      onOpenConnections={onOpenConnections}
    />
  );
}

/**
 * Without a key every control on the page is inert, so the workspace has to say
 * so up front rather than letting someone fill in a prompt and a reference only
 * to be refused at submit.
 */
describe('the not-connected callout', () => {
  it('names the provider and both routes to a key while none is set', () => {
    renderAtlas();

    expect(
      screen.getByRole('heading', { name: /add your atlas cloud key/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect key' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /atlascloud\.ai\/console\/api-keys/i })).toHaveAttribute(
      'href',
      KEY_SOURCES.atlas.href
    );
  });

  it('is the only visible call to action while the key is missing', () => {
    renderAtlas();

    // The header's own connect button steps aside so the same ask is not made
    // twice, two rows apart.
    expect(screen.queryByRole('button', { name: /Connect Atlas Cloud key/i })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button').filter((button) => /^connect/i.test(button.textContent ?? ''))
    ).toHaveLength(1);
  });

  it('hands the header back its status button once connected', () => {
    useAppStore.setState({ atlasApiKey: 'atlas-key' });
    renderAtlas();

    expect(screen.getByRole('button', { name: 'Atlas Cloud key connected' })).toBeInTheDocument();
  });

  it('opens the connections dialog from its call to action', async () => {
    const onOpenConnections = vi.fn();
    renderAtlas(onOpenConnections);

    await userEvent.click(screen.getByRole('button', { name: 'Connect key' }));

    expect(onOpenConnections).toHaveBeenCalledOnce();
  });

  it('goes away once the key is there', () => {
    useAppStore.setState({ atlasApiKey: 'atlas-key' });
    const { container } = renderAtlas();

    expect(screen.queryByText(/not connected/i)).not.toBeInTheDocument();
    expect(container.querySelector('[inert]')).toBeNull();
  });
});

/**
 * The controls below the callout submit to a provider that will refuse them, so
 * they are dimmed and made inert rather than left looking live.
 */
describe('the gated workspace below it', () => {
  it('is inert while the key is missing', () => {
    const { container } = renderAtlas();

    const gate = container.querySelector('[inert]');
    expect(gate).not.toBeNull();
    expect(gate).toContainElement(screen.getByRole('button', { name: /generate video/i }));
    expect(gate).not.toContainElement(screen.getByRole('button', { name: 'Connect key' }));
  });

  it('sends a click anywhere in the dimmed area to the key dialog', async () => {
    const onOpenConnections = vi.fn();
    renderAtlas(onOpenConnections);

    await userEvent.click(
      screen.getByRole('button', { name: 'Connect your Atlas Cloud key to use these controls' })
    );

    expect(onOpenConnections).toHaveBeenCalledOnce();
  });

  it('stills the prompt panel runner rather than animating a disabled control', () => {
    renderAtlas();

    expect(screen.queryByTestId('prompt-panel-runner')).not.toBeInTheDocument();
  });

  it('stays usable when a finished job is still on screen without a key', () => {
    useProviderJobsStore.getState().startJob({
      provider: 'atlas',
      taskId: 'task-1',
      modelId: 'bytedance/seedance-v1-pro-fast',
      prompt: 'a cat walking',
      inputMode: 'image',
      controlValues: {},
      state: 'success',
      urls: ['https://example.com/clip.mp4'],
    });
    const { container } = renderAtlas();

    // The callout still asks for a key — a new generation is impossible — but the
    // result rail stays reachable so the clip can still be downloaded.
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(container.querySelector('[inert]')).toBeNull();
  });
});
