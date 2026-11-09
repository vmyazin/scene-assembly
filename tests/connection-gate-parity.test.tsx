import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FalGenerationWorkspace from '@/components/FalGenerationWorkspace';
import GeminiVideoWorkspace from '@/components/GeminiVideoWorkspace';
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
      screen.getByRole('heading', { name: `Generating needs your own ${label} API key` })
    ).toBeInTheDocument();
    // The header's own connect button steps aside, so the ask is made once.
    expect(
      [...container.querySelectorAll('button')].filter((button) =>
        /^connect/i.test(button.textContent ?? '')
      )
    ).toHaveLength(1);
  });

  it('leaves the prompt and controls usable, so a visitor can write first', () => {
    const { container } = render(renderWorkspace());

    expect(container.querySelector('[inert]')).toBeNull();
    expect(screen.queryByRole('button', { name: `Connect your ${label} key to use these controls` })).toBeNull();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A paper city' } });
    expect(useDraftStore.getState().prompt).toBe('A paper city');
  });

  it('keeps inviting a prompt until one is written', () => {
    render(renderWorkspace());

    expect(screen.getByTestId('prompt-panel-runner')).toBeInTheDocument();
  });

  it('keeps Generate short and disabled, with or without a prompt, described by the key prompt', () => {
    render(renderWorkspace());

    const expectDisabled = () => {
      const generate = screen.getByRole('button', { name: /^Generate video/ });
      expect(generate).toBeDisabled();
      expect(generate).toHaveAccessibleDescription(`Generating needs your own ${label} API key`);
    };
    expectDisabled();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A paper city' } });
    expectDisabled();
    expect(screen.queryByRole('button', { name: /key to generate/ })).toBeNull();
  });
});

/**
 * The point of writing first: the prompt belongs to the draft, not the provider,
 * so someone who has a key for a different provider can run it there.
 */
describe('a prompt written before connecting', () => {
  it('follows the visitor to a provider they do have a key for', () => {
    useAppStore.setState({ runwareApiKey: 'k' });
    const first = render(WORKSPACES[2].render());
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A paper city' } });
    first.unmount();

    render(WORKSPACES[0].render());

    expect(screen.getByLabelText('Prompt')).toHaveValue('A paper city');
    expect(screen.getByRole('button', { name: /^Generate video/ })).toBeEnabled();
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

describe('Gemini video with no key', () => {
  it('follows the same rule on its own Generate button', () => {
    useAppStore.setState({ apiKey: '' });
    useDraftStore.setState({ prompt: 'A paper city' });
    render(<GeminiVideoWorkspace inputMode="text" onBack={() => undefined} onOpenConnections={() => undefined} />);

    const generate = screen.getByRole('button', { name: /^Generate video/ });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAccessibleDescription('Generating needs your own Google Gemini API key');
    expect(screen.getByLabelText('Prompt')).toBeEnabled();
  });
});
