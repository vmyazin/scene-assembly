'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { MIN_ZOOM, clampZoom } from '@/lib/timeline/scale';

/** Where a zoom wants to hold the picture still. */
export interface ZoomAnchor {
  /** The instant that was under the gesture. */
  time: number;
  /** How far into the viewport it was, so it can be put back there. */
  viewportX: number;
}

interface TrackZoomOptions {
  /** The scrolling viewport the gesture happens in. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * Which instant sits at a given x in the scrolled *content*. Supplied by the
   * track because only it holds the layout — and it has to be read before the
   * zoom is applied, while that layout is still the one on screen.
   */
  timeAtContentX: (x: number) => number;
}

export interface TrackZoom {
  zoom: number;
  /** True once the viewer has zoomed away from fit, so a way back can be offered. */
  zoomed: boolean;
  /** Multiplies the current zoom, anchored on the middle of the viewport. */
  zoomBy: (factor: number) => void;
  reset: () => void;
  /**
   * The anchor a zoom just asked for, or null. Consume it in a layout effect
   * *after* the new layout has rendered — the correction is a scroll position,
   * and it can only be computed once the content has its new width.
   */
  anchorRef: RefObject<ZoomAnchor | null>;
}

/** Two touches, and how far apart they are. */
function pinchDistance(touches: TouchList): number {
  const [a, b] = [touches[0], touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function pinchCentreX(touches: TouchList): number {
  return (touches[0].clientX + touches[1].clientX) / 2;
}

/**
 * Pinch-to-zoom over the track's time scale.
 *
 * Zooming without an anchor is disorienting: the clip you were looking at
 * slides off screen because the content grew underneath a fixed scroll
 * position. So every zoom records the instant under the gesture and how far
 * into the viewport it sat, and the track puts it back there once the wider
 * layout exists. Anchoring on *time* rather than on a fraction of the content
 * width is what makes it exact — untimed blocks keep a fixed width at every
 * zoom, so content width does not scale uniformly and a ratio would drift.
 *
 * Both gestures are listened for natively rather than through React props,
 * because both must call `preventDefault` and React attaches `wheel` and
 * `touchmove` passively — a passive listener cannot cancel, so the browser
 * would zoom the whole page instead of the track.
 */
export function useTrackZoom({ scrollRef, timeAtContentX }: TrackZoomOptions): TrackZoom {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const anchorRef = useRef<ZoomAnchor | null>(null);

  // Read inside native listeners that are attached once; without these they
  // would close over the zoom, and the layout reader, from the render that
  // attached them. Written in a layout effect rather than during render,
  // because a ref must not be touched while rendering, and rather than in a
  // passive effect, because a wheel event is not one React flushes passive
  // effects for: a pinch step landing between a commit and those effects
  // would compound from the zoom before it.
  const zoomRef = useRef(zoom);
  const timeAtRef = useRef(timeAtContentX);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    timeAtRef.current = timeAtContentX;
  });

  /**
   * `clientX` is a viewport coordinate; the layout is in content coordinates,
   * which the scroll offset separates. Getting this wrong anchors correctly
   * only while the track happens to be scrolled to zero.
   */
  const applyZoom = useCallback(
    (next: number, clientX?: number) => {
      const scroller = scrollRef.current;
      const clamped = clampZoom(next);
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const viewportX =
          clientX === undefined ? scroller.clientWidth / 2 : clientX - rect.left;
        anchorRef.current = {
          time: timeAtRef.current(scroller.scrollLeft + viewportX),
          viewportX,
        };
      }
      setZoom(clamped);
    },
    [scrollRef]
  );

  const zoomBy = useCallback(
    (factor: number) => applyZoom(zoomRef.current * factor),
    [applyZoom]
  );

  const reset = useCallback(() => applyZoom(MIN_ZOOM), [applyZoom]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    // A trackpad pinch arrives as a wheel event with `ctrlKey` set — the same
    // shape as Ctrl+wheel from a mouse, which is why both zoom here and
    // neither scrolls the page. An unmodified wheel is left alone: that is how
    // the track is scrolled.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      // Exponential, so a pinch feels the same at every zoom level: the same
      // finger travel is the same proportional change, not the same absolute
      // one, which would crawl when zoomed in and lurch when zoomed out.
      applyZoom(zoomRef.current * Math.exp(-event.deltaY / 100), event.clientX);
    };

    let startDistance = 0;
    let startZoom = MIN_ZOOM;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      startDistance = pinchDistance(event.touches);
      startZoom = zoomRef.current;
    };

    // Measured against the distance at the gesture's *start* rather than
    // accumulated per move: accumulating multiplies rounding error over a long
    // pinch, and drifts away from where the fingers actually are.
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || startDistance <= 0) return;
      event.preventDefault();
      applyZoom(
        startZoom * (pinchDistance(event.touches) / startDistance),
        pinchCentreX(event.touches)
      );
    };

    const onTouchEnd = () => {
      startDistance = 0;
    };

    scroller.addEventListener('wheel', onWheel, { passive: false });
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd);
    scroller.addEventListener('touchcancel', onTouchEnd);
    return () => {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scrollRef, applyZoom]);

  return { zoom, zoomed: zoom > MIN_ZOOM, zoomBy, reset, anchorRef };
}
