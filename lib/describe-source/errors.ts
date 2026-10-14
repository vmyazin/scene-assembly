// lib/describe-source/errors.ts

/** Sentences the button and the route both show. One list, so they cannot drift. */
export const DESCRIBE_ERRORS = {
  empty: 'Add a source image or video to describe.',
  noKey: 'Connect a Gemini API key to describe this source.',
  emptyModel: 'The model returned an empty description. Please try again.',
  tooLarge: 'That source is too large to describe. Try a shorter clip or a smaller image.',
  unreadable: 'Could not read that source.',
  unsupported: 'Describe source accepts an image or a video.',
  failed: 'Could not describe this source. Please try again.',
  invalid: 'The description request was not valid.',
  busy: 'Describe source is busy right now. Wait a moment and try again.',
} as const;

/** The description still ran. This names what could not fit in the part budget. */
export function describeOmittedNotice(labels: string[]): string {
  return `Left out ${labels.join(', ')} so the description could fit.`;
}
