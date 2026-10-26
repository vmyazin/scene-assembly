/**
 * The two slots of a first-and-last-frame run.
 *
 * Order is the whole of what distinguishes them — Runware and fal both read a
 * pair of frame images as "opens here, ends here" — so the wording lives in one
 * place rather than being spelled slightly differently by each workspace that
 * has to say it.
 */
export const frameSlotLabel = (index: number) => (index === 0 ? 'First frame' : 'Last frame');

/** A keyframe sequence keeps its opening and closing frames at the ends. */
export function keyframeSlotLabel(index: number, count: number): string {
  if (index === 0) return 'First frame';
  if (index === count - 1) return 'Last frame';
  return `Middle frame ${index}`;
}
