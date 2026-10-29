import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderSelector from '../components/ProviderSelector';
import VideoWorkspace from '../components/VideoWorkspace';
import { useAppStore } from '../store/useAppStore';

vi.mock('../components/FalGenerationWorkspace', () => ({ default: () => <div>fal workspace</div> }));
vi.mock('../components/GeminiVideoWorkspace', () => ({ default: () => <div>gemini workspace</div> }));
vi.mock('../components/KieGenerationWorkspace', () => ({ default: () => <div>kie workspace</div> }));
vi.mock('../components/ProviderVideoWorkspace', () => ({ default: ({ provider, inputMode }: { provider: string; inputMode: string }) => <div data-testid="workspace">{provider}:{inputMode}</div> }));

beforeEach(() => vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('direction-first engine selection', () => {
  it('keeps all directions visible and preserves an edit deep link from Kie', () => {
    useAppStore.setState({ videoEngine: 'kie' });
    const onInputModeChange = vi.fn();
    render(<VideoWorkspace inputMode="edit" onInputModeChange={onInputModeChange} onExit={() => {}} onOpenConnections={() => {}} />);
    for (const name of ['Text to video', 'Image to video', 'First & last frame', 'Edit video', 'Character references']) {
      expect(screen.getByRole('button', { name })).toBeVisible();
    }
    expect(screen.getAllByRole('radio')).toHaveLength(7);
    expect(screen.getByRole('radio', { name: 'Kie.ai' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Google Gemini' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit video' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('kie workspace')).toBeInTheDocument();
    expect(useAppStore.getState().videoEngine).toBe('kie');
    expect(onInputModeChange).not.toHaveBeenCalled();
  });

  it('preserves compatible engine choices as the direction changes', () => {
    useAppStore.setState({ videoEngine: 'runware' });
    const props = { onInputModeChange: vi.fn(), onExit: vi.fn(), onOpenConnections: vi.fn() };
    const view = render(<VideoWorkspace inputMode="reference" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Text to video' }));
    expect(props.onInputModeChange).toHaveBeenCalledWith('text');
    view.rerender(<VideoWorkspace inputMode="text" {...props} />);
    expect(screen.getByRole('radio', { name: 'Kie.ai' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Runware' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a custom explanation on hover or focus and dismisses with Escape', () => {
    render(<ProviderSelector value="runware" onChange={vi.fn()} disabledProviders={['kie']} />);
    const disabled = screen.getByRole('radio', { name: 'Kie.ai' });
    const trigger = disabled.parentElement!;
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip).not.toBeVisible();
    fireEvent.pointerEnter(trigger);
    expect(tooltip).toBeVisible();
    expect(tooltip).toHaveTextContent('This provider does not support this mode');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(tooltip).not.toBeVisible();
    fireEvent.focus(trigger);
    expect(tooltip).toBeVisible();
    fireEvent.blur(trigger);
    expect(tooltip).not.toBeVisible();
    expect(disabled).toBeDisabled();
  });

  it('blocks clicks and skips disabled engines for arrows, Home and End', () => {
    const onChange = vi.fn();
    render(<ProviderSelector value="runware" onChange={onChange} disabledProviders={['kie', 'gemini', 'piapi']} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Kie.ai' }));
    expect(onChange).not.toHaveBeenCalled();
    const runware = screen.getByRole('radio', { name: 'Runware' });
    fireEvent.keyDown(runware, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('comet');
    expect(screen.getByRole('radio', { name: 'CometAPI' })).toHaveFocus();
    fireEvent.keyDown(runware, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('atlas');
    fireEvent.keyDown(runware, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('comet');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'CometAPI' }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('fal');
  });
});
