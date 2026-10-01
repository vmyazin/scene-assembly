/**
 * The picture a running job shows where its thumbnail will be: a field of short
 * strokes, each swinging about its own resting angle a little out of step with
 * its neighbours, so the whole surface reads as a slow wave passing through.
 *
 * It stands in for the finished frame rather than for a spinner. It has the
 * frame's aspect ratio and fills the same well, so the card does not change
 * shape when the result lands, and it says "alive" without saying how far
 * along — no provider reports that, and a bar of made-up progress would be the
 * one false thing on the card.
 *
 * Pure SVG and CSS on purpose: nothing runs in JavaScript per frame, it renders
 * on the server and under jsdom, and `prefers-reduced-motion` freezes it on the
 * resting angles (see `.job-wave-line`), which is still a picture rather than
 * an empty box. The lines take their colour from `currentColor`, so the caller
 * passes the job state's tone and the field matches the word printed over it.
 */
const COLUMNS = 16;
const ROWS = 9;
const CELL = 10;
/** Half the stroke's length, in the 160 × 90 viewBox. Under half a cell, so neighbours never touch. */
const HALF = 3.2;

/**
 * The field is the same for every card and never changes, so it is worked out
 * once. The resting angle is two overlapping sinusoids across the grid — smooth
 * enough that neighbours agree, uneven enough that it does not look ruled. The
 * delay walks diagonally across it, which is what turns sixteen-by-nine
 * independent swings into one travelling wave.
 */
const STROKES = Array.from({ length: COLUMNS * ROWS }, (_, index) => {
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const angle = 78 * Math.sin(column * 0.38 + row * 0.21) + 30 * Math.cos(row * 0.55 - column * 0.1);
  return {
    key: index,
    x: CELL / 2 + column * CELL,
    y: CELL / 2 + row * CELL,
    angle: `${angle.toFixed(1)}deg`,
    delay: `${(-(column * 0.19 + row * 0.31)).toFixed(2)}s`,
  };
});

export default function JobWaveField({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${COLUMNS * CELL} ${ROWS * CELL}`}
      preserveAspectRatio="xMidYMid slice"
      className={`job-wave-field absolute inset-0 h-full w-full ${className}`}
    >
      {STROKES.map(stroke => (
        <g key={stroke.key} transform={`translate(${stroke.x} ${stroke.y})`}>
          {/* The group places it; the line rotates about the group's origin,
              because a CSS transform on the line itself would replace the
              `transform` attribute that positions it. */}
          <line
            className="job-wave-line"
            x1={0}
            y1={-HALF}
            x2={0}
            y2={HALF}
            style={{ '--a': stroke.angle, animationDelay: stroke.delay } as React.CSSProperties}
          />
        </g>
      ))}
    </svg>
  );
}
