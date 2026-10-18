import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FalGenerationWorkspace from '@/components/FalGenerationWorkspace';
import KieGenerationWorkspace from '@/components/KieGenerationWorkspace';
import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useFalJobsStore } from '@/store/useFalJobsStore';
import { useKieJobsStore } from '@/store/useKieJobsStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/kie/browser', () => ({ submitKieJob: vi.fn(), uploadKieFiles: vi.fn() }));
vi.mock('@/lib/fal/browser', () => ({
  cancelFalJob: vi.fn(),
  submitFalJob: vi.fn(),
  uploadFalFiles: vi.fn(),
}));

/**
 * Kie and fal used to answer "no key yet" differently from the aggregators —
 * one dimmed nothing, the other only put a button in its header — so switching
 * providers meant relearning the page. These assert the one shared answer.
 */
const WORKSPACES = [
  {
    name: 'Runware',
    label: 'Runware',
    render: () => (
      <ProviderVideoWorkspace
        provider="runware"
        label="Runware"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    ),
  },
  {
    name: 'Kie.ai',
    label: 'Kie.ai',
    render: () => (
      <KieGenerationWorkspace
        mediaType="video"
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    ),
  },
  {
    name: 'fal.ai',
    label: 'fal.ai',
    render: () => (
      <FalGenerationWorkspace
        inputMode="text"
        onBack={() => undefined}
        onOpenConnections={() => undefined}
      />
    ),
  },
] as const;

beforeEach(() => {
  useProviderJobsStore.getState().clearJobs();
  useKieJobsStore.getState().clearJobs();
  useFalJobsStore.getState().clearJobs();
  useDraftStore.setState({ prompt: '', references: [], controlValues: {} });
  useAppStore.setState({ runwareApiKey: '', kieApiKey: '', falApiKey: '' });
});

describe.each(WORKSPACES)('$name with no key', ({ label, render: renderWorkspace }) => {
  it('shows the shared not-connected callout as its only call to action', () => {
    const { container } = render(renderWorkspace());

    expect(
      screen.getByRole('heading', { name: `Add your ${label} key` })
    ).toBeInTheDocument();
    // The header's own connect button steps aside, so the ask is made once.
    expect(
      [...container.querySelectorAll('button')].filter((button) =>
        /^connect/i.test(button.textContent ?? '')
      )
    ).toHaveLength(1);
  });

  it('dims and disables the controls, with the whole area opening the dialog', () => {
    const { container } = render(renderWorkspace());

    const gate = container.querySelector('[inert]');
    expect(gate).not.toBeNull();
    expect(gate).toHaveClass('pointer-events-none', 'opacity-[0.42]');
    expect(
      screen.getByRole('button', { name: `Connect your ${label} key to use these controls` })
    ).toBeInTheDocument();
  });

  it('stills the prompt panel runner', () => {
    render(renderWorkspace());

    expect(screen.queryByTestId('prompt-panel-runner')).not.toBeInTheDocument();
  });
});

describe.each(WORKSPACES)('$name with a key', ({ label, render: renderWorkspace }) => {
  it('drops the callout and the gate, and names the connected provider in the header', () => {
    useAppStore.setState({ runwareApiKey: 'k', kieApiKey: 'k', falApiKey: 'k' });
    const { container } = render(renderWorkspace());

    expect(screen.queryByText(/not connected/i)).not.toBeInTheDocument();
    expect(container.querySelector('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: `${label} key connected` })).toBeInTheDocument();
  });
});
