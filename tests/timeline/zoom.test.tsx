import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { FALLBACK_TRACK_WIDTH, MAX_ZOOM } from '../../lib/timeline/scale';
import { useGalleryStore } from '../../store/useGalleryStore';
import { useTimelineStore } from '../../store/useTimelineStore';
import { mockPendingAcquire, renderWorkspace, setupTimelineTest, video } from './helpers';

/**
 * Zoom is the track's second scale gesture (trimming is the first), and every
 * widget on the track reads pixels-per-second: blocks, ruler, playhead and
 * scrubbing all move together or the track lies about where the clips are.
 */
const track = () => screen.getByTestId('timeline-track');
const scroller = () => track().querySelector('.overflow-x-auto') as HTMLDivElement;
/** The content width the blocks are laid out in, which is what zoom changes. */
const contentWidth = () =>
  Number.parseFloat((scroller().firstElementChild as HTMLElement).style.width);

/** A trackpad pinch: a wheel event carrying ctrlKey, which is how browsers report it. */
const pinch = (deltaY: number, clientX = 0) =>
  fireEvent.wheel(scroller(), { deltaY, ctrlKey: true, clientX });

/**
 * Renders and waits for acquisition to land. Until a clip reports a duration
 * its block is *untimed* and keeps a fixed width at every zoom — measuring
 * before then would be measuring the one thing zoom deliberately does not
 * touch, and every assertion here would pass for the wrong reason.
 */
async function renderReady() {
  renderWorkspace();
  await screen.findAllByText('0:04');
}

describe('zooming the timeline track', () => {
  beforeEach(() => {
    setupTimelineTest({ wide: true });
    useGalleryStore.setState({
      records: [video({ id: 'r1', slug: 'first', blob: new Blob(['x']), bytes: 1 })],
      hydrated: true,
    });
    useTimelineStore.getState().addClip('r1');
    useTimelineStore.getState().addClip('r1');
  });

  it('starts at fit, with the ways out of it visible but inert', async () => {
    // The controls stay on screen at 100%: a Fit button that only appears once
    // you are lost arrives too late to be the thing you reach for.
    await renderReady();

    expect(screen.getByTestId('track-zoom-level')).toHaveTextContent('100%');
    expect(screen.getByLabelText(/zoom out/i)).toBeDisabled();
    expect(screen.getByLabelText(/fit the timeline/i)).toBeDisabled();
    expect(screen.getByLabelText(/zoom in/i)).toBeEnabled();
  });

  it('opens with the whole timeline inside the track, not scrolled', async () => {
    await renderReady();

    // jsdom measures nothing, so the layout falls back to FALLBACK_TRACK_WIDTH
    // — the same width the fit is computed against, which is the relationship
    // being asserted: content never exceeds the container it was fitted to.
    expect(contentWidth()).toBeLessThanOrEqual(FALLBACK_TRACK_WIDTH);
  });

  it('widens the track on a pinch out', async () => {
    await renderReady();
    const before = contentWidth();

    // Negative deltaY with ctrlKey is a pinch *open* — the same shape the
    // browser sends for Ctrl+wheel.
    pinch(-200);

    expect(contentWidth()).toBeGreaterThan(before);
  });

  it('leaves an ordinary wheel alone, because that is how the track scrolls', async () => {
    await renderReady();
    const before = contentWidth();

    fireEvent.wheel(scroller(), { deltaY: -200 });

    expect(contentWidth()).toBe(before);
  });

  it('zooms in and back out through the buttons, for a mouse and a keyboard', async () => {
    await renderReady();
    const fit = contentWidth();

    fireEvent.click(screen.getByLabelText(/zoom in/i));
    const zoomed = contentWidth();
    expect(zoomed).toBeGreaterThan(fit);

    fireEvent.click(screen.getByLabelText(/zoom out/i));
    expect(contentWidth()).toBeCloseTo(fit, 1);
  });

  it('offers a way back to fit once zoomed, and takes it', async () => {
    await renderReady();
    const fit = contentWidth();
    fireEvent.click(screen.getByLabelText(/zoom in/i));
    fireEvent.click(screen.getByLabelText(/zoom in/i));
    expect(contentWidth()).toBeGreaterThan(fit);

    fireEvent.click(screen.getByLabelText(/fit the timeline/i));

    expect(contentWidth()).toBeCloseTo(fit, 1);
    expect(screen.getByLabelText(/fit the timeline/i)).toBeDisabled();
  });

  it('never zooms out past fit', async () => {
    // At fit the whole timeline is already on screen; further out would only
    // shrink the clips into the corner of an empty track.
    await renderReady();
    const fit = contentWidth();

    pinch(400);
    pinch(400);

    expect(contentWidth()).toBeCloseTo(fit, 1);
  });

  it('stops at a ceiling rather than stretching without bound', async () => {
    await renderReady();

    for (let i = 0; i < 40; i += 1) pinch(-200);

    expect(screen.getByText(`${MAX_ZOOM * 100}%`)).toBeInTheDocument();
    expect(screen.getByLabelText(/zoom in/i)).toBeDisabled();
  });

  it('always reports the scale, so the default is checkable too', async () => {
    await renderReady();
    const readout = screen.getByTestId('track-zoom-level');
    expect(readout).toHaveTextContent('100%');

    fireEvent.click(screen.getByLabelText(/zoom in/i));

    expect(readout).toHaveTextContent('150%');
  });
});

/**
 * Zooming without an anchor is disorienting: the content grows under a fixed
 * scroll offset, so whatever you were looking at slides off screen. The instant
 * under the gesture has to stay under the gesture.
 */
describe('a zoom holds the picture still', () => {
  beforeEach(() => {
    setupTimelineTest({ wide: true });
    useGalleryStore.setState({
      records: [video({ id: 'r1', slug: 'first', blob: new Blob(['x']), bytes: 1 })],
      hydrated: true,
    });
    useTimelineStore.getState().addClip('r1');
    useTimelineStore.getState().addClip('r1');
  });

  it('scrolls so the instant under the pinch stays where it was', async () => {
    await renderReady();
    const element = scroller();
    // jsdom lays nothing out, so the viewport has to be given a size for the
    // anchor arithmetic to have anything to work with.
    Object.defineProperty(element, 'clientWidth', { value: 600, configurable: true });

    pinch(-200, 300);

    // Anchored at the middle of a track that grew: the offset must move off
    // zero, or the correction did not run at all.
    expect(element.scrollLeft).toBeGreaterThan(0);
  });

  it('never scrolls to a negative offset when anchored near the head', async () => {
    await renderReady();
    const element = scroller();
    Object.defineProperty(element, 'clientWidth', { value: 600, configurable: true });

    pinch(-200, 0);

    expect(element.scrollLeft).toBe(0);
  });

  it('anchors on the layout on screen even before React has run its effects', async () => {
    // Clips that finish loading late render on React's own scheduler, which
    // commits the DOM and runs passive effects in a later task. A pinch in
    // between used to read the layout from before the clips were timed and
    // scroll to 0. A MutationObserver callback runs in exactly that gap.
    const first = mockPendingAcquire();
    const second = mockPendingAcquire();
    useTimelineStore.getState().clear();
    useTimelineStore.getState().addClip('r1');
    useTimelineStore.getState().addClip('r1');
    renderWorkspace();
    const element = scroller();
    Object.defineProperty(element, 'clientWidth', { value: 600, configurable: true });
    await waitFor(() => expect(first.signal() && second.signal()).toBeTruthy());

    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const scrolled = new Promise<number>((done) => {
        const observer = new MutationObserver(() => {
          if (screen.queryAllByText('0:04').length < 2) return;
          observer.disconnect();
          element.dispatchEvent(
            new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, clientX: 300, bubbles: true, cancelable: true })
          );
          setTimeout(() => done(element.scrollLeft), 50);
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      });
      const ready = {
        status: 'ready',
        blob: new Blob(['v']),
        dimensions: { width: 1920, height: 1080, durationSeconds: 4 },
        durable: true,
      } as const;
      first.resolve(ready);
      second.resolve(ready);
      expect(await scrolled).toBeGreaterThan(0);
    } finally {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });
});
