import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ImagePlus, Type } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoDirectionSelector, { type VideoDirection } from '../components/VideoDirectionSelector';

const modes: VideoDirection[] = [
  { id: 'text', label: 'Text to video', blurb: 'Start from a written prompt', requires: 'Prompt only', icon: Type, thumbnail: '/thumbnails/neon-cat-catalog-isometric.jpg' },
  { id: 'frames', label: 'First & last frame', blurb: 'Fill the motion between two stills', requires: 'Needs two images', icon: ImagePlus, thumbnail: '/thumbnails/neon-cat-jump-dashboard.jpg', needsProviderSupport: true },
];
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('compact video direction previews', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('keeps the details out of the layout and waits a full second without changing selection', () => {
    const onChange = vi.fn();
    render(<VideoDirectionSelector modes={modes} value="text" onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'First & last frame' });
    expect(screen.queryByText('Needs two images')).not.toBeInTheDocument();
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    advance(999);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    advance(1);
    const card = screen.getByRole('tooltip');
    expect(within(card).getByText('Fill the motion between two stills')).toBeInTheDocument();
    expect(within(card).getByText('Needs two images')).toBeInTheDocument();
    expect(within(card).getByText('Not on every provider')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-describedby', card.id);
    expect(onChange).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith('frames');
  });

  it('cancels a passing hover and gives the next direction its own full delay', () => {
    render(<VideoDirectionSelector modes={modes} value="text" onChange={() => {}} />);
    const text = screen.getByRole('button', { name: 'Text to video' });
    const frames = screen.getByRole('button', { name: 'First & last frame' });
    fireEvent.pointerEnter(text, { pointerType: 'mouse' });
    advance(700);
    fireEvent.pointerLeave(text, { pointerType: 'mouse' });
    advance(1000);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.pointerEnter(text, { pointerType: 'mouse' });
    advance(700);
    fireEvent.pointerLeave(text, { pointerType: 'mouse' });
    fireEvent.pointerEnter(frames, { pointerType: 'mouse' });
    advance(999);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Needs two images');
  });

  it('lets the pointer reach the card and Escape dismisses it without reopening', () => {
    render(<VideoDirectionSelector modes={modes} value="text" onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Text to video' });
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    advance(1000);
    fireEvent.pointerLeave(button, { pointerType: 'mouse' });
    advance(60);
    fireEvent.pointerEnter(screen.getByRole('tooltip'), { pointerType: 'mouse' });
    advance(1000);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Prompt only');
    expect(screen.queryByText('Not on every provider')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    advance(2000);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('supports delayed keyboard focus and cancels when focus leaves', () => {
    render(<VideoDirectionSelector modes={modes} value="text" onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Text to video' });
    // jsdom does not track the browser's keyboard/pointer focus modality.
    const matches = button.matches.bind(button);
    vi.spyOn(button, 'matches').mockImplementation(selector => selector === ':focus-visible' || matches(selector));
    act(() => button.focus());
    advance(999);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Prompt only');
    act(() => button.blur());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows touch details on selection and dismisses with an outside press', () => {
    const onChange = vi.fn();
    render(<VideoDirectionSelector modes={modes} value="text" onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'First & last frame' });
    fireEvent.pointerEnter(button, { pointerType: 'touch' });
    advance(1000);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith('frames');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Needs two images');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cancels pending work on unmount, including a provider-key replacement', () => {
    const view = render(<VideoDirectionSelector key="runware" modes={modes} value="text" onChange={() => {}} />);
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'First & last frame' }), { pointerType: 'mouse' });
    advance(700);
    view.rerender(<VideoDirectionSelector key="kie" modes={[modes[0]]} value="text" onChange={() => {}} />);
    advance(1000);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'First & last frame' })).not.toBeInTheDocument();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
